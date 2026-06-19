//! The agent loop: stream a model turn, emit its blocks, and if it requested tools,
//! execute them in-process (capabilities) — gated by permission for write tools —
//! append the results, and repeat until the model ends the turn. Server-side
//! compaction keeps long sessions within the context window.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use bioeng_agent::{
    collect_stream, AgentClient, AgentMessage, ContentBlock, Message, PermissionPrompt,
    SessionMessageNotification, StreamDelta, StreamRequest, Usage,
};
use bioeng_data::Database;

use super::{
    agents::AgentDefinition, capabilities, config, memory, prompt, state::AgentState, tools,
};
use crate::secrets::{types::AiProviderCommandError, KeychainSecretStore};

pub async fn run(
    app: AppHandle,
    conversation_id: String,
    task_id: u64,
    agent: &'static AgentDefinition,
    mut messages: Vec<Message>,
) {
    // The freshly-pushed user message is last in the history; everything from here
    // on is the new exchange the memory deriver reasons over after the turn ends.
    let derivation_start = messages.len().saturating_sub(1);
    // Resolve the Anthropic API key from the OS keychain and build a client that
    // talks to the provider directly. A missing key surfaces as `credentialMissing`.
    let client = match config::resolve_credential(&*app.state::<KeychainSecretStore>()).and_then(
        |credential| AgentClient::new(credential).map_err(AiProviderCommandError::provider_error),
    ) {
        Ok(client) => client,
        Err(error) => {
            return finish_error_with(&app, &conversation_id, task_id, error, messages, Vec::new())
        }
    };

    let tools = tools::assemble_tools(&app, agent).await;
    let system = prompt::build_system_prompt(&app, agent);
    let mut total = Usage::default();
    let mut transcript_blocks = Vec::new();

    for _turn in 0..agent.max_turns {
        let request = StreamRequest {
            model: agent.model,
            max_tokens: agent.max_tokens,
            system: &system,
            tools: tools.clone(),
            messages: &messages,
            effort: agent.effort,
            thinking: agent.thinking,
            compaction: true,
        };

        let response = match client.send(&request).await {
            Ok(response) => response,
            Err(error) => {
                return finish_error(
                    &app,
                    &conversation_id,
                    task_id,
                    error,
                    messages,
                    transcript_blocks,
                )
            }
        };

        // Stream text/thinking to the UI token-by-token as deltas arrive.
        let assembled = match collect_stream(response, |delta| match delta {
            StreamDelta::Init { model } => {
                emit(&app, &conversation_id, AgentMessage::Init { model })
            }
            StreamDelta::Text(chunk) => {
                emit(&app, &conversation_id, AgentMessage::Text { text: chunk })
            }
            StreamDelta::Thinking(chunk) => emit(
                &app,
                &conversation_id,
                AgentMessage::Thinking { text: chunk },
            ),
            _ => {}
        })
        .await
        {
            Ok(assembled) => assembled,
            Err(error) => {
                return finish_error(
                    &app,
                    &conversation_id,
                    task_id,
                    error,
                    messages,
                    transcript_blocks,
                )
            }
        };
        accumulate(&mut total, &assembled.usage);
        transcript_blocks.extend(transcript_blocks_from_content(&assembled.content));

        // Text/thinking already streamed above; surface tool calls with their full input.
        for block in &assembled.content {
            if let ContentBlock::ToolUse { id, name, input } = block {
                emit(
                    &app,
                    &conversation_id,
                    AgentMessage::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    },
                );
            }
        }
        messages.push(Message {
            role: "assistant".to_string(),
            content: assembled.content.clone(),
        });

        if assembled.stop_reason.as_deref() == Some("tool_use") {
            let mut results = Vec::new();
            for block in &assembled.content {
                if let ContentBlock::ToolUse { id, name, input } = block {
                    let auto_allowed = tools::auto_allow(name)
                        || (crate::mcp::is_mcp_tool(name)
                            && app
                                .state::<crate::mcp::McpRegistry>()
                                .auto_allow(name)
                                .await);
                    let allowed = auto_allowed
                        || request_permission(&app, &conversation_id, task_id, name, input).await;
                    let (value, is_error) = if !allowed {
                        (json!("The user denied this tool call."), true)
                    } else {
                        match execute_tool(&app, id, name, input).await {
                            Ok(value) => (value, false),
                            Err(error) => (json!(error), true),
                        }
                    };
                    let result_text = content_to_string(&value);
                    emit(
                        &app,
                        &conversation_id,
                        AgentMessage::ToolResult {
                            id: id.clone(),
                            content: result_text.clone(),
                            is_error,
                        },
                    );
                    transcript_blocks.push(json!({
                        "type": "toolResult",
                        "id": id,
                        "content": result_text,
                        "isError": is_error,
                    }));
                    results.push(ContentBlock::ToolResult {
                        tool_use_id: id.clone(),
                        content: result_text,
                        is_error: is_error.then_some(true),
                    });
                }
            }
            messages.push(Message {
                role: "user".to_string(),
                content: results,
            });
            continue;
        }

        let subtype = assembled
            .stop_reason
            .unwrap_or_else(|| "end_turn".to_string());
        if agent.use_memory && subtype == "end_turn" {
            memory::spawn_derivation(&app, &conversation_id, &messages[derivation_start..]);
        }
        let cost_usd = estimate_cost(agent.model, &total);
        emit(
            &app,
            &conversation_id,
            AgentMessage::Result {
                is_error: subtype == "refusal",
                cost_usd: Some(cost_usd),
                subtype: subtype.clone(),
            },
        );
        finish_done(
            &app,
            &conversation_id,
            task_id,
            messages,
            Some(ai_payload(
                task_id,
                transcript_blocks,
                Some(subtype),
                Some(cost_usd),
            )),
        );
        return;
    }

    let cost_usd = estimate_cost(agent.model, &total);
    emit(
        &app,
        &conversation_id,
        AgentMessage::Result {
            subtype: "max_turns".to_string(),
            is_error: false,
            cost_usd: Some(cost_usd),
        },
    );
    finish_done(
        &app,
        &conversation_id,
        task_id,
        messages,
        Some(ai_payload(
            task_id,
            transcript_blocks,
            Some("max_turns".to_string()),
            Some(cost_usd),
        )),
    );
}

fn finish_error(
    app: &AppHandle,
    conversation_id: &str,
    task_id: u64,
    error: String,
    messages: Vec<Message>,
    transcript_blocks: Vec<Value>,
) {
    finish_error_with(
        app,
        conversation_id,
        task_id,
        AiProviderCommandError::provider_error(error),
        messages,
        transcript_blocks,
    );
}

fn finish_error_with(
    app: &AppHandle,
    conversation_id: &str,
    task_id: u64,
    error: AiProviderCommandError,
    messages: Vec<Message>,
    mut transcript_blocks: Vec<Value>,
) {
    emit(
        app,
        conversation_id,
        AgentMessage::Error {
            code: Some(error.code.as_str().to_string()),
            message: error.message.clone(),
        },
    );
    transcript_blocks.push(json!({ "type": "text", "text": error.message }));
    finish_done(
        app,
        conversation_id,
        task_id,
        messages,
        Some(ai_payload(
            task_id,
            transcript_blocks,
            Some("error".to_string()),
            None,
        )),
    );
}

fn finish_done(
    app: &AppHandle,
    conversation_id: &str,
    task_id: u64,
    messages: Vec<Message>,
    ai_transcript_payload: Option<Value>,
) {
    if let Err(error) = persist_conversation(app, conversation_id, &messages, ai_transcript_payload)
    {
        emit(
            app,
            conversation_id,
            AgentMessage::Error {
                code: None,
                message: format!("Could not persist AI conversation: {error}"),
            },
        );
    }
    let state = app.state::<AgentState>();
    state.set_history(conversation_id, messages);
    state.clear_task(conversation_id, task_id);
    emit(app, conversation_id, AgentMessage::Done);
}

pub(super) fn emit(app: &AppHandle, conversation_id: &str, message: AgentMessage) {
    let _ = app.emit(
        "agent-message",
        SessionMessageNotification {
            conversation_id: conversation_id.to_string(),
            message,
        },
    );
}

/// Run a tool's capability off the async worker — capability dispatch makes blocking
/// synchronous calls into app state, so it must not stall the runtime.
async fn execute_tool(
    app: &AppHandle,
    tool_use_id: &str,
    tool_name: &str,
    input: &Value,
) -> Result<Value, String> {
    // MCP tools run over the network/child process from the registry — async, not
    // blocking — so route them before the in-process capability dispatch.
    if crate::mcp::is_mcp_tool(tool_name) {
        return app
            .state::<crate::mcp::McpRegistry>()
            .call_tool(tool_name, input)
            .await;
    }
    let capability = tools::capability_for(tool_name)
        .ok_or_else(|| format!("Unknown tool: {tool_name}"))?
        .to_string();
    let app = app.clone();
    let input = input.clone();
    let tool_use_id = tool_use_id.to_string();
    tokio::task::spawn_blocking(move || {
        capabilities::dispatch(&app, &capability, &input, &tool_use_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn request_permission(
    app: &AppHandle,
    conversation_id: &str,
    task_id: u64,
    tool_name: &str,
    input: &Value,
) -> bool {
    let (sender, receiver) = oneshot::channel();
    let request_id = app
        .state::<AgentState>()
        .park_permission(conversation_id, task_id, sender);
    let _ = app.emit(
        "agent-permission-request",
        PermissionPrompt {
            request_id,
            conversation_id: conversation_id.to_string(),
            tool_name: tool_name.to_string(),
            input: input.clone(),
        },
    );
    receiver.await.unwrap_or(false)
}

fn persist_conversation(
    app: &AppHandle,
    conversation_id: &str,
    messages: &[Message],
    ai_transcript_payload: Option<Value>,
) -> Result<(), String> {
    let database = app.state::<Database>();
    let model_messages = messages
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    database.replace_ai_model_messages(conversation_id, &model_messages)?;
    if let Some(payload) = ai_transcript_payload {
        database
            .append_ai_transcript_entry(conversation_id, "assistant", &payload)?
            .ok_or_else(|| format!("Unknown AI conversation: {conversation_id}"))?;
    }
    Ok(())
}

fn ai_payload(
    task_id: u64,
    blocks: Vec<Value>,
    subtype: Option<String>,
    cost_usd: Option<f64>,
) -> Value {
    json!({
        "role": "assistant",
        "id": format!("ai-{task_id}"),
        "blocks": blocks,
        "subtype": subtype,
        "costUsd": cost_usd,
        "done": true,
    })
}

fn transcript_blocks_from_content(content: &[ContentBlock]) -> Vec<Value> {
    content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(json!({ "type": "text", "text": text })),
            ContentBlock::Thinking { thinking, .. } => {
                Some(json!({ "type": "thinking", "text": thinking }))
            }
            ContentBlock::ToolUse { id, name, input } => Some(json!({
                "type": "toolUse",
                "id": id,
                "name": name,
                "input": input,
            })),
            ContentBlock::ToolResult { .. } => None,
        })
        .collect()
}

fn content_to_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn accumulate(total: &mut Usage, usage: &Usage) {
    total.input_tokens += usage.input_tokens;
    total.output_tokens += usage.output_tokens;
    total.cache_creation_input_tokens += usage.cache_creation_input_tokens;
    total.cache_read_input_tokens += usage.cache_read_input_tokens;
}

fn estimate_cost(model: &str, usage: &Usage) -> f64 {
    let (input_price, output_price) = price_per_million(model);
    (usage.input_tokens as f64 * input_price
        + usage.output_tokens as f64 * output_price
        + usage.cache_read_input_tokens as f64 * input_price * 0.1
        + usage.cache_creation_input_tokens as f64 * input_price * 1.25)
        / 1_000_000.0
}

fn price_per_million(model: &str) -> (f64, f64) {
    if model.starts_with("claude-opus") {
        (5.0, 25.0)
    } else if model.starts_with("claude-sonnet") {
        (3.0, 15.0)
    } else {
        (1.0, 5.0)
    }
}
