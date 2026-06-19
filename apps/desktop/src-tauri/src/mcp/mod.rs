//! User-added MCP servers. The registry owns the live client connections (stdio
//! child processes and streamable-HTTP sessions), exposes their tools to the
//! workspace agent under the `mcp__{server}__{tool}` namespace, and routes the
//! agent's tool calls back to the owning server. Tool calls are gated by the same
//! permission flow as built-in write tools unless a server opts into auto-allow.

pub mod commands;
mod registry;

pub use registry::{spawn_initial_connect, McpRegistry};

/// Namespaced tool names are `mcp__{server}__{tool}`; this is the prefix the agent
/// loop matches on to route a call to the registry instead of a built-in capability.
pub const MCP_TOOL_PREFIX: &str = "mcp__";

pub fn is_mcp_tool(name: &str) -> bool {
    name.starts_with(MCP_TOOL_PREFIX)
}
