import type { AgentMode } from "@protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/// Minimal LSP shapes the frontend consumes. The backend forwards raw pylsp
/// JSON for the request commands, so these mirror the fields we adapt to Monaco
/// and stay permissive about everything else.

export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type LspMarkupContent = {
  kind?: string;
  value: string;
};

export type LspHover = {
  contents: string | LspMarkupContent | Array<string | LspMarkupContent>;
  range?: LspRange;
} | null;

export type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | LspMarkupContent;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
  textEdit?: {
    range: LspRange;
    newText: string;
  };
};

export type LspCompletionList = {
  isIncomplete?: boolean;
  items: LspCompletionItem[];
};

export type LspLocation = {
  uri: string;
  range: LspRange;
};

export type LspLocationLink = {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
};

export type LspDefinitionResult =
  | LspLocation
  | LspLocation[]
  | LspLocationLink[]
  | null;

export type LspReferencesResult = LspLocation[] | null;

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4;

export type LspDiagnostic = {
  range: LspRange;
  severity?: LspDiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
};

export type LspDocumentSymbol = {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
};

export type PythonRunResult = {
  runId: number;
  exitCode: number | null;
};

export type PythonRuntimeStatus = {
  available: boolean;
  path: string | null;
  version: string | null;
};

/// A line of run output. `stream` is "image" when `line` is a PNG data URL
/// captured from a matplotlib figure rather than text.
export type PythonRunOutput = {
  runId: number;
  stream: "stdout" | "stderr" | "image";
  line: string;
};

/// Streamed progress from an environment command (create venv / install /
/// uninstall), emitted on the `python-env-output` channel.
export type PythonEnvOutput = {
  runId: number;
  stream: "stdout" | "stderr";
  line: string;
};

/// A workspace `.venv`'s state.
export type PythonEnvStatus = {
  hasVenv: boolean;
  venvPath: string | null;
  pythonVersion: string | null;
  packageCount: number | null;
};

/// A package installed in the workspace `.venv`. `direct` is true when it's
/// declared in pyproject.toml (one the user added), false for a transitive
/// dependency pulled in to satisfy a direct one.
export type InstalledPackage = {
  name: string;
  version: string;
  direct: boolean;
};

export type PythonDiagnosticsEvent = {
  uri: string;
  diagnostics: LspDiagnostic[];
};

/// Run a Python buffer. When `path` is set the backend executes that file with
/// its directory as the working directory; otherwise it writes a temp file.
/// When `workspaceRoot` has a `.venv`, the script runs with that interpreter.
export function pythonRunScript(
  code: string,
  path?: string,
  workspaceRoot?: string,
) {
  return invoke<PythonRunResult>("python_run_script", {
    code,
    path,
    workspaceRoot,
  });
}

export function pythonRuntimeStatus() {
  return invoke<PythonRuntimeStatus>("python_runtime_status");
}

/// The `.venv` status for a workspace folder.
export function pythonEnvStatus(workspaceRoot: string) {
  return invoke<PythonEnvStatus>("python_env_status", { workspaceRoot });
}

/// Create (or reuse) the workspace's `.venv`. Progress streams on
/// `python-env-output`.
export function pythonEnvCreate(workspaceRoot: string) {
  return invoke<PythonRunResult>("python_env_create", { workspaceRoot });
}

/// Packages installed in the workspace's `.venv` (empty when none exists).
export function pythonPackagesList(workspaceRoot: string) {
  return invoke<InstalledPackage[]>("python_packages_list", { workspaceRoot });
}

/// Install packages into the workspace's `.venv`. Progress streams on
/// `python-env-output`.
export function pythonPackagesInstall(
  workspaceRoot: string,
  packages: string[],
) {
  return invoke<PythonRunResult>("python_packages_install", {
    workspaceRoot,
    packages,
  });
}

/// Uninstall packages from the workspace's `.venv`. Progress streams on
/// `python-env-output`.
export function pythonPackagesUninstall(
  workspaceRoot: string,
  packages: string[],
) {
  return invoke<PythonRunResult>("python_packages_uninstall", {
    workspaceRoot,
    packages,
  });
}

export function pythonLspDocumentOpen(uri: string, text: string) {
  return invoke<void>("python_lsp_document_open", { uri, text });
}

export function pythonLspDocumentChange(uri: string, text: string) {
  return invoke<void>("python_lsp_document_change", { uri, text });
}

export function pythonLspDocumentClose(uri: string) {
  return invoke<void>("python_lsp_document_close", { uri });
}

export function pythonLspHover(uri: string, line: number, character: number) {
  return invoke<LspHover>("python_lsp_hover", { uri, line, character });
}

export function pythonLspCompletions(
  uri: string,
  line: number,
  character: number,
) {
  return invoke<LspCompletionList | LspCompletionItem[] | null>(
    "python_lsp_completions",
    { uri, line, character },
  );
}

export function pythonLspDefinition(
  uri: string,
  line: number,
  character: number,
) {
  return invoke<LspDefinitionResult>("python_lsp_definition", {
    uri,
    line,
    character,
  });
}

export function pythonLspReferences(
  uri: string,
  line: number,
  character: number,
) {
  return invoke<LspReferencesResult>("python_lsp_references", {
    uri,
    line,
    character,
  });
}

export function pythonLspDocumentSymbols(uri: string) {
  return invoke<LspDocumentSymbol[] | null>("python_lsp_document_symbols", {
    uri,
  });
}

export function pythonLspDiagnostics(uri: string) {
  return invoke<LspDiagnostic[] | null>("python_lsp_diagnostics", { uri });
}

export function onPythonRunOutput(
  callback: (output: PythonRunOutput) => void,
): Promise<UnlistenFn> {
  return listen<PythonRunOutput>("python-run-output", (event) =>
    callback(event.payload),
  );
}

export function onPythonEnvOutput(
  callback: (output: PythonEnvOutput) => void,
): Promise<UnlistenFn> {
  return listen<PythonEnvOutput>("python-env-output", (event) =>
    callback(event.payload),
  );
}

export function onPythonDiagnostics(
  callback: (event: PythonDiagnosticsEvent) => void,
): Promise<UnlistenFn> {
  return listen<PythonDiagnosticsEvent>("python-diagnostics", (event) =>
    callback(event.payload),
  );
}

/// A proposed edit the agent's `edit` tool emitted: replace `oldText` with
/// `newText` in the document at `uri`. The webview locates `oldText` in the live
/// Monaco model (the source of truth) and applies it as a pending inline diff.
/// `mode` is the turn's autonomy: in "agentic" the diff is auto-accepted.
export type AgentEditorEdit = {
  uri: string;
  oldText: string;
  newText: string;
  toolUseId?: string | null;
  mode?: AgentMode;
};

export function onAgentEditorEdit(
  callback: (edit: AgentEditorEdit) => void,
): Promise<UnlistenFn> {
  return listen<AgentEditorEdit>("agent-editor-edit", (event) =>
    callback(event.payload),
  );
}
