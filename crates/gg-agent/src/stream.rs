//! Streaming decode for the Anthropic Messages API: an SSE byte-framer plus a
//! message accumulator that assembles `content_block` deltas (text / thinking /
//! tool_use `input_json_delta` / `signature_delta`) into a complete assistant
//! message. The fiddliest part of talking to the API directly — unit-tested here
//! against canned events, no network required.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A content block, shaped exactly as the API serializes/accepts it. The same enum
/// is used both for assembling the assistant's response and for the `tool_result`
/// blocks we send back, so a turn's content round-trips with no remapping.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
        signature: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        // The API requires tool_result content to be a string (or a list of content
        // blocks) — never a bare object. Capabilities returning JSON are stringified.
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

/// One conversation message, shaped as the Messages API accepts it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: Vec<ContentBlock>,
}

impl Message {
    pub fn user_text(text: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: vec![ContentBlock::Text { text: text.into() }],
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
}

/// The fully-assembled result of one streamed model turn.
#[derive(Clone, Debug, Default)]
pub struct AssembledMessage {
    pub content: Vec<ContentBlock>,
    pub stop_reason: Option<String>,
    pub usage: Usage,
    pub error: Option<String>,
}

/// Incremental events surfaced to the caller as the stream arrives — the basis for
/// streaming text/thinking to the UI token-by-token.
#[derive(Clone, Debug, PartialEq)]
pub enum StreamDelta {
    Init { model: String },
    Text(String),
    Thinking(String),
    ToolUseStarted { id: String, name: String },
    Result { stop_reason: Option<String> },
}

enum PartialBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
        signature: String,
    },
    ToolUse {
        id: String,
        name: String,
        partial_json: String,
    },
}

/// Accumulates streamed Messages-API events into an `AssembledMessage`, emitting
/// `StreamDelta`s along the way.
#[derive(Default)]
pub struct MessageAccumulator {
    blocks: Vec<PartialBlock>,
    stop_reason: Option<String>,
    usage: Usage,
    error: Option<String>,
}

impl MessageAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process one decoded SSE event, returning an incremental delta if one applies.
    pub fn feed(&mut self, event: &Value) -> Option<StreamDelta> {
        match event.get("type").and_then(Value::as_str)? {
            "message_start" => {
                let message = event.get("message");
                if let Some(usage) = message.and_then(|m| m.get("usage")) {
                    self.merge_usage(usage);
                }
                let model = message
                    .and_then(|m| m.get("model"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                Some(StreamDelta::Init { model })
            }
            "content_block_start" => {
                let block = event.get("content_block")?;
                let delta = match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        self.blocks.push(PartialBlock::Text {
                            text: String::new(),
                        });
                        None
                    }
                    Some("thinking") => {
                        self.blocks.push(PartialBlock::Thinking {
                            thinking: String::new(),
                            signature: String::new(),
                        });
                        None
                    }
                    Some("tool_use") => {
                        let id = block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let name = block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        self.blocks.push(PartialBlock::ToolUse {
                            id: id.clone(),
                            name: name.clone(),
                            partial_json: String::new(),
                        });
                        Some(StreamDelta::ToolUseStarted { id, name })
                    }
                    _ => {
                        // Unknown block type: keep indices aligned with a placeholder.
                        self.blocks.push(PartialBlock::Text {
                            text: String::new(),
                        });
                        None
                    }
                };
                delta
            }
            "content_block_delta" => {
                let index = event.get("index").and_then(Value::as_u64)? as usize;
                let delta = event.get("delta")?;
                match (
                    delta.get("type").and_then(Value::as_str),
                    self.blocks.get_mut(index),
                ) {
                    (Some("text_delta"), Some(PartialBlock::Text { text })) => {
                        let chunk = delta
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        text.push_str(chunk);
                        Some(StreamDelta::Text(chunk.to_string()))
                    }
                    (Some("thinking_delta"), Some(PartialBlock::Thinking { thinking, .. })) => {
                        let chunk = delta
                            .get("thinking")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        thinking.push_str(chunk);
                        Some(StreamDelta::Thinking(chunk.to_string()))
                    }
                    (Some("signature_delta"), Some(PartialBlock::Thinking { signature, .. })) => {
                        signature.push_str(
                            delta
                                .get("signature")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                        );
                        None
                    }
                    (
                        Some("input_json_delta"),
                        Some(PartialBlock::ToolUse { partial_json, .. }),
                    ) => {
                        partial_json.push_str(
                            delta
                                .get("partial_json")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                        );
                        None
                    }
                    _ => None,
                }
            }
            "message_delta" => {
                if let Some(usage) = event.get("usage") {
                    self.merge_usage(usage);
                }
                self.stop_reason = event
                    .get("delta")
                    .and_then(|d| d.get("stop_reason"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                Some(StreamDelta::Result {
                    stop_reason: self.stop_reason.clone(),
                })
            }
            "error" => {
                self.error = event
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| Some("stream error".to_string()));
                None
            }
            _ => None,
        }
    }

    fn merge_usage(&mut self, usage: &Value) {
        let get = |key: &str| usage.get(key).and_then(Value::as_u64);
        if let Some(value) = get("input_tokens") {
            self.usage.input_tokens = value;
        }
        if let Some(value) = get("output_tokens") {
            self.usage.output_tokens = value;
        }
        if let Some(value) = get("cache_creation_input_tokens") {
            self.usage.cache_creation_input_tokens = value;
        }
        if let Some(value) = get("cache_read_input_tokens") {
            self.usage.cache_read_input_tokens = value;
        }
    }

    pub fn finish(self) -> AssembledMessage {
        let content = self
            .blocks
            .into_iter()
            .filter_map(|block| match block {
                PartialBlock::Text { text } if !text.is_empty() => {
                    Some(ContentBlock::Text { text })
                }
                PartialBlock::Text { .. } => None,
                PartialBlock::Thinking {
                    thinking,
                    signature,
                } => Some(ContentBlock::Thinking {
                    thinking,
                    signature,
                }),
                PartialBlock::ToolUse {
                    id,
                    name,
                    partial_json,
                } => {
                    let input = if partial_json.trim().is_empty() {
                        Value::Object(Default::default())
                    } else {
                        serde_json::from_str(&partial_json)
                            .unwrap_or(Value::Object(Default::default()))
                    };
                    Some(ContentBlock::ToolUse { id, name, input })
                }
            })
            .collect();

        AssembledMessage {
            content,
            stop_reason: self.stop_reason,
            usage: self.usage,
            error: self.error,
        }
    }
}

/// Buffers raw SSE bytes and yields complete event payloads (the JSON from `data:`
/// lines). Handles events split across chunk boundaries, comment keep-alives, and
/// CRLF line endings.
#[derive(Default)]
pub struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<Value> {
        self.buffer
            .push_str(&String::from_utf8_lossy(chunk).replace("\r\n", "\n"));
        let mut events = Vec::new();
        while let Some(boundary) = self.buffer.find("\n\n") {
            let block: String = self.buffer.drain(..boundary + 2).collect();
            if let Some(event) = parse_sse_block(&block) {
                events.push(event);
            }
        }
        events
    }
}

fn parse_sse_block(block: &str) -> Option<Value> {
    let data: String = block
        .lines()
        .filter(|line| !line.starts_with(':'))
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|rest| rest.strip_prefix(' ').unwrap_or(rest))
        .collect::<Vec<_>>()
        .join("");
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    serde_json::from_str(&data).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn feed_all(accumulator: &mut MessageAccumulator, events: &[Value]) -> Vec<StreamDelta> {
        events
            .iter()
            .filter_map(|event| accumulator.feed(event))
            .collect()
    }

    #[test]
    fn assembles_text_thinking_and_tool_use() {
        let events = vec![
            json!({"type": "message_start", "message": {"model": "claude-opus-4-8", "usage": {"input_tokens": 42, "cache_read_input_tokens": 10}}}),
            // thinking block with signature
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Let me "}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "check."}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "sig123"}}),
            json!({"type": "content_block_stop", "index": 0}),
            // text block
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Fetching "}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "state."}}),
            json!({"type": "content_block_stop", "index": 1}),
            // tool_use block with input streamed as partial JSON
            json!({"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "toolu_1", "name": "memory_search", "input": {}}}),
            json!({"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{\"query\":\"a"}}),
            json!({"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "bc\"}"}}),
            json!({"type": "content_block_stop", "index": 2}),
            json!({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 77}}),
            json!({"type": "message_stop"}),
        ];

        let mut accumulator = MessageAccumulator::new();
        let deltas = feed_all(&mut accumulator, &events);

        assert_eq!(
            deltas.first(),
            Some(&StreamDelta::Init {
                model: "claude-opus-4-8".to_string()
            })
        );
        assert!(deltas.contains(&StreamDelta::Thinking("Let me ".to_string())));
        assert!(deltas.contains(&StreamDelta::Text("Fetching ".to_string())));
        assert!(deltas.contains(&StreamDelta::ToolUseStarted {
            id: "toolu_1".to_string(),
            name: "memory_search".to_string(),
        }));

        let message = accumulator.finish();
        assert_eq!(message.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(message.usage.input_tokens, 42);
        assert_eq!(message.usage.output_tokens, 77);
        assert_eq!(message.usage.cache_read_input_tokens, 10);
        assert_eq!(message.content.len(), 3);

        match &message.content[0] {
            ContentBlock::Thinking {
                thinking,
                signature,
            } => {
                assert_eq!(thinking, "Let me check.");
                assert_eq!(signature, "sig123");
            }
            other => panic!("expected thinking, got {other:?}"),
        }
        match &message.content[1] {
            ContentBlock::Text { text } => assert_eq!(text, "Fetching state."),
            other => panic!("expected text, got {other:?}"),
        }
        match &message.content[2] {
            ContentBlock::ToolUse { id, name, input } => {
                assert_eq!(id, "toolu_1");
                assert_eq!(name, "memory_search");
                assert_eq!(input, &json!({"query": "abc"}));
            }
            other => panic!("expected tool_use, got {other:?}"),
        }
    }

    #[test]
    fn sse_decoder_handles_split_chunks_crlf_and_keepalives() {
        let mut decoder = SseDecoder::new();
        // First chunk ends mid-event; includes a comment keep-alive frame.
        let first = decoder
            .push(b":\r\n\r\nevent: message_start\r\ndata: {\"type\":\"message_start\",\"mess");
        assert!(first.is_empty());
        // Second chunk completes the first event and adds a full second one.
        let rest = decoder.push(
            b"age\":{\"model\":\"m\"}}\r\n\r\nevent: content_block_delta\r\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\r\n\r\n",
        );
        assert_eq!(rest.len(), 2);
        assert_eq!(rest[0]["type"], "message_start");
        assert_eq!(rest[1]["delta"]["text"], "hi");
    }

    #[test]
    fn accumulator_records_stream_errors() {
        let mut accumulator = MessageAccumulator::new();
        accumulator.feed(&json!({
            "type": "error",
            "error": { "type": "overloaded_error", "message": "API overloaded" },
        }));

        let message = accumulator.finish();
        assert_eq!(message.error.as_deref(), Some("API overloaded"));
    }
}
