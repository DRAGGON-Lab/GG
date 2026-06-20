import type {
  McpServerInput,
  McpServerView,
  McpTransport,
} from "@/features/settings/mcp-service";

export type ServerDraft = {
  id: string | null;
  name: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  autoAllowTools: boolean;
};

export function emptyDraft(): ServerDraft {
  return {
    id: null,
    name: "",
    transport: "stdio",
    command: "",
    argsText: "",
    envText: "",
    url: "",
    headersText: "",
    autoAllowTools: false,
  };
}

export function draftFromServer(server: McpServerView): ServerDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    argsText: server.args.join(" "),
    envText: pairsToText(server.env, "="),
    url: server.url,
    headersText: pairsToText(server.headers, ": "),
    autoAllowTools: server.autoAllowTools,
  };
}

export function draftToInput(draft: ServerDraft): McpServerInput {
  const isStdio = draft.transport === "stdio";
  return {
    id: draft.id ?? undefined,
    name: draft.name.trim(),
    transport: draft.transport,
    command: isStdio ? draft.command.trim() : "",
    args: isStdio ? draft.argsText.split(/\s+/).filter(Boolean) : [],
    env: isStdio ? parsePairs(draft.envText, "=") : {},
    url: isStdio ? "" : draft.url.trim(),
    headers: isStdio ? {} : parsePairs(draft.headersText, ":"),
    autoAllowTools: draft.autoAllowTools,
  };
}

function parsePairs(text: string, separator: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const index = trimmed.indexOf(separator);
    if (index <= 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + separator.length).trim();
    if (key) {
      pairs[key] = value;
    }
  }
  return pairs;
}

function pairsToText(pairs: Record<string, string>, separator: string) {
  return Object.entries(pairs)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");
}
