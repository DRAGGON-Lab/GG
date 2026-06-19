/// The webview half of the agent's filesystem tools. It listens for the host's
/// `agent-workspace-request` events, runs each operation against the open
/// workspace — reads come from the live Monaco buffer or disk, writes and new
/// files surface as proposed changes, destructive ops (already approved by the
/// host when in Review mode) run directly — and resolves the parked request with
/// the tool result. Every path is confined to the open workspace root.
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {
  agentRespondWorkspaceRequest,
  onAgentWorkspaceRequest,
} from "@/features/ai/core/agent-client";
import {
  getEditorWorkspaceDelegates,
  proposeCreatedFile,
} from "@/features/editor/core/agent-edit-applier";

type WorkspaceArgs = Record<string, unknown>;

/// One level deeper than the explorer's default so the agent can see nested
/// packages without a second call, but bounded so a deep tree can't flood the
/// model's context.
const LIST_DIR_MAX_DEPTH = 4;
const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".venv",
  "__pycache__",
  "node_modules",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
]);

type ListedEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: ListedEntry[];
};

let bridgeInitialized = false;
let unlisten: Promise<UnlistenFn> | null = null;

/// Idempotent: wire the workspace-request listener once (module-scope guard, so
/// it survives StrictMode double-mount and dockview remounts).
export function initWorkspaceBridge() {
  if (bridgeInitialized) {
    return;
  }
  bridgeInitialized = true;

  unlisten = onAgentWorkspaceRequest((request) => {
    void handleRequest(
      request.requestId,
      request.op,
      request.args,
      request.mode,
    );
  });
}

export function disposeWorkspaceBridge() {
  void unlisten?.then((dispose) => dispose());
  unlisten = null;
  bridgeInitialized = false;
}

async function handleRequest(
  requestId: string,
  op: string,
  rawArgs: unknown,
  mode: string,
) {
  try {
    const result = await runOp(op, asArgs(rawArgs), mode);
    await agentRespondWorkspaceRequest(requestId, result, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await agentRespondWorkspaceRequest(requestId, message, true);
  }
}

async function runOp(
  op: string,
  args: WorkspaceArgs,
  mode: string,
): Promise<unknown> {
  const root = getEditorWorkspaceDelegates()?.getWorkspaceRoot() ?? null;
  if (!root) {
    throw new Error(
      "No workspace is open. Ask the user to open a folder before using file tools.",
    );
  }

  switch (op) {
    case "read_file":
      return readFileOp(root, args);
    case "list_dir":
      return listDirOp(root, args);
    case "create_file":
      return createFileOp(root, args, mode);
    case "delete_path":
      return deletePathOp(root, args);
    case "move_path":
      return movePathOp(root, args);
    case "create_dir":
      return createDirOp(root, args);
    default:
      throw new Error(`Unknown workspace operation: ${op}`);
  }
}

async function readFileOp(root: string, args: WorkspaceArgs): Promise<string> {
  const rel = requireString(args, "path");
  const abs = resolveWithinRoot(root, rel);
  const delegates = getEditorWorkspaceDelegates();
  // The live buffer is the source of truth when the file is open — it reflects
  // unsaved edits and pending proposed changes the agent should see.
  const open =
    delegates?.getOpenDocument(fileUriFor(abs)) ??
    delegates?.getOpenDocument(abs) ??
    null;
  if (open) {
    return open.text;
  }
  return readTextFile(abs);
}

async function listDirOp(
  root: string,
  args: WorkspaceArgs,
): Promise<{ path: string; entries: ListedEntry[] }> {
  const rel = optionalString(args, "path") ?? "";
  const abs = resolveWithinRoot(root, rel);
  const entries = await listTree(abs, root, 0);
  return { path: rel, entries };
}

async function createFileOp(
  root: string,
  args: WorkspaceArgs,
  mode: string,
): Promise<{ created: true; path: string; review: "pending" | "applied" }> {
  const rel = requireString(args, "path");
  const content = requireString(args, "content");
  const abs = resolveWithinRoot(root, rel);

  if (await exists(abs)) {
    throw new Error(
      `${rel} already exists. Use the edit tool to change an existing file.`,
    );
  }

  // Ensure the parent directory exists so accepting the change (or the agentic
  // write) can land the file.
  const parent = dirname(abs);
  if (parent && parent !== abs) {
    await mkdir(parent, { recursive: true });
  }

  const agentic = mode === "agentic";
  const changeId = await proposeCreatedFile({
    uri: fileUriFor(abs),
    path: abs,
    content,
    autoAccept: agentic,
  });
  if (!changeId) {
    throw new Error(`Could not open a buffer to create ${rel}.`);
  }

  return { created: true, path: rel, review: agentic ? "applied" : "pending" };
}

async function deletePathOp(
  root: string,
  args: WorkspaceArgs,
): Promise<{ deleted: true; path: string }> {
  const rel = requireString(args, "path");
  const abs = resolveWithinRoot(root, rel);

  if (!(await exists(abs))) {
    throw new Error(`${rel} does not exist.`);
  }

  const delegates = getEditorWorkspaceDelegates();
  delegates?.closeDocument(fileUriFor(abs));
  delegates?.closeDocument(abs);

  await remove(abs, { recursive: true });
  return { deleted: true, path: rel };
}

async function movePathOp(
  root: string,
  args: WorkspaceArgs,
): Promise<{ moved: true; from: string; to: string }> {
  const fromRel = requireString(args, "from");
  const toRel = requireString(args, "to");
  const fromAbs = resolveWithinRoot(root, fromRel);
  const toAbs = resolveWithinRoot(root, toRel);

  if (!(await exists(fromAbs))) {
    throw new Error(`${fromRel} does not exist.`);
  }
  if (await exists(toAbs)) {
    throw new Error(`${toRel} already exists.`);
  }

  const parent = dirname(toAbs);
  if (parent && parent !== toAbs) {
    await mkdir(parent, { recursive: true });
  }

  const delegates = getEditorWorkspaceDelegates();
  delegates?.closeDocument(fileUriFor(fromAbs));
  delegates?.closeDocument(fromAbs);

  await rename(fromAbs, toAbs);
  return { moved: true, from: fromRel, to: toRel };
}

async function createDirOp(
  root: string,
  args: WorkspaceArgs,
): Promise<{ created: true; path: string }> {
  const rel = requireString(args, "path");
  const abs = resolveWithinRoot(root, rel);
  await mkdir(abs, { recursive: true });
  return { created: true, path: rel };
}

async function listTree(
  abs: string,
  root: string,
  depth: number,
): Promise<ListedEntry[]> {
  const dirEntries = await readDir(abs);
  const entries: ListedEntry[] = [];

  for (const entry of dirEntries) {
    const isDirectory = entry.isDirectory;
    if (isDirectory && IGNORED_DIR_NAMES.has(entry.name)) {
      continue;
    }
    if (entry.name.startsWith(".") && isDirectory) {
      continue;
    }

    const childAbs = joinPath(abs, entry.name);
    const node: ListedEntry = {
      name: entry.name,
      path: relativeToRoot(root, childAbs),
      isDirectory,
    };
    if (isDirectory && depth + 1 < LIST_DIR_MAX_DEPTH) {
      node.children = await listTree(childAbs, root, depth + 1);
    }
    entries.push(node);
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return entries;
}

// --- path helpers (workspace-confined, POSIX) ---

function fileUriFor(path: string): string {
  return monaco.Uri.file(path).toString();
}

function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) {
    return rel;
  }
  return `${base.replace(/\/+$/, "")}/${rel}`;
}

function normalizeAbsolute(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return `/${out.join("/")}`;
}

/// Resolve a (relative or absolute) path against the workspace root and reject
/// anything that escapes it — the agent must not touch files outside the open
/// workspace, even though the fs plugin's scope is broader.
function resolveWithinRoot(root: string, path: string): string {
  const normalizedRoot = normalizeAbsolute(root);
  const abs = normalizeAbsolute(joinPath(normalizedRoot, path));
  if (abs !== normalizedRoot && !abs.startsWith(`${normalizedRoot}/`)) {
    throw new Error(
      `Path "${path}" is outside the workspace. Only paths within the open workspace are allowed.`,
    );
  }
  return abs;
}

function relativeToRoot(root: string, abs: string): string {
  const normalizedRoot = normalizeAbsolute(root);
  if (abs === normalizedRoot) {
    return "";
  }
  return abs.startsWith(`${normalizedRoot}/`)
    ? abs.slice(normalizedRoot.length + 1)
    : abs;
}

function dirname(abs: string): string {
  const index = abs.lastIndexOf("/");
  return index <= 0 ? "/" : abs.slice(0, index);
}

// --- arg helpers ---

function asArgs(raw: unknown): WorkspaceArgs {
  return raw && typeof raw === "object" ? (raw as WorkspaceArgs) : {};
}

function requireString(args: WorkspaceArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Missing required \`${key}\` argument.`);
  }
  return value;
}

function optionalString(args: WorkspaceArgs, key: string): string | null {
  const value = args[key];
  return typeof value === "string" ? value : null;
}

// The bridge owns a singleton Tauri listener that does not transfer across a hot
// swap; reload so an edit to this file lands clean and the old listener is gone.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
  import.meta.hot.dispose(() => {
    disposeWorkspaceBridge();
  });
}
