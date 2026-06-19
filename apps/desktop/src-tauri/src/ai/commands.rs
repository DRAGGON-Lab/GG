use bioeng_data::{
    ai::{
        AiConversation, AiConversationContextInput, AiConversationCreateInput,
        AiConversationSummary, AiMemoryConclusion,
    },
    Database,
};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use bioeng_agent::{collect_stream, AgentClient, ContentBlock, Message, StreamRequest};

use crate::{
    agent::config,
    secrets::{types::AiProviderCommandError, KeychainSecretStore},
};

const AI_TITLE_MODEL: &str = "claude-sonnet-4-6";
const AI_TITLE_SYSTEM_PROMPT: &str = r#"You title AI chat threads. Return only a title, no quotes, no punctuation, no markdown. The title must be 1 to 3 words, concrete, and based on the subject of the user's messages. Prefer nouns over verbs."#;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationTitleGenerateInput {
    #[serde(default)]
    pub prompts: Vec<String>,
}

#[tauri::command]
pub fn ai_conversations_list(
    database: State<'_, Database>,
) -> Result<Vec<AiConversationSummary>, String> {
    database.list_ai_conversations()
}

#[tauri::command]
pub fn ai_conversation_create(
    database: State<'_, Database>,
    input: AiConversationCreateInput,
) -> Result<AiConversation, String> {
    database.create_ai_conversation(input)
}

#[tauri::command]
pub fn ai_conversation_get(
    database: State<'_, Database>,
    conversation_id: String,
) -> Result<Option<AiConversation>, String> {
    database.get_ai_conversation(&conversation_id)
}

#[tauri::command]
pub fn ai_conversation_delete(
    database: State<'_, Database>,
    conversation_id: String,
) -> Result<bool, String> {
    database.delete_ai_conversation(&conversation_id)
}

#[tauri::command]
pub fn ai_conversation_context_set(
    database: State<'_, Database>,
    conversation_id: String,
    input: AiConversationContextInput,
) -> Result<Option<AiConversation>, String> {
    database.set_ai_context_attachments(&conversation_id, input.context_attachments)
}

#[tauri::command]
pub fn ai_conversation_title_update(
    database: State<'_, Database>,
    conversation_id: String,
    title: String,
) -> Result<Option<AiConversation>, String> {
    database.update_ai_conversation_title(&conversation_id, &title)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMemoryUpdateInput {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
}

#[tauri::command]
pub fn ai_memory_list(database: State<'_, Database>) -> Result<Vec<AiMemoryConclusion>, String> {
    database.list_ai_memory(true)
}

#[tauri::command]
pub fn ai_memory_update(
    database: State<'_, Database>,
    id: String,
    input: AiMemoryUpdateInput,
) -> Result<Option<AiMemoryConclusion>, String> {
    database.update_ai_memory(
        &id,
        input.content.as_deref(),
        input.kind.as_deref(),
        input.confidence,
    )
}

#[tauri::command]
pub fn ai_memory_set_status(
    database: State<'_, Database>,
    id: String,
    status: String,
) -> Result<bool, String> {
    database.set_ai_memory_status(&id, &status)
}

#[tauri::command]
pub fn ai_memory_delete(database: State<'_, Database>, id: String) -> Result<bool, String> {
    database.delete_ai_memory(&id)
}

#[tauri::command]
pub async fn ai_conversation_title_generate(
    app: AppHandle,
    input: AiConversationTitleGenerateInput,
) -> Result<String, AiProviderCommandError> {
    let prompts = input
        .prompts
        .into_iter()
        .map(|prompt| prompt.replace(char::is_control, " "))
        .map(|prompt| prompt.trim().to_string())
        .filter(|prompt| !prompt.is_empty())
        .take(2)
        .collect::<Vec<_>>();

    if prompts.is_empty() {
        return Ok("AI".to_string());
    }

    let user_prompt = format!(
        "Create a 1 to 3 word tab title for this chat.\n\n{}",
        prompts
            .iter()
            .enumerate()
            .map(|(index, prompt)| format!("Message {}: {}", index + 1, prompt))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    let credential = config::resolve_credential(&*app.state::<KeychainSecretStore>())?;
    let client = AgentClient::new(credential).map_err(AiProviderCommandError::provider_error)?;
    let messages = vec![Message::user_text(user_prompt)];
    let response = client
        .send(&StreamRequest {
            model: AI_TITLE_MODEL,
            max_tokens: 32,
            system: AI_TITLE_SYSTEM_PROMPT,
            tools: Value::Array(Vec::new()),
            messages: &messages,
            effort: Some("low"),
            thinking: false,
            compaction: false,
        })
        .await
        .map_err(AiProviderCommandError::provider_error)?;
    let assembled = collect_stream(response, |_| {})
        .await
        .map_err(AiProviderCommandError::provider_error)?;
    let raw_title = assembled
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();

    Ok(clean_generated_title(&raw_title))
}

fn clean_generated_title(title: &str) -> String {
    let words = title
        .trim()
        .trim_matches(['"', '\'', '`', '.', ':', ';', ',', '!', '?'])
        .split_whitespace()
        .map(|word| word.trim_matches(['"', '\'', '`', '.', ':', ';', ',', '!', '?']))
        .filter(|word| !word.is_empty())
        .take(3)
        .collect::<Vec<_>>();

    if words.is_empty() {
        "AI".to_string()
    } else {
        words.join(" ")
    }
}
