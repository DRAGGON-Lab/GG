//! The capability registry: the only surface through which the AI touches app state.
//! Each capability resolves in-process against the live subsystems.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use bioeng_data::Database;

pub fn dispatch(
    app: &AppHandle,
    capability: &str,
    args: &Value,
    tool_use_id: &str,
) -> Result<Value, String> {
    match capability {
        "editor.edit" => editor_edit(app, args, tool_use_id),
        "skills.load" => crate::skills::capability_load(app, args),
        "memory.search" => {
            let query = require_str(args, "query", "memory.search")?;
            let database = app.state::<Database>();
            database.search_ai_memory(query, 12).and_then(to_value)
        }
        other => Err(format!("Unknown capability: {other}")),
    }
}

/// Propose an edit to an open document. The buffer's source of truth is the
/// editor's Monaco model in the webview, so rather than match `oldText` here we
/// emit it for the webview to locate and apply as a pending inline diff
/// (Cursor-style apply-then-review). `tool_use_id` lets the webview correlate
/// the change back to this tool call. Write tool, but every character lands as a
/// proposed change the user accepts or rejects.
fn editor_edit(app: &AppHandle, args: &Value, tool_use_id: &str) -> Result<Value, String> {
    let uri = require_str(args, "uri", "editor.edit")?;
    let old_text = require_str(args, "oldText", "editor.edit")?;
    let new_text = require_str(args, "newText", "editor.edit")?;

    if old_text.is_empty() {
        return Err("editor.edit `oldText` must not be empty. To insert text, include surrounding context in oldText and put it (plus the new text) in newText.".to_string());
    }

    app.emit(
        "agent-editor-edit",
        json!({
            "uri": uri,
            "oldText": old_text,
            "newText": new_text,
            "toolUseId": tool_use_id,
        }),
    )
    .map_err(|error| error.to_string())?;

    Ok(json!({ "applied": true }))
}

fn require_str<'a>(args: &'a Value, key: &str, capability: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{capability} requires `{key}`"))
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}
