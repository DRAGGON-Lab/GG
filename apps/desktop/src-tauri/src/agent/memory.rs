//! Ambient memory deriver: after an agent finishes a turn, a background call to a
//! small model reasons over the new exchange against the current user representation
//! and emits add/update/invalidate operations — continual learning about the user,
//! never about the assistant. Failures are logged and never surface to the
//! transcript; a skipped derivation only means one exchange goes unmined.

use std::collections::HashSet;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use bioeng_agent::{collect_stream, AgentClient, ContentBlock, Message, StreamRequest};
use bioeng_data::{ai::AI_MEMORY_KINDS, Database};

use super::config;
use crate::secrets::{types::AiProviderCommandError, KeychainSecretStore};

const MEMORY_MODEL: &str = "claude-haiku-4-5";
/// Exchanges shorter than this rarely contain durable facts; skip the call.
const MIN_EXCHANGE_CHARS: usize = 240;
/// Hard cap on stored conclusions; `add` operations beyond it are dropped.
const MAX_ACTIVE_CONCLUSIONS: usize = 200;

const DERIVER_SYSTEM_PROMPT: &str = r#"You maintain durable memory about one biological engineer who uses an AI research workspace. From each conversation exchange you derive conclusions about the USER — never about the assistant. Kinds: background (their training in biology, engineering, and programming, and their level), goal (what they want to achieve), preference (how they like to work and be answered), project (what they are actively working on), struggle (what they find hard), convention (notation, style, and tooling habits).

You receive the current conclusions, each as `[id] (kind, confidence) content`, followed by the new exchange. Respond with ONLY a JSON array of operations, no prose:
- {"op":"add","kind":"...","content":"...","confidence":0.0-1.0} — a genuinely new durable conclusion
- {"op":"update","id":"...","content":"...","confidence":0.0-1.0} — new information that refines or supersedes an existing conclusion; always prefer this over add when a related conclusion exists
- {"op":"invalidate","id":"..."} — the exchange contradicts an existing conclusion

Rules: a conclusion must be durable (still true outside this one conversation), specific, and a single fact. Do not store transient task details, restate an existing conclusion, or rewrite content gratuitously. If the exchange teaches nothing durable about the user, return []."#;

/// Conversations with a derivation already in flight; a fast follow-up send must
/// not race a second one.
#[derive(Default)]
pub struct MemoryDeriverState(Mutex<HashSet<String>>);

pub fn spawn_derivation(app: &AppHandle, conversation_id: &str, exchange: &[Message]) {
    let exchange = exchange_text(exchange);
    if exchange.len() < MIN_EXCHANGE_CHARS {
        return;
    }
    let state = app.state::<MemoryDeriverState>();
    {
        let mut inflight = match state.0.lock() {
            Ok(inflight) => inflight,
            Err(_) => return,
        };
        if !inflight.insert(conversation_id.to_string()) {
            return;
        }
    }
    let app = app.clone();
    let conversation_id = conversation_id.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = derive(&app, &conversation_id, &exchange).await {
            eprintln!("memory derivation failed: {error}");
        }
        let state = app.state::<MemoryDeriverState>();
        if let Ok(mut inflight) = state.0.lock() {
            inflight.remove(&conversation_id);
        };
    });
}

/// Only the conversational text matters for memory: user text plus assistant prose.
/// Thinking, tool calls, and tool results are workspace mechanics, not user facts.
fn exchange_text(exchange: &[Message]) -> String {
    let mut parts = Vec::new();
    for message in exchange {
        let text = message
            .content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let speaker = if message.role == "user" {
            "User"
        } else {
            "Assistant"
        };
        parts.push(format!("{speaker}: {text}"));
    }
    parts.join("\n\n")
}

async fn derive(app: &AppHandle, conversation_id: &str, exchange: &str) -> Result<(), String> {
    let current = app.state::<Database>().list_ai_memory(false)?;
    let representation = if current.is_empty() {
        "(none)".to_string()
    } else {
        current
            .iter()
            .map(|conclusion| {
                format!(
                    "[{}] ({}, {:.2}) {}",
                    conclusion.id, conclusion.kind, conclusion.confidence, conclusion.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let credential = config::resolve_credential(&*app.state::<KeychainSecretStore>())
        .map_err(|error| error.message)?;
    let client = AgentClient::new(credential)
        .map_err(AiProviderCommandError::provider_error)
        .map_err(|error| error.message)?;
    let messages = vec![Message::user_text(format!(
        "Current conclusions:\n{representation}\n\nNew exchange:\n{exchange}"
    ))];
    let response = client
        .send(&StreamRequest {
            model: MEMORY_MODEL,
            max_tokens: 1_500,
            system: DERIVER_SYSTEM_PROMPT,
            tools: Value::Array(Vec::new()),
            messages: &messages,
            effort: Some("low"),
            thinking: false,
            compaction: false,
        })
        .await?;
    let assembled = collect_stream(response, |_| {}).await?;
    let raw = assembled
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    apply_operations(app, conversation_id, &raw)
}

fn apply_operations(app: &AppHandle, conversation_id: &str, raw: &str) -> Result<(), String> {
    let operations: Vec<Value> = serde_json::from_str(strip_code_fence(raw))
        .map_err(|error| format!("deriver output was not a JSON array: {error}"))?;
    let database = app.state::<Database>();
    let mut active = database.count_active_ai_memory()?;
    for operation in operations {
        match operation
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "add" => {
                let Some(kind) = operation.get("kind").and_then(Value::as_str) else {
                    continue;
                };
                let Some(content) = operation.get("content").and_then(Value::as_str) else {
                    continue;
                };
                if !AI_MEMORY_KINDS.contains(&kind) || active >= MAX_ACTIVE_CONCLUSIONS {
                    continue;
                }
                let confidence = operation
                    .get("confidence")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                if database
                    .insert_ai_memory(kind, content, confidence, Some(conversation_id))
                    .is_ok()
                {
                    active += 1;
                }
            }
            "update" => {
                let Some(id) = operation.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let content = operation.get("content").and_then(Value::as_str);
                let confidence = operation.get("confidence").and_then(Value::as_f64);
                if content.is_none() && confidence.is_none() {
                    continue;
                }
                let _ = database.update_ai_memory(id, content, None, confidence);
            }
            "invalidate" => {
                if let Some(id) = operation.get("id").and_then(Value::as_str) {
                    let _ = database.set_ai_memory_status(id, "invalidated");
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn strip_code_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    let Some(inner) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let inner = inner.strip_prefix("json").unwrap_or(inner);
    inner.strip_suffix("```").unwrap_or(inner).trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exchange_text_keeps_prose_and_drops_tool_blocks() {
        let exchange = vec![
            Message {
                role: "user".to_string(),
                content: vec![ContentBlock::Text {
                    text: "I prefer vectorized NumPy in simulations.".to_string(),
                }],
            },
            Message {
                role: "assistant".to_string(),
                content: vec![
                    ContentBlock::ToolUse {
                        id: "t1".to_string(),
                        name: "run_python".to_string(),
                        input: serde_json::json!({}),
                    },
                    ContentBlock::Text {
                        text: "Noted.".to_string(),
                    },
                ],
            },
            Message {
                role: "user".to_string(),
                content: vec![ContentBlock::ToolResult {
                    tool_use_id: "t1".to_string(),
                    content: "ok".to_string(),
                    is_error: None,
                }],
            },
        ];
        let text = exchange_text(&exchange);
        assert_eq!(
            text,
            "User: I prefer vectorized NumPy in simulations.\n\nAssistant: Noted."
        );
    }

    #[test]
    fn strips_code_fences() {
        assert_eq!(strip_code_fence("[]"), "[]");
        assert_eq!(strip_code_fence("```json\n[]\n```"), "[]");
        assert_eq!(
            strip_code_fence("```\n[{\"op\":\"add\"}]\n```"),
            "[{\"op\":\"add\"}]"
        );
    }
}
