import { createContext, useContext } from "react";

import type { DisplayData } from "@/features/editor/components/artifacts/display";
import type { CheckpointSummary } from "@/features/editor/core/history-service";
import type { LspDiagnostic } from "@/features/editor/core/python-service";
import type { TextEditorSettings } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";

/// One open buffer. `uri` is the Monaco/LSP `file://` URI; `path` is the
/// absolute on-disk path (null for an unsaved scratch buffer).
export type EditorDocument = {
  uri: string;
  path: string | null;
  name: string;
  text: string;
};

/// An editor position for revealing a location. 1-based, matching Monaco.
export type EditorPosition = {
  column: number;
  lineNumber: number;
};

export type RunStatus = "idle" | "running" | "done";

/// One line of run output, tagged with its stream. For a "display" line, `text`
/// is empty and the parsed MIME bundle is on `display`.
export type OutputLine = {
  id: number;
  stream: "stdout" | "stderr" | "display";
  text: string;
  display?: DisplayData;
};

/// Live run console state, shared between the toolbar Run button and the
/// Output panel.
export type RunState = {
  status: RunStatus;
  exitCode: number | null;
  lines: OutputLine[];
  /// Whether the Python runtime is available (Run is disabled otherwise).
  available: boolean;
  /// A human label for the runtime ("Python 3.12", "Python unavailable", …).
  runtimeLabel: string;
  /// Run the active document's buffer.
  run: () => void;
};

/// A one-shot instruction the active editor consumes once and acknowledges.
export type EditorAction = {
  id: string;
  kind: "revealLocation";
  uri: string;
  lineNumber: number;
  column: number;
};

/// A git manager over the active workspace's branch (HEAD), or `null` when no
/// folder is open. The History panel decides what to show from the live
/// `isRepo` status, not a persisted flag.
export type HistoryManager = {
  root: string;
  /// Bumped to tell the History panel to re-read its status/list/changes (after
  /// a checkpoint is saved from the review tab, or after a restore or init).
  epoch: number;
  /// Whether the "Review & save" center tab is currently open.
  reviewOpen: boolean;
  /// Initialize a git repository in this workspace (when it has none yet).
  onInitRepo: () => Promise<void> | void;
  /// Refresh open buffers after a restore rewrote files on disk.
  onAfterRestore: (full: boolean) => Promise<void> | void;
  /// Increment `epoch`.
  refresh: () => void;
  /// Open the full-width "Review & save changes" center tab.
  openReview: () => void;
  /// Open a read-only diff center tab for one file within a past checkpoint.
  openDiff: (checkpoint: CheckpointSummary, path: string) => void;
};

/// Live page state and handlers for the editor dock panels. Panels read this
/// instead of receiving data through dockview parameters, so the panel render
/// closures stay referentially stable and `updateParameters` never re-runs just
/// because state changed.
export type EditorPageContextValue = {
  /// The open documents, keyed by path (or by URI for scratch buffers).
  documentsByPath: Record<string, EditorDocument>;
  /// The active document, or null when nothing is open.
  activeDocument: EditorDocument | null;
  /// LSP diagnostics for the active document's URI.
  diagnostics: LspDiagnostic[];
  /// The active editor's cursor line (0-based), or null.
  cursorLine: number | null;
  /// One-shot reveal action for the editor (cleared after it's handled).
  editorAction: EditorAction | null;
  /// The workspace root (open folder), or null.
  workspaceRoot: string | null;
  /// Reload the file tree from disk (e.g. after creating the Python
  /// environment writes pyproject.toml / uv.lock / .gitignore).
  refreshTree: () => void;
  /// Re-read the given paths from disk into their open buffers, so an editor
  /// tab reflects an on-disk change made outside it (e.g. `uv add` rewriting
  /// pyproject.toml). Paths that aren't open are ignored.
  reloadFilesFromDisk: (paths: string[]) => void;

  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;

  /// The git-history manager for the open folder, or null.
  history: HistoryManager | null;

  /// The shared run console state.
  run: RunState;

  /// Mark the active document, opening it in the editor if needed.
  activateDocument: (path: string) => void;
  /// Report the active editor's cursor line (0-based), for AI context.
  reportCursor: (line: number) => void;
  /// Return an already-open document by path/URI.
  getOpenDocument: (path: string) => EditorDocument | null;
  /// Save a document's current text to disk and record a history checkpoint.
  saveDocument: (path: string, text: string) => Promise<void>;
  /// Push the latest editor text into state (debounced LSP sync happens in the
  /// editor surface).
  updateDocumentText: (path: string, text: string) => void;
  /// Promote a preview tab for `path` to a persistent one.
  persistEditorPanelForPath: (path: string) => void;
  /// Acknowledge a consumed editor action by id.
  handleEditorActionHandled: (id: string) => void;
  /// Open `uri` in the editor and (optionally) reveal a position.
  openLocation: (
    uri: string,
    position?: EditorPosition,
  ) => Promise<boolean> | boolean;
  /// Reveal an LSP-zero-based location (converted to a 1-based editor reveal).
  navigateToLocation: (uri: string, line: number, character: number) => void;
};

export const EditorPageContext = createContext<EditorPageContextValue | null>(
  null,
);

export function useEditorPageContext(): EditorPageContextValue {
  const value = useContext(EditorPageContext);

  if (!value) {
    throw new Error(
      "useEditorPageContext requires an EditorPageContext provider",
    );
  }

  return value;
}
