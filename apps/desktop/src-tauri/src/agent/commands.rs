use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

use bioeng_agent::{
    AgentMessage, Message, PermissionBehavior, PromptContextAttachment, PromptRequest,
};
use bioeng_data::Database;

use super::{agents, conversation, state::AgentState};
use crate::secrets::types::AiProviderCommandError;

#[tauri::command]
pub fn agent_send(
    app: AppHandle,
    state: State<'_, AgentState>,
    database: State<'_, Database>,
    request: PromptRequest,
) -> Result<(), AiProviderCommandError> {
    let agent = agents::agent(&request.agent_id)
        .ok_or_else(|| format!("Unknown agent: {}", request.agent_id))?;

    if !database.ai_conversation_exists(&request.conversation_id)? {
        return Err(format!("Unknown AI conversation: {}", request.conversation_id).into());
    }

    let model_messages = database.load_ai_model_messages(&request.conversation_id)?;
    let mut history = model_messages
        .into_iter()
        .map(|message| {
            serde_json::from_value::<Message>(message).map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    history.push(build_user_message(&request));

    let conversation_id = request.conversation_id.clone();
    let task_id = state.start_task(&conversation_id);
    database
        .append_ai_transcript_entry(
            &conversation_id,
            "user",
            &json!({
                "role": "user",
                "id": format!("user-{task_id}"),
                "text": request.prompt.clone(),
                "contextAttachments": request.context_attachments.clone(),
            }),
        )?
        .ok_or_else(|| format!("Unknown AI conversation: {conversation_id}"))?;
    state.set_history(&conversation_id, history.clone());

    let app_for_task = app.clone();
    let task_conversation_id = conversation_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        conversation::run(app_for_task, task_conversation_id, task_id, agent, history).await;
    });
    state.attach_task(&conversation_id, task_id, task);
    Ok(())
}

#[tauri::command]
pub fn agent_interrupt(
    app: AppHandle,
    state: State<'_, AgentState>,
    database: State<'_, Database>,
    conversation_id: String,
) -> Result<(), AiProviderCommandError> {
    if state.abort(&conversation_id) {
        let history = state.history(&conversation_id);
        let model_messages = history
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        database.replace_ai_model_messages(&conversation_id, &model_messages)?;
        database
            .append_ai_transcript_entry(
                &conversation_id,
                "assistant",
                &json!({
                    "role": "assistant",
                    "id": format!("ai-interrupted-{}", timestamp_millis()),
                    "blocks": [{ "type": "text", "text": "Interrupted." }],
                    "subtype": "interrupted",
                    "done": true,
                }),
            )?
            .ok_or_else(|| format!("Unknown AI conversation: {conversation_id}"))?;
        conversation::emit(
            &app,
            &conversation_id,
            AgentMessage::Result {
                subtype: "interrupted".to_string(),
                is_error: false,
                cost_usd: None,
            },
        );
        conversation::emit(&app, &conversation_id, AgentMessage::Done);
    }
    Ok(())
}

#[tauri::command]
pub fn agent_respond_permission(
    state: State<'_, AgentState>,
    request_id: String,
    behavior: PermissionBehavior,
    message: Option<String>,
) -> Result<(), AiProviderCommandError> {
    let _ = message;
    state.resolve_permission(&request_id, matches!(behavior, PermissionBehavior::Allow));
    Ok(())
}

/// Fold explicit workspace attachments into the user message so the agent knows
/// which URI, position, paper, or library scope to pass to its tools.
fn build_user_message(request: &PromptRequest) -> Message {
    let context_lines: Vec<String> = request
        .context_attachments
        .iter()
        .map(render_context_attachment)
        .collect();
    let header = if context_lines.is_empty() {
        String::new()
    } else {
        format!("Context:\n{}\n\n", context_lines.join("\n"))
    };
    Message::user_text(format!("{header}{}", request.prompt))
}

fn render_context_attachment(attachment: &PromptContextAttachment) -> String {
    let mut fields = Vec::new();
    fields.push(format!("{} ({})", attachment.label, attachment.kind));

    if let Some(path) = attachment
        .payload
        .get("filePath")
        .or_else(|| attachment.payload.get("path"))
        .and_then(Value::as_str)
    {
        fields.push(format!("file: {path}"));
    }
    if let Some(uri) = attachment.payload.get("uri").and_then(Value::as_str) {
        fields.push(format!("uri: {uri}"));
    }
    if let (Some(line), Some(character)) = (
        attachment.payload.get("line").and_then(Value::as_u64),
        attachment.payload.get("character").and_then(Value::as_u64),
    ) {
        fields.push(format!(
            "cursor: line {line}, character {character} (0-based)"
        ));
    }
    if fields.len() == 1 && attachment.payload.is_object() {
        fields.push(format!("payload: {}", attachment.payload));
    }

    let summary = fields.join(" | ");

    // When the attachment carries the file's content, fold it in verbatim so the
    // agent can copy an exact snippet for the `edit` tool without a round-trip.
    if let Some(text) = attachment.payload.get("text").and_then(Value::as_str) {
        format!("{summary}\n```\n{text}\n```")
    } else {
        summary
    }
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
