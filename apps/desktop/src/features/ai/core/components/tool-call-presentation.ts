const TOOL_LABELS: Record<string, string> = {
  skill: "Load skill",
  memory_search: "Search memory",
  edit: "Edit",
  read_file: "Read",
  list_dir: "List files",
  create_file: "Create file",
  delete_path: "Delete",
  move_path: "Move",
  create_dir: "Create folder",
};

export type ToolCallState = "done" | "error" | "running";

export type ToolPresentation = {
  detail: string;
  label: string;
  name: string;
  preview: string;
  /// The MCP server a tool came from, for tools namespaced `mcp__{server}__{tool}`.
  /// `null` for built-in tools.
  server: string | null;
};

export function toolPresentation(
  toolName: string,
  input: unknown,
): ToolPresentation {
  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    return {
      detail: mcp.tool,
      label: humanizeToolName(mcp.tool),
      name: toolName,
      preview: toolInputPreview(input),
      server: mcp.server,
    };
  }
  const name = normalizeToolName(toolName);
  return {
    detail: name,
    label: TOOL_LABELS[name] ?? humanizeToolName(name),
    name,
    preview: toolInputPreview(input),
    server: null,
  };
}

/// Parse a `mcp__{server}__{tool}` name. The built-in `gg` server is
/// presented as a normal tool, so it is excluded here.
function parseMcpToolName(name: string) {
  if (!name.startsWith("mcp__") || name.startsWith("mcp__gg__")) {
    return null;
  }
  const rest = name.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator <= 0) {
    return null;
  }
  return {
    server: rest.slice(0, separator),
    tool: rest.slice(separator + 2),
  };
}

export function toolStatusLabel(state: ToolCallState) {
  if (state === "running") {
    return "running";
  }
  return state === "error" ? "error" : "ok";
}

export function safeStringify(value: unknown, pretty = false): string {
  try {
    return JSON.stringify(value, null, pretty ? 2 : 0) ?? String(value);
  } catch {
    return String(value);
  }
}

function normalizeToolName(name: string) {
  return name.replace(/^mcp__gg__/, "");
}

function humanizeToolName(name: string) {
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function toolInputPreview(input: unknown) {
  if (!isRecord(input)) {
    return compact(safeStringify(input));
  }

  const query = stringField(input, "query");
  if (query) {
    return compact(query);
  }

  const from = stringField(input, "from");
  const to = stringField(input, "to");
  if (from && to) {
    return `${basename(from)} → ${basename(to)}`;
  }

  const uri = stringField(input, "uri");
  const filePath = stringField(input, "filePath") ?? stringField(input, "path");
  const location = uri ?? filePath;
  if (location) {
    const line = numberField(input, "line");
    const suffix = typeof line === "number" ? `:${line + 1}` : "";
    return `${basename(location)}${suffix}`;
  }

  const startLine = numberField(input, "startLine");
  const endLine = numberField(input, "endLine");
  if (typeof startLine === "number") {
    const range =
      typeof endLine === "number" && endLine !== startLine
        ? `${startLine + 1}-${endLine + 1}`
        : `${startLine + 1}`;
    return `lines ${range}`;
  }

  return compact(safeStringify(input));
}

function basename(pathOrUri: string) {
  const withoutQuery = pathOrUri.split("?")[0] ?? pathOrUri;
  const withoutHash = withoutQuery.split("#")[0] ?? withoutQuery;
  const decoded = decodePath(withoutHash.replace(/^file:\/\//, ""));
  return decoded.split("/").filter(Boolean).pop() ?? decoded;
}

function decodePath(pathOrUri: string) {
  try {
    return decodeURIComponent(pathOrUri);
  } catch {
    return pathOrUri;
  }
}

function compact(value: string) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 96 ? `${oneLine.slice(0, 95)}...` : oneLine;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
