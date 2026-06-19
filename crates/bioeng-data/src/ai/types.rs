use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMemoryConclusion {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub confidence: f64,
    pub status: String,
    pub source_conversation_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationSummary {
    pub agent_id: String,
    pub context_attachments: Vec<AiContextAttachment>,
    pub created_at: String,
    pub id: String,
    pub message_count: i64,
    pub title: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversation {
    pub agent_id: String,
    pub context_attachments: Vec<AiContextAttachment>,
    pub created_at: String,
    pub id: String,
    pub title: String,
    pub transcript_entries: Vec<AiTranscriptEntry>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextAttachment {
    pub id: Option<i64>,
    pub kind: String,
    pub label: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextAttachmentInput {
    pub kind: String,
    pub label: String,
    #[serde(default = "empty_object")]
    pub payload: Value,
}

impl AiContextAttachmentInput {
    pub fn normalized(mut self) -> Self {
        self.kind = self.kind.trim().to_string();
        self.label = self.label.trim().to_string();
        if self.kind.is_empty() {
            self.kind = "workspace".to_string();
        }
        if self.label.is_empty() {
            self.label = "Workspace".to_string();
        }
        if !self.payload.is_object() {
            self.payload = empty_object();
        }
        self
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTranscriptEntry {
    pub created_at: String,
    pub id: i64,
    pub payload: Value,
    pub role: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationCreateInput {
    #[serde(default = "default_agent_id")]
    pub agent_id: String,
    #[serde(default)]
    pub context_attachments: Vec<AiContextAttachmentInput>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationContextInput {
    #[serde(default)]
    pub context_attachments: Vec<AiContextAttachmentInput>,
}

fn default_agent_id() -> String {
    "workspace-ai".to_string()
}

fn empty_object() -> Value {
    Value::Object(Default::default())
}
