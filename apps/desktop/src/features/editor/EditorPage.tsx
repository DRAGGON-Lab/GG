import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import {
  type DirEntry,
  exists,
  readDir,
  readTextFile,
  watch,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  type AddPanelPositionOptions,
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanel,
} from "dockview-react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { parseDisplay } from "@/features/editor/components/artifacts/display";
import { AssistantPanel } from "@/features/editor/components/AssistantPanel";
import { CheckpointDiffTab } from "@/features/editor/components/CheckpointDiffTab";
import { CheckpointReview } from "@/features/editor/components/CheckpointReview";
import { DiagnosticsPanel } from "@/features/editor/components/DiagnosticsPanel";
import {
  EditorDockPanel,
  type EditorDockPanelParams,
  type EditorDockPanelRender,
  type EditorDockPanelRenderMap,
  EditorDockTab,
  EditorEmptySurface,
} from "@/features/editor/components/EditorDock";
import {
  EditorExplorer,
  type FileNode,
} from "@/features/editor/components/EditorExplorer";
import { EditorSurface } from "@/features/editor/components/EditorSurface";
import { EnvironmentPanel } from "@/features/editor/components/EnvironmentPanel";
import { HistoryPanel } from "@/features/editor/components/HistoryPanel";
import { OutputPanel } from "@/features/editor/components/OutputPanel";
import {
  initProposedChangesBridge,
  setEditorWorkspaceDelegates,
} from "@/features/editor/core/agent-edit-applier";
import {
  type CheckpointSummary,
  workspaceHistoryInitRepo,
  workspaceHistoryRestoreFile,
} from "@/features/editor/core/history-service";
import {
  type LspDiagnostic,
  onPythonDiagnostics,
  onPythonRunOutput,
  pythonRunScript,
  pythonRuntimeStatus,
  type PythonRuntimeStatus,
} from "@/features/editor/core/python-service";
import { initWorkspaceBridge } from "@/features/editor/core/workspace-bridge";
import {
  type EditorAction,
  type EditorDocument,
  EditorPageContext,
  type EditorPageContextValue,
  type HistoryManager,
  type OutputLine,
  type RunStatus,
  useEditorPageContext,
} from "@/features/editor/editor-page-context";
import { useAppSettings } from "@/features/settings";
import type { PageRuntime } from "@/pages/page.types";
import { Button, PanelLeftOpen, Plus, useTheme } from "@/ui";
import { dockviewThemeByMode } from "@/workbench/theme";

const STORAGE_KEY_ROOT = "bioeng.editor.workspaceRoot";
const STORAGE_KEY_OPEN = "bioeng.editor.openPaths";

const TEXT_EXTENSIONS = new Set([
  ".py",
  ".pyi",
  ".txt",
  ".md",
  ".json",
  ".toml",
  ".cfg",
  ".ini",
  ".yaml",
  ".yml",
  ".csv",
  ".sh",
  ".lock",
]);

const EDITOR_DOCK_PANEL_COMPONENTS = {
  editorPanel: EditorDockPanel,
};

const EDITOR_DOCK_TAB_COMPONENTS = {
  editorTab: EditorDockTab,
};

const EDITOR_DOCK_PANEL_IDS = {
  assistant: "editor-assistant",
  diagnostics: "editor-diagnostics",
  editor: "editor-editor",
  environment: "editor-environment",
  history: "editor-history",
  output: "editor-output",
  review: "editor-checkpoint-review",
} as const;

type EditorToolPanelKind =
  | "assistant"
  | "diagnostics"
  | "environment"
  | "history"
  | "output";

const EDITOR_TOOL_PANELS: Array<{
  id: string;
  kind: EditorToolPanelKind;
  title: string;
}> = [
  { id: EDITOR_DOCK_PANEL_IDS.output, kind: "output", title: "Output" },
  {
    id: EDITOR_DOCK_PANEL_IDS.diagnostics,
    kind: "diagnostics",
    title: "Diagnostics",
  },
  {
    id: EDITOR_DOCK_PANEL_IDS.assistant,
    kind: "assistant",
    title: "Assistant",
  },
  {
    id: EDITOR_DOCK_PANEL_IDS.environment,
    kind: "environment",
    title: "Environment",
  },
  { id: EDITOR_DOCK_PANEL_IDS.history, kind: "history", title: "History" },
];

const sidebarTabRowButtonClassName =
  "size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-transparent hover:text-cg-fg [&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-out hover:[&>svg]:scale-110";

function fileUriFor(path: string) {
  return monaco.Uri.file(path).toString();
}

function baseName(path: string) {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function hasTextExtension(name: string) {
  const dot = name.lastIndexOf(".");

  if (dot < 0) {
    return false;
  }

  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function tabTitleForPath(
  path: string | null | undefined,
  fallback = "Untitled",
) {
  if (!path) {
    return fallback;
  }

  return baseName(path) || fallback;
}

// The connected panel renderers read live page state through the context, so
// these render closures are module constants — dockview `updateParameters`
// never re-runs just because state changed.
const EDITOR_PANEL_RENDERS: EditorDockPanelRenderMap = {
  assistant: () => <AssistantPanel />,
  diagnostics: () => <DiagnosticsPanel />,
  environment: () => <EnvironmentPanel />,
  history: () => <HistoryPanel />,
  output: () => <OutputPanel />,
};

function ConnectedEditorPanel({
  panelApi,
  panelEpoch,
  path,
}: {
  panelApi?: import("dockview-react").DockviewPanelApi;
  panelEpoch: number;
  path: string | null;
}) {
  const {
    activateDocument,
    activeDocument,
    diagnostics,
    documentsByPath,
    editorAction,
    handleEditorActionHandled,
    reportCursor,
    resolvedTheme,
    saveDocument,
    textEditorSettings,
    updateDocumentText,
  } = useEditorPageContext();

  if (!path) {
    return <EditorEmptySurface />;
  }

  const document = documentsByPath[path];

  if (!document) {
    return <EditorEmptySurface />;
  }

  const active = activeDocument?.path === path || activeDocument?.uri === path;

  return (
    <EditorSurface
      active={active}
      diagnostics={active ? diagnostics : []}
      document={document}
      editorAction={active ? editorAction : null}
      key={`${panelApi?.id ?? "editor"}:${document.uri}:${panelEpoch}`}
      onChange={(text) => updateDocumentText(document.uri, text)}
      onCursorMove={(line) => {
        if (active) {
          reportCursor(line);
        }
      }}
      onEditorActionHandled={handleEditorActionHandled}
      onFocus={() => activateDocument(document.path ?? document.uri)}
      onSave={(text) => {
        void saveDocument(path, text);
      }}
      panelApi={panelApi}
      resolvedTheme={resolvedTheme}
      textEditorSettings={textEditorSettings}
    />
  );
}

const renderEditorPanel: EditorDockPanelRender = (
  panelApi,
  panelEpoch,
  params,
) => (
  <ConnectedEditorPanel
    panelApi={panelApi}
    panelEpoch={panelEpoch}
    path={params.documentPath ?? null}
  />
);

function ConnectedCheckpointReview({
  panelApi,
}: {
  panelApi?: import("dockview-react").DockviewPanelApi;
}) {
  const { history, resolvedTheme, textEditorSettings } = useEditorPageContext();

  if (!history) {
    return null;
  }

  return (
    <CheckpointReview
      onClose={() => panelApi?.close()}
      onSaved={history.refresh}
      resolvedTheme={resolvedTheme}
      root={history.root}
      settings={textEditorSettings}
    />
  );
}

function ConnectedCheckpointDiffTab({
  checkpoint,
  path,
}: {
  checkpoint: CheckpointSummary;
  path: string;
}) {
  const { history, resolvedTheme, textEditorSettings } = useEditorPageContext();

  if (!history) {
    return null;
  }

  return (
    <CheckpointDiffTab
      checkpoint={checkpoint}
      onRestoreFile={async () => {
        await workspaceHistoryRestoreFile(history.root, checkpoint.id, path);
        await history.onAfterRestore(false);
        history.refresh();
      }}
      path={path}
      resolvedTheme={resolvedTheme}
      root={history.root}
      settings={textEditorSettings}
    />
  );
}

type EditorPanelRecord = {
  isPlaceholder: boolean;
  isPreview: boolean;
  panelId: string;
  path: string | null;
};

/// Tab title for the wordmark placeholder the editor group reverts to when no
/// document is open.
const EDITOR_PLACEHOLDER_TAB_TITLE = "Studio";

export function EditorPage(_: PageRuntime) {
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();

  const [documentsByPath, setDocumentsByPath] = useState<
    Record<string, EditorDocument>
  >({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>([]);
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const [editorAction, setEditorAction] = useState<EditorAction | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Run console state.
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const [runtime, setRuntime] = useState<PythonRuntimeStatus | null>(null);

  const dockApiRef = useRef<DockviewApi | null>(null);
  const panelRecordsRef = useRef<Map<string, EditorPanelRecord>>(new Map());
  const previewPanelIdRef = useRef<string | null>(null);
  const panelSequenceRef = useRef(0);
  const untitledCounterRef = useRef(0);
  const outputCounterRef = useRef(0);
  const activeKeyRef = useRef<string | null>(null);
  const documentsRef = useRef<Record<string, EditorDocument>>({});
  const closePanelRef = useRef<(panelId: string) => void>(() => {});

  useEffect(() => {
    documentsRef.current = documentsByPath;
  }, [documentsByPath]);

  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const activeDocument = activeKey
    ? (documentsByPath[activeKey] ?? null)
    : null;

  const pageGridStyle: CSSProperties = {
    gridTemplateColumns: sidebarCollapsed
      ? "0px 0px minmax(0,1fr)"
      : `${sidebarWidth}px 6px minmax(0,1fr)`,
  };

  // --- Document state helpers ---

  const getOpenDocument = useCallback(
    (key: string) => documentsRef.current[key] ?? null,
    [],
  );

  const upsertDocument = useCallback((document: EditorDocument) => {
    setDocumentsByPath((current) => ({
      ...current,
      [document.path ?? document.uri]: document,
    }));
  }, []);

  const updateDocumentText = useCallback((key: string, text: string) => {
    setDocumentsByPath((current) => {
      const existing = current[key];

      if (!existing || existing.text === text) {
        return current;
      }

      return { ...current, [key]: { ...existing, text } };
    });
  }, []);

  // --- Diagnostics + run runtime listeners ---

  useEffect(() => {
    let active = true;

    void pythonRuntimeStatus()
      .then((status) => active && setRuntime(status))
      .catch(
        () =>
          active && setRuntime({ available: false, path: null, version: null }),
      );

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void onPythonDiagnostics((event) => {
      const active = activeKeyRef.current
        ? documentsRef.current[activeKeyRef.current]
        : null;

      if (!active || event.uri !== active.uri) {
        return;
      }

      setDiagnostics(event.diagnostics);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // --- Panel bookkeeping ---

  const persistEditorPanel = useCallback((panelId: string) => {
    const api = dockApiRef.current;
    const record = panelRecordsRef.current.get(panelId);

    if (!api || !record?.isPreview) {
      return;
    }

    record.isPreview = false;
    if (previewPanelIdRef.current === panelId) {
      previewPanelIdRef.current = null;
    }

    const panel = api.getPanel(panelId);
    panel?.api.updateParameters({
      ...(panel.params as EditorDockPanelParams | undefined),
      isPreview: false,
    });
  }, []);

  const persistEditorPanelForPath = useCallback(
    (key: string) => {
      for (const record of panelRecordsRef.current.values()) {
        if (record.path === key) {
          persistEditorPanel(record.panelId);
          return;
        }
      }
    },
    [persistEditorPanel],
  );

  const setEditorPanelParams = useCallback(
    (api: DockviewApi, record: EditorPanelRecord) => {
      const panel = api.getPanel(record.panelId);

      if (!panel) {
        return;
      }

      panel.api.setTitle(
        record.isPlaceholder || !record.path
          ? EDITOR_PLACEHOLDER_TAB_TITLE
          : tabTitleForPath(documentTitleKey(record.path)),
      );
      panel.api.updateParameters({
        closePanel: closePanelRef.current,
        documentPath: record.path,
        isPlaceholder: record.isPlaceholder,
        isPreview: record.isPreview,
        kind: "editor",
        persistPreviewPanel: persistEditorPanel,
        render: renderEditorPanel,
      });
    },
    [persistEditorPanel],
  );

  // Closing the last editor reverts it to the wordmark placeholder rather than
  // leaving an empty group; any other editor tab closes outright.
  const closeEditorPanel = useCallback(
    (panelId: string) => {
      const api = dockApiRef.current;
      const panel = api?.getPanel(panelId);
      const record = panelRecordsRef.current.get(panelId);

      if (!api || !panel || !record) {
        return;
      }

      // The placeholder is the editor group's permanent floor; it never closes.
      if (record.isPlaceholder) {
        return;
      }

      const isLastEditor =
        getOpenEditorPanelRecords(panelRecordsRef.current).length === 1;

      if (!isLastEditor) {
        panel.api.close();
        return;
      }

      record.isPlaceholder = true;
      record.isPreview = false;
      record.path = null;

      if (previewPanelIdRef.current === panelId) {
        previewPanelIdRef.current = null;
      }

      setActiveKey(null);
      setEditorPanelParams(api, record);
      syncEditorGroupHeader(api, panelRecordsRef.current);
      panel.api.setActive();
    },
    [setEditorPanelParams],
  );
  useEffect(() => {
    closePanelRef.current = closeEditorPanel;
  });

  // Open a document in the editor group. Single preview tab promoted on
  // double-click (VS Code semantics).
  const openDocumentPanel = useCallback(
    (document: EditorDocument, { preview }: { preview: boolean }) => {
      const api = dockApiRef.current;

      if (!api) {
        return;
      }

      const key = document.path ?? document.uri;

      const existing = [...panelRecordsRef.current.values()].find(
        (record) => record.path === key,
      );

      if (existing) {
        if (!preview && existing.isPreview) {
          existing.isPreview = false;
          existing.isPlaceholder = false;
          if (previewPanelIdRef.current === existing.panelId) {
            previewPanelIdRef.current = null;
          }
          setEditorPanelParams(api, existing);
        }
        api.getPanel(existing.panelId)?.api.setActive();
        return;
      }

      // Adopt the wordmark placeholder (or any empty editor) instead of opening
      // a separate tab beside it.
      const emptyRecord = getReusableEmptyEditorPanelRecord(
        panelRecordsRef.current,
      );

      if (emptyRecord) {
        emptyRecord.isPlaceholder = false;
        emptyRecord.isPreview = preview;
        emptyRecord.path = key;

        if (preview) {
          previewPanelIdRef.current = emptyRecord.panelId;
        } else if (previewPanelIdRef.current === emptyRecord.panelId) {
          previewPanelIdRef.current = null;
        }

        setEditorPanelParams(api, emptyRecord);
        syncEditorGroupHeader(api, panelRecordsRef.current);
        api.getPanel(emptyRecord.panelId)?.api.setActive();
        return;
      }

      // Reuse the current preview panel rather than opening a new one.
      const previewId = previewPanelIdRef.current;
      const previewRecord = previewId
        ? panelRecordsRef.current.get(previewId)
        : undefined;

      if (preview && previewId && previewRecord) {
        previewRecord.path = key;
        previewRecord.isPreview = true;
        previewRecord.isPlaceholder = false;
        setEditorPanelParams(api, previewRecord);
        api.getPanel(previewId)?.api.setActive();
        return;
      }

      const panelId = `editor-tab-${panelSequenceRef.current++}`;
      const record: EditorPanelRecord = {
        isPlaceholder: false,
        isPreview: preview,
        panelId,
        path: key,
      };
      panelRecordsRef.current.set(panelId, record);

      const position = getNewEditorPanelPosition(api);

      api.addPanel<EditorDockPanelParams>({
        component: "editorPanel",
        id: panelId,
        minimumHeight: 220,
        minimumWidth: 360,
        params: {
          closePanel: closePanelRef.current,
          documentPath: key,
          isPlaceholder: false,
          isPreview: preview,
          kind: "editor",
          persistPreviewPanel: persistEditorPanel,
          render: renderEditorPanel,
        },
        position,
        tabComponent: "editorTab",
        title: tabTitleForPath(document.path ?? document.name),
      });

      if (preview) {
        previewPanelIdRef.current = panelId;
      }

      syncEditorGroupHeader(api, panelRecordsRef.current);
      api.getPanel(panelId)?.api.setActive();
    },
    [persistEditorPanel, setEditorPanelParams],
  );

  // --- Document open / save / new ---

  const openPath = useCallback(
    async (path: string, { preview }: { preview: boolean }) => {
      const existing = documentsRef.current[path];

      if (existing) {
        setActiveKey(path);
        openDocumentPanel(existing, { preview });
        return;
      }

      try {
        const text = await readTextFile(path);
        const document: EditorDocument = {
          name: baseName(path),
          path,
          text,
          uri: fileUriFor(path),
        };
        upsertDocument(document);
        setActiveKey(path);
        openDocumentPanel(document, { preview });
      } catch {
        // Ignore files that cannot be read.
      }
    },
    [openDocumentPanel, upsertDocument],
  );

  // Re-read the given open files from disk and push the fresh contents into
  // their live Monaco models (and document state), so a buffer reflects an
  // on-disk change made outside the editor — e.g. `uv add` rewriting
  // pyproject.toml / uv.lock. Files that aren't open are skipped; the editor's
  // model-change listener keeps document state in sync after `setValue`.
  const reloadFilesFromDisk = useCallback(
    async (paths: string[]) => {
      await Promise.all(
        paths.map(async (path) => {
          if (!documentsRef.current[path]) {
            return;
          }

          let fresh: string;
          try {
            fresh = await readTextFile(path);
          } catch {
            return;
          }

          const model = monaco.editor.getModel(monaco.Uri.file(path));
          if (model && model.getValue() !== fresh) {
            model.setValue(fresh);
          }
          upsertDocument({
            name: baseName(path),
            path,
            text: fresh,
            uri: fileUriFor(path),
          });
        }),
      );
    },
    [upsertDocument],
  );

  const handleNew = useCallback(() => {
    untitledCounterRef.current += 1;
    const name = `untitled-${untitledCounterRef.current}.py`;
    const uri = `file:///${name}`;
    const document: EditorDocument = { name, path: null, text: "", uri };
    upsertDocument(document);
    setActiveKey(uri);
    openDocumentPanel(document, { preview: false });
  }, [openDocumentPanel, upsertDocument]);

  const handleOpenFile = useCallback(async () => {
    const selected = await openDialog({
      filters: [
        {
          extensions: ["py", "pyi", "json", "jsonc", "txt"],
          name: "Editor files",
        },
      ],
      multiple: false,
    });

    if (typeof selected === "string") {
      await openPath(selected, { preview: false });
    }
  }, [openPath]);

  // `silent` skips the loading placeholder — used for background refreshes
  // (the fs watcher) so saving a file doesn't flash the tree. The structural
  // equality check keeps the same `tree` reference when nothing changed, so a
  // content-only change (a save) re-renders nothing.
  const loadFolder = useCallback(
    async (root: string, { silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setTreeLoading(true);
      }
      try {
        const nodes = await readFolder(root);
        setTree((current) =>
          JSON.stringify(current) === JSON.stringify(nodes) ? current : nodes,
        );
      } catch {
        setTree([]);
      } finally {
        if (!silent) {
          setTreeLoading(false);
        }
      }
    },
    [],
  );

  const refreshTree = useCallback(() => {
    if (workspaceRoot) {
      void loadFolder(workspaceRoot);
    }
  }, [loadFolder, workspaceRoot]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });

    if (typeof selected !== "string") {
      return;
    }

    setWorkspaceRoot(selected);
    window.localStorage.setItem(STORAGE_KEY_ROOT, selected);
    void loadFolder(selected);
    setHistoryEpoch((epoch) => epoch + 1);
  }, [loadFolder]);

  const bumpHistory = useCallback(() => {
    setHistoryEpoch((epoch) => epoch + 1);
  }, []);

  const writeBuffer = useCallback(
    async (key: string, text: string) => {
      const document = documentsRef.current[key];

      if (!document) {
        return;
      }

      let path = document.path;

      if (!path) {
        const selected = await saveDialog({
          filters: [{ extensions: ["py"], name: "Python" }],
        });

        if (typeof selected !== "string") {
          return;
        }

        path = selected;
      }

      await writeTextFile(path, text);

      const saved: EditorDocument = {
        name: baseName(path),
        path,
        text,
        uri: fileUriFor(path),
      };

      // Re-key the document under its on-disk path when it was an untitled
      // scratch buffer.
      setDocumentsByPath((current) => {
        const next = { ...current };
        delete next[key];
        next[path] = saved;
        return next;
      });

      if (key !== path) {
        // Re-point the open panel and active key to the saved path.
        for (const record of panelRecordsRef.current.values()) {
          if (record.path === key) {
            record.path = path;
            const api = dockApiRef.current;
            if (api) {
              setEditorPanelParams(api, record);
            }
          }
        }
        setActiveKey(path);
      }

      // Saving pins the tab, matching the double-click promote gesture.
      persistEditorPanelForPath(path);

      bumpHistory();
    },
    [bumpHistory, persistEditorPanelForPath, setEditorPanelParams],
  );

  const saveDocument = useCallback(
    async (key: string, text: string) => {
      await writeBuffer(key, text);
    },
    [writeBuffer],
  );

  const removeDocument = useCallback((key: string) => {
    setDocumentsByPath((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const closePanelForPath = useCallback((key: string) => {
    for (const record of panelRecordsRef.current.values()) {
      if (record.path === key) {
        closePanelRef.current(record.panelId);
        return;
      }
    }
  }, []);

  // Open a new file's buffer with its content already in it but NOT written to
  // disk — the agent's `create_file` shows the new file as a proposed change the
  // user accepts (which saves it) or rejects (which discards this buffer).
  const openNewFileBuffer = useCallback(
    async (path: string, content: string) => {
      const document: EditorDocument = {
        name: baseName(path),
        path,
        text: content,
        uri: fileUriFor(path),
      };
      upsertDocument(document);
      setActiveKey(path);
      openDocumentPanel(document, { preview: false });
      return document;
    },
    [openDocumentPanel, upsertDocument],
  );

  const discardNewFile = useCallback(
    (path: string) => {
      closePanelForPath(path);
      removeDocument(path);
    },
    [closePanelForPath, removeDocument],
  );

  // Close and forget an open document (the agent deleted or moved its file).
  const closeDocument = useCallback(
    (pathOrUri: string) => {
      const document =
        documentsRef.current[pathOrUri] ??
        Object.values(documentsRef.current).find(
          (doc) => doc.uri === pathOrUri || doc.path === pathOrUri,
        ) ??
        null;
      if (!document) {
        return;
      }
      const key = document.path ?? document.uri;
      closePanelForPath(key);
      removeDocument(key);
    },
    [closePanelForPath, removeDocument],
  );

  const handleSave = useCallback(() => {
    const key = activeKeyRef.current;
    const document = key ? documentsRef.current[key] : null;

    if (!key || !document) {
      return;
    }

    void saveDocument(key, document.text);
  }, [saveDocument]);

  // --- Run ---

  const appendOutput = useCallback(
    (stream: "stdout" | "stderr" | "display", text: string) => {
      outputCounterRef.current += 1;
      const id = outputCounterRef.current;
      // A display line carries a JSON MIME bundle, not display text; parse it and
      // attach the result. A malformed bundle falls back to a stderr line.
      if (stream === "display") {
        const display = parseDisplay(text);
        setOutputLines((lines) => [
          ...lines,
          display
            ? { id, stream, text: "", display }
            : { id, stream: "stderr", text },
        ]);
        return;
      }
      setOutputLines((lines) => [...lines, { id, stream, text }]);
    },
    [],
  );

  const runActiveDocument = useCallback(async () => {
    const key = activeKeyRef.current;
    const document = key ? documentsRef.current[key] : null;

    if (!document || runStatus === "running" || !runtime?.available) {
      return;
    }

    setOutputLines([]);
    setExitCode(null);
    setRunStatus("running");

    let activeRunId: number | null = null;
    const unlisten = await onPythonRunOutput((output) => {
      if (activeRunId !== null && output.runId !== activeRunId) {
        return;
      }

      appendOutput(output.stream, output.line);
    });

    try {
      const savedPath = document.path ?? undefined;
      const result = await pythonRunScript(
        document.text,
        savedPath,
        workspaceRoot ?? undefined,
      );
      activeRunId = result.runId;
      setExitCode(result.exitCode);
    } catch (error) {
      appendOutput(
        "stderr",
        error instanceof Error ? error.message : "Failed to run script",
      );
    } finally {
      unlisten();
      setRunStatus("done");
    }
  }, [appendOutput, runStatus, runtime, workspaceRoot]);

  const handleRun = useCallback(() => {
    void runActiveDocument();
  }, [runActiveDocument]);

  // ⌘↵ / Ctrl+↵ runs the active file from anywhere — including when the
  // explorer (which hosts the Run button) is collapsed.
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runActiveDocument();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [runActiveDocument]);

  // --- Navigation ---

  const openLocation = useCallback(
    async (uri: string, position?: { column: number; lineNumber: number }) => {
      // The dock keys documents by on-disk path; map a file:// URI back to it.
      const path = uriToPath(uri);
      await openPath(path, { preview: false });

      if (!position) {
        return true;
      }

      setEditorAction({
        column: position.column,
        id: nextActionId(),
        kind: "revealLocation",
        lineNumber: position.lineNumber,
        uri,
      });
      return true;
    },
    [openPath],
  );

  const navigateToLocation = useCallback(
    (uri: string, line: number, character: number) => {
      void openLocation(uri, {
        column: character + 1,
        lineNumber: line + 1,
      });
    },
    [openLocation],
  );

  const handleEditorActionHandled = useCallback((id: string) => {
    setEditorAction((current) => (current?.id === id ? null : current));
  }, []);

  const activateDocument = useCallback((key: string) => {
    setActiveKey(key);
  }, []);

  const reportCursor = useCallback((line: number) => {
    setCursorLine(line);
  }, []);

  // --- History manager ---

  const reloadAfterRestore = useCallback(async () => {
    const root = workspaceRoot;

    if (root) {
      void loadFolder(root);
    }

    // Reload any open documents from disk (their on-disk contents changed).
    const updated = await Promise.all(
      Object.values(documentsRef.current).map(
        async (document): Promise<EditorDocument | null> => {
          if (!document.path) {
            return document;
          }

          try {
            const fresh = await readTextFile(document.path);
            return { ...document, text: fresh };
          } catch {
            return null;
          }
        },
      ),
    );

    setDocumentsByPath((current) => {
      const next: Record<string, EditorDocument> = {};
      for (const document of updated) {
        if (document) {
          next[document.path ?? document.uri] = document;
        }
      }
      // Keep any documents that weren't in the snapshot (defensive).
      return { ...current, ...next };
    });
  }, [loadFolder, workspaceRoot]);

  const initWorkspaceRepo = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    await workspaceHistoryInitRepo(workspaceRoot);
    bumpHistory();
  }, [bumpHistory, workspaceRoot]);

  const openReviewTab = useCallback(() => {
    const api = dockApiRef.current;

    if (!api) {
      return;
    }

    setReviewOpen(true);

    const existing = api.getPanel(EDITOR_DOCK_PANEL_IDS.review);
    if (existing) {
      existing.api.setActive();
      return;
    }

    const editorReference = getEditorReferencePanel(api);
    api.addPanel<EditorDockPanelParams>({
      component: "editorPanel",
      id: EDITOR_DOCK_PANEL_IDS.review,
      minimumHeight: 220,
      minimumWidth: 420,
      params: {
        kind: "review",
        render: (panelApi) => <ConnectedCheckpointReview panelApi={panelApi} />,
      },
      position: editorReference
        ? { direction: "within", referencePanel: editorReference }
        : undefined,
      tabComponent: "editorTab",
      title: "Review changes",
    });
    api.getPanel(EDITOR_DOCK_PANEL_IDS.review)?.api.setActive();
  }, []);

  const openDiffTab = useCallback(
    (checkpoint: CheckpointSummary, path: string) => {
      const api = dockApiRef.current;

      if (!api) {
        return;
      }

      const id = diffPanelId(checkpoint.id, path);
      const existing = api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }

      const editorReference = getEditorReferencePanel(api);
      api.addPanel<EditorDockPanelParams>({
        component: "editorPanel",
        id,
        minimumHeight: 220,
        minimumWidth: 420,
        params: {
          kind: "diff",
          render: () => (
            <ConnectedCheckpointDiffTab checkpoint={checkpoint} path={path} />
          ),
        },
        position: editorReference
          ? { direction: "within", referencePanel: editorReference }
          : undefined,
        tabComponent: "editorTab",
        title: baseName(path),
      });
      api.getPanel(id)?.api.setActive();
    },
    [],
  );

  const history = useMemo<HistoryManager | null>(() => {
    if (!workspaceRoot) {
      return null;
    }

    return {
      epoch: historyEpoch,
      onAfterRestore: reloadAfterRestore,
      onInitRepo: initWorkspaceRepo,
      openDiff: openDiffTab,
      openReview: openReviewTab,
      refresh: bumpHistory,
      reviewOpen,
      root: workspaceRoot,
    };
  }, [
    bumpHistory,
    historyEpoch,
    initWorkspaceRepo,
    openDiffTab,
    openReviewTab,
    reloadAfterRestore,
    reviewOpen,
    workspaceRoot,
  ]);

  // --- Run state object for the context ---

  const runtimeLabel = runtime
    ? runtime.available
      ? // `python --version` already prints e.g. "Python 3.12.13".
        (runtime.version ?? "Python available")
      : "Python unavailable"
    : "Checking runtime…";

  const runState = useMemo(
    () => ({
      available: runtime?.available ?? false,
      exitCode,
      lines: outputLines,
      run: handleRun,
      runtimeLabel,
      status: runStatus,
    }),
    [
      exitCode,
      handleRun,
      outputLines,
      runStatus,
      runtime?.available,
      runtimeLabel,
    ],
  );

  // --- Sidebar resize ---

  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = event.currentTarget.parentElement;

      if (!container) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const resize = (clientX: number) => {
        const rect = container.getBoundingClientRect();
        const minSidebarWidth = 190;
        const maxSidebarWidth = Math.max(
          minSidebarWidth,
          Math.min(520, rect.width - 420),
        );
        const nextWidth = clientX - rect.left;

        setSidebarWidth(
          Math.max(
            minSidebarWidth,
            Math.min(maxSidebarWidth, Math.round(nextWidth)),
          ),
        );
      };

      const handlePointerMove = (moveEvent: PointerEvent) =>
        resize(moveEvent.clientX);
      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      resize(event.clientX);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [],
  );

  // --- Restore persisted workspace + open files on mount ---

  useEffect(() => {
    const storedRoot = window.localStorage.getItem(STORAGE_KEY_ROOT);

    if (!storedRoot) {
      return;
    }

    void (async () => {
      if (await exists(storedRoot)) {
        setWorkspaceRoot(storedRoot);
        void loadFolder(storedRoot);
        setHistoryEpoch((epoch) => epoch + 1);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_ROOT);
      }
    })();
  }, [loadFolder]);

  // Keep the file tree in sync with the workspace on disk: watch the open
  // folder and reload the tree when files appear, move, or are deleted —
  // whether the change came from this app (e.g. creating the `.venv`) or an
  // external tool. Churn inside `.venv`/`.git` is ignored so package installs
  // don't trigger a reload storm; those directories aren't shown anyway.
  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    let stop: (() => void) | undefined;
    let disposed = false;

    void watch(
      workspaceRoot,
      (event) => {
        const paths = Array.isArray(event.paths) ? event.paths : [];
        const relevant = paths.filter(
          (path) =>
            !/[/\\](?:\.venv|\.git|node_modules|__pycache__)[/\\]/.test(path),
        );
        if (relevant.length || paths.length === 0) {
          // Silent: a save/background change must never flash the tree.
          void loadFolder(workspaceRoot, { silent: true });
          // Refresh any of the changed files that are open in the editor.
          void reloadFilesFromDisk(relevant);
        }
      },
      { delayMs: 300, recursive: true },
    ).then(
      (unwatch) => {
        if (disposed) {
          unwatch();
        } else {
          stop = unwatch;
        }
      },
      () => undefined,
    );

    return () => {
      disposed = true;
      stop?.();
    };
  }, [workspaceRoot, loadFolder, reloadFilesFromDisk]);

  // Persist the open on-disk files.
  useEffect(() => {
    const paths = Object.values(documentsByPath)
      .map((document) => document.path)
      .filter((path): path is string => path !== null);
    window.localStorage.setItem(STORAGE_KEY_OPEN, JSON.stringify(paths));
  }, [documentsByPath]);

  // Bridge the agent's `edit` events to the in-buffer proposed-changes review.
  // The applier opens/edits Monaco models through these workspace delegates; the
  // bridge init is idempotent (module-scope guard). `getOpenDocument` resolves by
  // either URI or path, since the agent's edits arrive keyed by URI while the
  // document store keys saved buffers by path.
  useEffect(() => {
    initProposedChangesBridge();
    initWorkspaceBridge();

    const resolveDoc = (uriOrPath: string) =>
      getOpenDocument(uriOrPath) ??
      Object.values(documentsRef.current).find(
        (doc) => doc.uri === uriOrPath || doc.path === uriOrPath,
      ) ??
      null;

    setEditorWorkspaceDelegates({
      closeDocument,
      discardNewFile,
      getOpenDocument: resolveDoc,
      getWorkspaceRoot: () => workspaceRoot,
      openEditorPath: async (uriOrPath) => {
        await openLocation(uriOrPath);
        return resolveDoc(uriOrPath);
      },
      openLocation,
      openNewFileBuffer,
      saveDocument,
      updateDocumentText,
    });

    return () => {
      setEditorWorkspaceDelegates(null);
    };
  }, [
    closeDocument,
    discardNewFile,
    getOpenDocument,
    openLocation,
    openNewFileBuffer,
    saveDocument,
    updateDocumentText,
    workspaceRoot,
  ]);

  // --- Context value ---

  const contextValue = useMemo<EditorPageContextValue>(
    () => ({
      activateDocument,
      activeDocument,
      cursorLine,
      diagnostics,
      documentsByPath,
      editorAction,
      getOpenDocument,
      handleEditorActionHandled,
      history,
      navigateToLocation,
      openLocation,
      persistEditorPanelForPath,
      refreshTree,
      reloadFilesFromDisk,
      reportCursor,
      resolvedTheme,
      run: runState,
      saveDocument,
      textEditorSettings: settings.textEditor,
      updateDocumentText,
      workspaceRoot,
    }),
    [
      activateDocument,
      activeDocument,
      cursorLine,
      diagnostics,
      documentsByPath,
      editorAction,
      getOpenDocument,
      handleEditorActionHandled,
      history,
      navigateToLocation,
      openLocation,
      persistEditorPanelForPath,
      refreshTree,
      reloadFilesFromDisk,
      reportCursor,
      resolvedTheme,
      runState,
      saveDocument,
      settings.textEditor,
      updateDocumentText,
      workspaceRoot,
    ],
  );

  // --- Dock ready ---

  const handleDockReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      dockApiRef.current = api;
      panelRecordsRef.current.clear();
      previewPanelIdRef.current = null;

      const editorPanel = api.addPanel<EditorDockPanelParams>({
        component: "editorPanel",
        id: EDITOR_DOCK_PANEL_IDS.editor,
        minimumHeight: 220,
        minimumWidth: 360,
        params: {
          closePanel: closePanelRef.current,
          documentPath: null,
          isPlaceholder: true,
          isPreview: false,
          kind: "editor",
          persistPreviewPanel: persistEditorPanel,
          render: renderEditorPanel,
        },
        tabComponent: "editorTab",
        title: EDITOR_PLACEHOLDER_TAB_TITLE,
      });
      panelRecordsRef.current.set(EDITOR_DOCK_PANEL_IDS.editor, {
        isPlaceholder: true,
        isPreview: false,
        panelId: EDITOR_DOCK_PANEL_IDS.editor,
        path: null,
      });
      editorPanel.api.setActive();
      syncEditorGroupHeader(api, panelRecordsRef.current);

      api.onDidRemovePanel((panel) => {
        panelRecordsRef.current.delete(panel.id);
        if (previewPanelIdRef.current === panel.id) {
          previewPanelIdRef.current = null;
        }
        if (panel.id === EDITOR_DOCK_PANEL_IDS.review) {
          setReviewOpen(false);
        }
        syncEditorGroupHeader(api, panelRecordsRef.current);
      });

      api.onDidActivePanelChange((panel) => {
        const record = panel?.id
          ? panelRecordsRef.current.get(panel.id)
          : undefined;
        if (record?.path) {
          setActiveKey(record.path);
        }
      });

      // The Assistant is the default (first) tab of the right column.
      const assistantPanel = api.addPanel<EditorDockPanelParams>({
        component: "editorPanel",
        id: EDITOR_DOCK_PANEL_IDS.assistant,
        minimumHeight: 180,
        minimumWidth: 320,
        params: { kind: "assistant", render: EDITOR_PANEL_RENDERS.assistant },
        position: { direction: "right", referencePanel: editorPanel },
        title: "Assistant",
      });
      const diagnosticsPanel = api.addPanel<EditorDockPanelParams>({
        component: "editorPanel",
        id: EDITOR_DOCK_PANEL_IDS.diagnostics,
        minimumHeight: 140,
        minimumWidth: 260,
        params: {
          kind: "diagnostics",
          render: EDITOR_PANEL_RENDERS.diagnostics,
        },
        position: { direction: "below", referencePanel: assistantPanel },
        title: "Diagnostics",
      });

      assistantPanel.group.api.setSize({ width: 460 });
      diagnosticsPanel.group.api.setSize({ height: 240 });
      editorPanel.api.setActive();

      // The remaining tool tabs join the Assistant group after the first frame.
      window.setTimeout(() => {
        const reference = api.getPanel(EDITOR_DOCK_PANEL_IDS.assistant);
        if (!reference) {
          return;
        }

        if (!api.getPanel(EDITOR_DOCK_PANEL_IDS.output)) {
          api.addPanel<EditorDockPanelParams>({
            component: "editorPanel",
            id: EDITOR_DOCK_PANEL_IDS.output,
            minimumHeight: 140,
            minimumWidth: 320,
            params: { kind: "output", render: EDITOR_PANEL_RENDERS.output },
            position: { direction: "within", referencePanel: reference },
            title: "Output",
          });
        }

        if (!api.getPanel(EDITOR_DOCK_PANEL_IDS.environment)) {
          api.addPanel<EditorDockPanelParams>({
            component: "editorPanel",
            id: EDITOR_DOCK_PANEL_IDS.environment,
            minimumHeight: 180,
            minimumWidth: 320,
            params: {
              kind: "environment",
              render: EDITOR_PANEL_RENDERS.environment,
            },
            position: { direction: "within", referencePanel: reference },
            title: "Environment",
          });
        }

        if (!api.getPanel(EDITOR_DOCK_PANEL_IDS.history)) {
          api.addPanel<EditorDockPanelParams>({
            component: "editorPanel",
            id: EDITOR_DOCK_PANEL_IDS.history,
            minimumHeight: 180,
            minimumWidth: 320,
            params: { kind: "history", render: EDITOR_PANEL_RENDERS.history },
            position: { direction: "within", referencePanel: reference },
            title: "History",
          });
        }

        // Assistant stays the selected tab of the right column; focus the editor.
        api.getPanel(EDITOR_DOCK_PANEL_IDS.assistant)?.api.setActive();
        api.getPanel(EDITOR_DOCK_PANEL_IDS.editor)?.api.setActive();
      }, 250);
    },
    [persistEditorPanel],
  );

  useEffect(
    () => () => {
      dockApiRef.current = null;
    },
    [],
  );

  // --- Header actions on dock groups ---

  const reopenToolPanel = useCallback((kind: EditorToolPanelKind) => {
    const api = dockApiRef.current;

    if (!api) {
      return;
    }

    const definition = EDITOR_TOOL_PANELS.find((panel) => panel.kind === kind);

    if (!definition) {
      return;
    }

    const existing = api.getPanel(definition.id);
    if (existing) {
      existing.api.setActive();
      return;
    }

    const sibling = EDITOR_TOOL_PANELS.map((panel) =>
      api.getPanel(panel.id),
    ).find(Boolean);
    const editorPanel = api.getPanel(EDITOR_DOCK_PANEL_IDS.editor);

    api.addPanel<EditorDockPanelParams>({
      component: "editorPanel",
      id: definition.id,
      minimumHeight: 180,
      minimumWidth: 320,
      params: { kind, render: EDITOR_PANEL_RENDERS[kind] },
      position: sibling
        ? { direction: "within", referencePanel: sibling }
        : editorPanel
          ? { direction: "right", referencePanel: editorPanel }
          : undefined,
      title: definition.title,
    });
    api.getPanel(definition.id)?.api.setActive();
  }, []);

  const DockPrefixActions = useMemo(
    () =>
      function DockPrefixActions(props: IDockviewHeaderActionsProps) {
        const groupHasEditor = props.panels.some(
          (panel) =>
            (panel.params as EditorDockPanelParams | undefined)?.kind ===
            "editor",
        );

        if (!groupHasEditor || !sidebarCollapsed) {
          return null;
        }

        return (
          <Button
            aria-label="Show explorer"
            className={`${sidebarTabRowButtonClassName} mx-1`}
            onClick={() => setSidebarCollapsed(false)}
            size="none"
            title="Show explorer"
            variant="bare"
          >
            <PanelLeftOpen aria-hidden="true" size={14} strokeWidth={1.8} />
          </Button>
        );
      },
    [sidebarCollapsed],
  );

  const DockRightActions = useMemo(
    () =>
      function DockRightActions(props: IDockviewHeaderActionsProps) {
        const groupHasEditor = props.panels.some(
          (panel) =>
            (panel.params as EditorDockPanelParams | undefined)?.kind ===
            "editor",
        );

        if (groupHasEditor) {
          return null;
        }

        return (
          <PanelsMenu
            isOpen={(id) => Boolean(props.containerApi.getPanel(id))}
            onOpen={(kind) => reopenToolPanel(kind)}
          />
        );
      },
    [reopenToolPanel],
  );

  return (
    <EditorPageContext.Provider value={contextValue}>
      <div
        className="grid h-full min-h-0 min-w-0 bg-cg-editor transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none"
        style={pageGridStyle}
      >
        <aside
          aria-hidden={sidebarCollapsed ? true : undefined}
          aria-label="Explorer"
          className={`min-h-0 min-w-0 overflow-hidden bg-cg-sidebar transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
            sidebarCollapsed
              ? "pointer-events-none -translate-x-2 opacity-0"
              : "translate-x-0 opacity-100"
          }`}
          inert={sidebarCollapsed ? true : undefined}
        >
          <EditorExplorer
            activeDocumentName={activeDocument?.name ?? null}
            activePath={activeDocument?.path ?? null}
            loading={treeLoading}
            nodes={tree}
            onCollapse={() => setSidebarCollapsed(true)}
            onConfirmOpenFile={(node) =>
              void openPath(node.path, { preview: false })
            }
            onNewFile={handleNew}
            onOpenFile={(node) => void openPath(node.path, { preview: true })}
            onOpenFilePicker={() => void handleOpenFile()}
            onOpenFolder={() => void handleOpenFolder()}
            onSave={handleSave}
            runtimeAvailable={runtime?.available ?? false}
            runtimeLabel={runtimeLabel}
            workspaceName={workspaceRoot ? baseName(workspaceRoot) : null}
          />
        </aside>

        <div
          aria-hidden={sidebarCollapsed ? true : undefined}
          aria-orientation={sidebarCollapsed ? undefined : "vertical"}
          aria-valuemax={sidebarCollapsed ? undefined : 520}
          aria-valuemin={sidebarCollapsed ? undefined : 190}
          aria-valuenow={sidebarCollapsed ? undefined : sidebarWidth}
          className={`group flex items-center justify-center overflow-hidden bg-cg-titlebar transition-opacity duration-150 ease-out motion-reduce:transition-none ${
            sidebarCollapsed
              ? "pointer-events-none cursor-default border-r-0 opacity-0"
              : "cursor-col-resize border-r border-cg-border opacity-100"
          }`}
          onPointerDown={
            sidebarCollapsed ? undefined : handleSidebarResizePointerDown
          }
          role={sidebarCollapsed ? undefined : "separator"}
          title={sidebarCollapsed ? undefined : "Resize explorer"}
        >
          <span className="h-10 w-px bg-cg-border-strong group-hover:bg-cg-accent" />
        </div>

        <div className="h-full min-h-0 min-w-0 bg-cg-editor">
          <DockviewReact
            components={EDITOR_DOCK_PANEL_COMPONENTS}
            dndStrategy="pointer"
            noPanelsOverlay="emptyGroup"
            onReady={handleDockReady}
            prefixHeaderActionsComponent={DockPrefixActions}
            rightHeaderActionsComponent={DockRightActions}
            tabComponents={EDITOR_DOCK_TAB_COMPONENTS}
            theme={dockviewThemeByMode[resolvedTheme]}
          />
        </div>
      </div>
    </EditorPageContext.Provider>
  );
}

async function readFolder(root: string, depth = 0): Promise<FileNode[]> {
  if (depth > 4) {
    return [];
  }

  const entries = await readDir(root);
  const nodes = await Promise.all(
    entries
      .filter((entry: DirEntry) => !entry.name.startsWith("."))
      .map(async (entry: DirEntry): Promise<FileNode | null> => {
        const path = `${root}/${entry.name}`;

        if (entry.isDirectory) {
          return {
            children: await readFolder(path, depth + 1),
            isDirectory: true,
            name: entry.name,
            path,
          };
        }

        if (entry.isFile && hasTextExtension(entry.name)) {
          return { isDirectory: false, name: entry.name, path };
        }

        return null;
      }),
  );

  return nodes
    .filter((node): node is FileNode => node !== null)
    .filter((node) => !node.isDirectory || (node.children?.length ?? 0) > 0)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}

// The document key is the on-disk path (or scratch URI). For panel titles we
// want the bare name; an untitled scratch key is a `file:///name` URI.
function documentTitleKey(key: string) {
  return key.startsWith("file:///") ? uriToPath(key) : key;
}

function uriToPath(uri: string) {
  if (uri.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(uri).pathname);
    } catch {
      return uri.replace(/^file:\/\//, "");
    }
  }

  return uri;
}

function nextActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

/// Editor panels that currently host a document (i.e. not the placeholder).
function getOpenEditorPanelRecords(records: Map<string, EditorPanelRecord>) {
  return Array.from(records.values()).filter(
    (record) => !record.isPlaceholder && Boolean(record.path),
  );
}

/// The placeholder (or any empty editor) a newly opened document can adopt
/// instead of spawning a second tab.
function getReusableEmptyEditorPanelRecord(
  records: Map<string, EditorPanelRecord>,
) {
  for (const record of records.values()) {
    if (record.isPlaceholder || !record.path) {
      return record;
    }
  }

  return null;
}

function getEditorReferencePanel(api: DockviewApi): IDockviewPanel | undefined {
  return api.panels.find((panel) => {
    const params = panel.params as EditorDockPanelParams | undefined;
    return params?.kind === "editor";
  });
}

/// Hide the editor group's tab strip while it holds only the wordmark
/// placeholder, so the default empty screen carries no tab; reveal it once a
/// document occupies the group.
function syncEditorGroupHeader(
  api: DockviewApi,
  records: Map<string, EditorPanelRecord>,
) {
  const editorPanel = getEditorReferencePanel(api);

  if (!editorPanel) {
    return;
  }

  editorPanel.api.group.header.hidden =
    getOpenEditorPanelRecords(records).length === 0;
}

function getNewEditorPanelPosition(
  api: DockviewApi,
): AddPanelPositionOptions | undefined {
  const editorReference = getEditorReferencePanel(api);

  if (editorReference) {
    return { direction: "within", referencePanel: editorReference };
  }

  return api.activePanel
    ? { direction: "left", referencePanel: api.activePanel }
    : undefined;
}

function diffPanelId(checkpointId: string, path: string) {
  return `editor-diff:${checkpointId}:${path}`;
}

function PanelsMenu({
  isOpen,
  onOpen,
}: {
  isOpen: (id: string) => boolean;
  onOpen: (kind: EditorToolPanelKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (
        details &&
        event.target instanceof Node &&
        !details.contains(event.target)
      ) {
        details.open = false;
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open]);

  return (
    <details
      className="relative mx-1 self-center"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      ref={detailsRef}
    >
      <summary
        className="flex size-6 cursor-pointer list-none items-center justify-center rounded-[5px] text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg [&::-webkit-details-marker]:hidden"
        title="Panels"
      >
        <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
      </summary>
      <div className="absolute right-0 top-7 z-50 grid w-max min-w-[150px] gap-0.5 rounded-md border border-cg-border bg-cg-surface p-1 shadow-lg">
        {EDITOR_TOOL_PANELS.map((panel) => (
          <button
            className="grid w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)] items-center gap-1.5 rounded-[4px] border-none bg-transparent px-2 py-1.5 text-left font-[inherit] text-[11.5px] leading-none text-cg-fg hover:bg-cg-surface-hover"
            key={panel.id}
            onClick={() => onOpen(panel.kind)}
            type="button"
          >
            <span className="text-cg-muted">{isOpen(panel.id) ? "✓" : ""}</span>
            {panel.title}
          </button>
        ))}
      </div>
    </details>
  );
}
