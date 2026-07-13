import type { DockviewPanelApi } from "dockview-react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { initVimMode, type VimAdapterInstance } from "monaco-vim";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ProposedChangesChip } from "@/features/editor/components/ProposedChangesChip";
import {
  isPythonName,
  languageForName,
} from "@/features/editor/core/editor-language";
import { runFormatOnSave } from "@/features/editor/core/formatting";
import {
  applyPythonDiagnostics,
  configurePythonMonaco,
} from "@/features/editor/core/monaco-python";
import {
  type LspDiagnostic,
  pythonLspDocumentChange,
  pythonLspDocumentClose,
  pythonLspDocumentOpen,
} from "@/features/editor/core/python-service";
import type {
  EditorAction,
  EditorDocument,
} from "@/features/editor/editor-page-context";
import { useProposedChangeDecorations } from "@/features/editor/useProposedChangeDecorations";

import "@/features/editor/styles.css";

import type { TextEditorSettings } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";
import { getEditorTheme, getTextEditorLineHeight } from "@/ui/editor/monaco";

const DOCUMENT_CHANGE_DEBOUNCE_MS = 250;

type EditorSurfaceProps = {
  document: EditorDocument;
  /// Whether this is the active document (drives diagnostic application).
  active: boolean;
  diagnostics: LspDiagnostic[];
  editorAction: EditorAction | null;
  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;
  panelApi?: DockviewPanelApi;
  onChange: (text: string) => void;
  onCursorMove: (line: number, character: number) => void;
  /// Reports whether the live buffer differs from the last saved contents.
  onDirtyChange: (dirty: boolean) => void;
  onEditorActionHandled: (id: string) => void;
  onFocus: () => void;
  onSave: (text: string) => void;
};

/// A Monaco-hosted Python editor for one document. Manages the model lifecycle,
/// LSP open/change/close, diagnostics → markers, cursor reporting, one-shot
/// reveal actions, and theme/font/vim sync.
export function EditorSurface({
  document,
  active,
  diagnostics,
  editorAction,
  resolvedTheme,
  textEditorSettings,
  panelApi,
  onChange,
  onCursorMove,
  onDirtyChange,
  onEditorActionHandled,
  onFocus,
  onSave,
}: EditorSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const vimModeRef = useRef<VimAdapterInstance | null>(null);
  const vimStatusRef = useRef<HTMLDivElement>(null);
  const changeTimerRef = useRef<number | null>(null);
  const cursorTimerRef = useRef<number | null>(null);
  // Exposed as state (not just the ref) so the proposed-changes hook re-runs
  // once the editor exists.
  const [editorInstance, setEditorInstance] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  const {
    fontFamily,
    fontSize,
    keymap,
    theme: textEditorTheme,
  } = textEditorSettings;
  const vimEnabled = keymap === "vim";

  const initialStateRef = useRef({
    fontFamily,
    fontSize,
    name: document.name,
    resolvedTheme,
    textEditorTheme,
    text: document.text,
    uri: document.uri,
  });

  // The last saved contents, kept in a ref so the mount-time change listener
  // always compares against the current baseline (it updates on save/reload).
  const savedTextRef = useRef(document.savedText ?? "");

  const emitChange = useEffectEvent((text: string) => onChange(text));
  const emitDirty = useEffectEvent((dirty: boolean) => onDirtyChange(dirty));

  // Recompute dirty when the saved baseline changes (save/reload): the model is
  // unchanged, but it may now match the freshly saved contents.
  useEffect(() => {
    savedTextRef.current = document.savedText ?? "";
    const model = editorRef.current?.getModel();
    if (model) {
      emitDirty(model.getValue() !== savedTextRef.current);
    }
  }, [document.savedText]);
  const emitCursorMove = useEffectEvent((line: number, character: number) =>
    onCursorMove(line, character),
  );
  const emitFocus = useEffectEvent(() => onFocus());
  // Format-on-save runs the language formatter on the model, then persists the
  // formatted buffer. Wrapped as an effect event so the ⌘S command — registered
  // once at mount — always reads the current settings and document.
  const saveNow = useEffectEvent(async () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    await runFormatOnSave(
      monaco,
      document.uri,
      document.name,
      textEditorSettings,
    );
    onSave(editor.getValue());
  });
  const syncDocumentChange = useEffectEvent((uri: string, text: string) => {
    void pythonLspDocumentChange(uri, text).catch(() => undefined);
  });

  // Mount once: create the editor against the document's model, register it
  // with the language server, and wire change/cursor/save listeners.
  useEffect(() => {
    configurePythonMonaco(monaco);

    if (!hostRef.current || editorRef.current) {
      return;
    }

    const initial = initialStateRef.current;
    const language = languageForName(initial.name);
    const isPython = isPythonName(initial.name);
    const targetUri = monaco.Uri.parse(initial.uri);
    const existing = monaco.editor.getModel(targetUri);
    const model =
      existing ?? monaco.editor.createModel(initial.text, language, targetUri);

    if (existing && existing.getValue() !== initial.text) {
      existing.setValue(initial.text);
    }

    const editor = monaco.editor.create(hostRef.current, {
      automaticLayout: true,
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      lineHeight: getTextEditorLineHeight(initial.fontSize),
      minimap: { enabled: false },
      model,
      padding: { bottom: 9, top: 9 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      theme: getEditorTheme(initial.textEditorTheme, initial.resolvedTheme),
    });
    editorRef.current = editor;
    setEditorInstance(editor);

    if (isPython) {
      void pythonLspDocumentOpen(initial.uri, initial.text).catch(
        () => undefined,
      );
      monaco.editor.setModelMarkers(model, "python", []);
    }

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveNow();
    });

    emitDirty(model.getValue() !== savedTextRef.current);

    const changeDisposable = editor.onDidChangeModelContent(() => {
      const text = editor.getValue();
      emitChange(text);
      emitDirty(text !== savedTextRef.current);

      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
      }

      if (!isPython) {
        return;
      }

      changeTimerRef.current = window.setTimeout(() => {
        changeTimerRef.current = null;
        syncDocumentChange(initial.uri, text);
      }, DOCUMENT_CHANGE_DEBOUNCE_MS);
    });

    const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
      if (cursorTimerRef.current !== null) {
        window.clearTimeout(cursorTimerRef.current);
      }

      cursorTimerRef.current = window.setTimeout(() => {
        cursorTimerRef.current = null;
        emitCursorMove(
          event.position.lineNumber - 1,
          event.position.column - 1,
        );
      }, 200);
    });

    const focusDisposable = editor.onDidFocusEditorWidget(() => emitFocus());

    editor.focus();

    return () => {
      changeDisposable.dispose();
      cursorDisposable.dispose();
      focusDisposable.dispose();

      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      if (cursorTimerRef.current !== null) {
        window.clearTimeout(cursorTimerRef.current);
        cursorTimerRef.current = null;
      }

      if (isPython) {
        void pythonLspDocumentClose(initial.uri).catch(() => undefined);
      }

      vimModeRef.current?.dispose();
      vimModeRef.current = null;
      editor.dispose();
      monaco.editor.getModel(monaco.Uri.parse(initial.uri))?.dispose();
      editorRef.current = null;
      setEditorInstance(null);
    };
  }, []);

  // Render the agent's proposed changes inline (wash + word-level diff + a
  // per-hunk Accept/Reject zone) and register the accept/reject keybindings.
  useProposedChangeDecorations(editorInstance, document.uri);

  // Diagnostics → markers (only the active Python document drives markers).
  useEffect(() => {
    if (!editorRef.current || !active || !isPythonName(document.name)) {
      return;
    }

    applyPythonDiagnostics(monaco, document.uri, diagnostics);
  }, [active, diagnostics, document.name, document.uri]);

  // One-shot reveal: jump the cursor to the requested position and ack it.
  useEffect(() => {
    const editor = editorRef.current;

    if (!editor || !editorAction) {
      return;
    }

    const model = editor.getModel();

    if (model && model.uri.toString() === editorAction.uri) {
      editor.setPosition({
        column: editorAction.column,
        lineNumber: editorAction.lineNumber,
      });
      editor.revealPositionInCenterIfOutsideViewport({
        column: editorAction.column,
        lineNumber: editorAction.lineNumber,
      });
      editor.focus();
      onEditorActionHandled(editorAction.id);
    }
  }, [editorAction, onEditorActionHandled]);

  // Theme + font sync.
  useEffect(() => {
    monaco.editor.setTheme(getEditorTheme(textEditorTheme, resolvedTheme));
    editorRef.current?.updateOptions({
      fontFamily,
      fontSize,
      lineHeight: getTextEditorLineHeight(fontSize),
    });
  }, [fontFamily, fontSize, resolvedTheme, textEditorTheme]);

  // Vim mode toggle.
  useEffect(() => {
    const editor = editorRef.current;
    const statusNode = vimStatusRef.current;

    if (!editor || !statusNode) {
      return;
    }

    if (!vimEnabled) {
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
      return;
    }

    const vimMode = initVimMode(editor, statusNode);
    vimModeRef.current = vimMode;

    return () => {
      if (vimModeRef.current === vimMode) {
        vimMode.dispose();
        vimModeRef.current = null;
      }
    };
  }, [vimEnabled]);

  // Re-measure when the dock group changes (panel moved/resized).
  useEffect(() => {
    if (!panelApi) {
      return;
    }

    const layout = () =>
      window.requestAnimationFrame(() => editorRef.current?.layout());
    const disposables = [
      panelApi.onDidActiveChange(layout),
      panelApi.onDidDimensionsChange(layout),
      panelApi.onDidVisibilityChange(layout),
    ];

    return () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    };
  }, [panelApi]);

  return (
    <div className="app-editor-monaco relative h-full min-h-0 min-w-0 bg-cg-editor">
      <div className="absolute inset-0" ref={hostRef} />
      {active ? (
        <div className="pointer-events-auto absolute right-2 top-2 z-10">
          <ProposedChangesChip
            documentUri={document.uri}
            onNext={() =>
              void editorInstance?.getAction("gg.proposedChanges.next")?.run()
            }
            onPrevious={() =>
              void editorInstance
                ?.getAction("gg.proposedChanges.previous")
                ?.run()
            }
          />
        </div>
      ) : null}
      <div
        className={[
          "pointer-events-none absolute bottom-1 left-2 z-10 font-mono text-[11px] leading-none text-cg-muted",
          vimEnabled ? "" : "hidden",
        ].join(" ")}
        ref={vimStatusRef}
      />
    </div>
  );
}
