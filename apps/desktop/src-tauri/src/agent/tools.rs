//! Tool registry: the API-facing schema for each tool, the capability it maps to, and
//! its permission policy. Adding an app-backed tool = add a `ToolSpec` + a Rust
//! capability arm in `capabilities::dispatch`.

use serde_json::{json, Value};

pub struct ToolSpec {
    pub name: &'static str,
    pub capability: &'static str,
    pub auto_allow: bool,
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

const SPECS: &[ToolSpec] = &[
    ToolSpec { name: "edit", capability: "editor.edit", auto_allow: true, schema: edit_schema, description: "Replace an exact snippet of an open document: `oldText` (copied VERBATIM from the file shown in the context attachment, with enough surrounding context that it occurs EXACTLY ONCE) becomes `newText`. No line/column counting — match by content. The edit applies to the user's editor buffer IMMEDIATELY as a pending inline diff (a \"proposed change\") the user reviews and accepts or rejects — you never wait for approval, but every character is reviewed. Keep oldText to the SMALLEST unique snippet for one logical change so each diff reviews cleanly, and make one logical change per call. To insert text, include surrounding context in both oldText and newText. If the user rejects an edit, do not re-apply it — take a different approach." },
    ToolSpec { name: "skill", capability: "skills.load", auto_allow: true, schema: skill_schema, description: "Load the full instructions for a user-authored skill listed in your system prompt. Pass `file` to read a supporting file the skill's instructions reference." },
    ToolSpec { name: "memory_search", capability: "memory.search", auto_allow: true, schema: query_schema, description: "Full-text search over durable conclusions about the user accumulated across past sessions (their background, goals, preferences, projects, struggles, and conventions). Use when the task touches their history or ongoing work beyond what this conversation shows." },
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

pub fn capability_for(tool_name: &str) -> Option<&'static str> {
    SPECS
        .iter()
        .find(|spec| spec.name == tool_name)
        .map(|spec| spec.capability)
}

pub fn auto_allow(tool_name: &str) -> bool {
    SPECS
        .iter()
        .find(|spec| spec.name == tool_name)
        .map(|spec| spec.auto_allow)
        .unwrap_or(false)
}
