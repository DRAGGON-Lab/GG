import { invoke } from "@tauri-apps/api/core";
import { type Event, listen } from "@tauri-apps/api/event";

export type McpTransport = "stdio" | "http";

export type McpServerStatus =
  | { state: "disabled" }
  | { state: "connecting" }
  | { state: "connected"; toolCount: number }
  | { state: "error"; message: string };

export type McpServerView = {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  autoAllowTools: boolean;
  createdAt: string;
  updatedAt: string;
  status: McpServerStatus;
  tools: string[];
};

export type McpServerInput = {
  id?: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  autoAllowTools?: boolean;
};

const MCP_SERVERS_CHANGED_EVENT = "mcp-servers-changed";

export function listMcpServers() {
  return invoke<McpServerView[]>("mcp_servers_list");
}

export function saveMcpServer(input: McpServerInput) {
  return invoke<McpServerView[]>("mcp_server_save", { input });
}

export function toggleMcpServer(id: string, enabled: boolean) {
  return invoke<McpServerView[]>("mcp_server_toggle", { id, enabled });
}

export function reconnectMcpServer(id: string) {
  return invoke<McpServerView[]>("mcp_server_reconnect", { id });
}

export function deleteMcpServer(id: string) {
  return invoke<McpServerView[]>("mcp_server_delete", { id });
}

/// Subscribe to background status transitions (startup connects, reconnects).
export function onMcpServersChanged(handler: () => void) {
  return listen(MCP_SERVERS_CHANGED_EVENT, (_event: Event<unknown>) => {
    handler();
  });
}
