//! The wire contract between the Rust host and the webview. Generated into
//! `bindings/agent-protocol.ts` with `typeshare`. (With the Rust-native harness there
//! is no separate runtime process, so the old JSON-RPC/capability types are gone.)

use serde::{Deserialize, Serialize};
use serde_json::Value;
use typeshare::typeshare;

/// Webview → host: start (or continue) a turn in a persisted conversation with the
/// given agent. Context attachments are explicit workspace anchors such as a file
/// or a cursor position.
#[typeshare]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub conversation_id: String,
    pub agent_id: String,
    pub prompt: String,
    #[serde(default)]
    pub context_attachments: Vec<PromptContextAttachment>,
}

#[typeshare]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptContextAttachment {
    pub kind: String,
    pub label: String,
    pub payload: Value,
}

/// One streamed event for a session, rendered directly by the webview.
#[typeshare]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum AgentMessage {
    Init {
        model: String,
    },
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        id: String,
        content: String,
        #[serde(rename = "isError")]
        is_error: bool,
    },
    Result {
        subtype: String,
        #[serde(rename = "isError")]
        is_error: bool,
        #[serde(rename = "costUsd")]
        cost_usd: Option<f64>,
    },
    Error {
        code: Option<String>,
        message: String,
    },
    Done,
}

/// Host → webview notification payload (`agent-message` event).
#[typeshare]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessageNotification {
    pub conversation_id: String,
    pub message: AgentMessage,
}

#[typeshare]
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionBehavior {
    Allow,
    Deny,
}

/// Host → webview event: a pending permission decision the UI resolves via the
/// `agent_respond_permission` command, keyed by `request_id`.
#[typeshare]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionPrompt {
    pub request_id: String,
    pub conversation_id: String,
    pub tool_name: String,
    pub input: Value,
}
