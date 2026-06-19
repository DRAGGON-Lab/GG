//! Tool registry: the API-facing schema for each tool, the capability it maps to, and
//! its permission policy. Adding an in-process tool = add a `ToolSpec` + a Rust
//! capability arm in `capabilities::dispatch`. Adding a webview-executed filesystem
//! tool = add a `ToolSpec` with `Execution::Webview` + an `op` arm in the webview's
//! `workspace-bridge`.

use serde_json::{json, Value};

/// How the agent loop runs a tool once it is allowed.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Execution {
    /// Resolved in-process by `capabilities::dispatch` (which may itself emit an
    /// editor event, as `edit` does).
    Capability,
    /// Round-tripped to the webview over the `agent-workspace-request` channel and
    /// executed there against the open workspace.
    Webview,
}

/// Whether and how a tool call is gated before it runs.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ToolPolicy {
    /// Always allowed, never blocks, no review (reads, skill, memory).
    Auto,
    /// Applied optimistically and surfaced as a reviewable pending change; never
    /// blocks the loop. The webview auto-accepts it when the mode is Agentic.
    ProposedChange,
    /// Destructive with no diff to show: blocks on a permission prompt in Review
    /// mode, runs without prompting in Agentic mode.
    Confirm,
}

pub struct ToolSpec {
    pub name: &'static str,
    pub capability: &'static str,
    pub policy: ToolPolicy,
    pub execution: Execution,
    pub description: &'static str,
    pub schema: fn() -> Value,
}

fn query_schema() -> Value {
    json!({ "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] })
}

fn skill_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "file": { "type": "string" },
        },
        "required": ["name"],
    })
}

fn edit_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "uri": { "type": "string", "description": "The file:// URI of the open document to edit (from the context attachment)." },
            "oldText": { "type": "string", "description": "Exact snippet to replace, copied verbatim from the file. Must occur exactly once — include surrounding context if needed." },
            "newText": { "type": "string", "description": "Replacement text for oldText." },
        },
        "required": ["uri", "oldText", "newText"],
    })
}

fn read_file_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Workspace-relative path of the file to read (e.g. `models/toggle.py`)." },
        },
        "required": ["path"],
    })
}

fn list_dir_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Workspace-relative directory to list. Omit or pass \"\" for the workspace root." },
        },
    })
}

fn create_file_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Workspace-relative path of the new file (e.g. `models/repressilator.py`). Parent directories are created as needed. Must not already exist." },
            "content": { "type": "string", "description": "Full contents of the new file." },
        },
        "required": ["path", "content"],
    })
}

fn delete_path_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Workspace-relative path of the file or directory to delete. Directories are removed recursively." },
        },
        "required": ["path"],
    })
}

fn move_path_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "from": { "type": "string", "description": "Workspace-relative source path." },
            "to": { "type": "string", "description": "Workspace-relative destination path. Parent directories are created as needed." },
        },
        "required": ["from", "to"],
    })
}

fn create_dir_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Workspace-relative directory to create (parents created as needed)." },
        },
        "required": ["path"],
    })
}

const SPECS: &[ToolSpec] = &[
    ToolSpec { name: "edit", capability: "editor.edit", policy: ToolPolicy::ProposedChange, execution: Execution::Capability, schema: edit_schema, description: "Replace an exact snippet of a file in the workspace: `oldText` (copied VERBATIM, with enough surrounding context that it occurs EXACTLY ONCE) becomes `newText`. No line/column counting — match by content. The edit applies to the editor buffer IMMEDIATELY as a pending inline diff (a \"proposed change\"); in Review mode the user accepts or rejects each one, in Agentic mode it is applied without review. Either way you never wait — keep working. Keep oldText to the SMALLEST unique snippet for one logical change so each diff reviews cleanly, and make one logical change per call. Pass the file:// `uri` from a context attachment, or the uri of a file you read with `read_file`. To insert text, include surrounding context in both oldText and newText. If the user rejects an edit, do not re-apply it — take a different approach." },
    ToolSpec { name: "read_file", capability: "", policy: ToolPolicy::Auto, execution: Execution::Webview, schema: read_file_schema, description: "Read a file in the workspace by its workspace-relative `path`. Returns the file's current text — the live editor buffer if it is open (including unsaved or pending-review changes), otherwise the contents on disk. Use this to inspect files that are not already attached to the conversation before editing them." },
    ToolSpec { name: "list_dir", capability: "", policy: ToolPolicy::Auto, execution: Execution::Webview, schema: list_dir_schema, description: "List the workspace's files and directories. Pass a workspace-relative `path` to list a subdirectory, or omit it for the workspace root. Returns a tree of entries (name, path, whether each is a directory). Use this to discover files before reading or editing them." },
    ToolSpec { name: "create_file", capability: "", policy: ToolPolicy::ProposedChange, execution: Execution::Webview, schema: create_file_schema, description: "Create a NEW file at a workspace-relative `path` with the given `content`. The new file opens as a proposed change (all-additions); in Review mode the user accepts or rejects it, in Agentic mode it is written immediately. Fails if the file already exists — use `edit` to change an existing file." },
    ToolSpec { name: "delete_path", capability: "", policy: ToolPolicy::Confirm, execution: Execution::Webview, schema: delete_path_schema, description: "Delete a file or directory (recursively) at a workspace-relative `path`. Destructive: in Review mode the user must approve it; in Agentic mode it runs immediately. Prefer deleting only files you created or the user named." },
    ToolSpec { name: "move_path", capability: "", policy: ToolPolicy::Confirm, execution: Execution::Webview, schema: move_path_schema, description: "Move or rename a file or directory from one workspace-relative path to another. Destructive: in Review mode the user must approve it; in Agentic mode it runs immediately." },
    ToolSpec { name: "create_dir", capability: "", policy: ToolPolicy::Confirm, execution: Execution::Webview, schema: create_dir_schema, description: "Create a directory (and any missing parents) at a workspace-relative `path`. In Review mode the user approves it; in Agentic mode it runs immediately." },
    ToolSpec { name: "skill", capability: "skills.load", policy: ToolPolicy::Auto, execution: Execution::Capability, schema: skill_schema, description: "Load the full instructions for a user-authored skill listed in your system prompt. Pass `file` to read a supporting file the skill's instructions reference." },
    ToolSpec { name: "memory_search", capability: "memory.search", policy: ToolPolicy::Auto, execution: Execution::Capability, schema: query_schema, description: "Full-text search over durable conclusions about the user accumulated across past sessions (their background, goals, preferences, projects, struggles, and conventions). Use when the task touches their history or ongoing work beyond what this conversation shows." },
];

/// Build the API `tools` array for the named tools.
pub fn tools_json(names: &[&str]) -> Value {
    let tools: Vec<Value> = SPECS
        .iter()
        .filter(|spec| names.contains(&spec.name))
        .map(|spec| {
            json!({
                "name": spec.name,
                "description": spec.description,
                "input_schema": (spec.schema)(),
            })
        })
        .collect();
    Value::Array(tools)
}

/// The full toolset for a turn: the agent's built-in tools, plus the live tools
/// from connected MCP servers when the agent opts into them.
pub async fn assemble_tools(
    app: &tauri::AppHandle,
    agent: &super::agents::AgentDefinition,
) -> Value {
    use tauri::Manager;

    let mut tools = match tools_json(agent.tool_names) {
        Value::Array(tools) => tools,
        _ => Vec::new(),
    };
    if agent.use_mcp {
        tools.extend(
            app.state::<crate::mcp::McpRegistry>()
                .tools_for_agent()
                .await,
        );
    }
    Value::Array(tools)
}

fn spec(tool_name: &str) -> Option<&'static ToolSpec> {
    SPECS.iter().find(|spec| spec.name == tool_name)
}

pub fn capability_for(tool_name: &str) -> Option<&'static str> {
    spec(tool_name).map(|spec| spec.capability)
}

pub fn policy(tool_name: &str) -> Option<ToolPolicy> {
    spec(tool_name).map(|spec| spec.policy)
}

/// True when the tool is executed by the webview over the workspace-request
/// channel rather than by in-process capability dispatch.
pub fn is_webview_tool(tool_name: &str) -> bool {
    spec(tool_name).is_some_and(|spec| spec.execution == Execution::Webview)
}
