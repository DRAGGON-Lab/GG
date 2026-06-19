//! Thin async client for the Anthropic Messages API (streaming). Auth-source-agnostic
//! (API key or OAuth bearer), so a subscription-token source can slot in later without
//! touching callers. Request construction follows the current API: `system`/`tools`
//! prompt-cached, adaptive thinking + effort, and optional server-side compaction.

use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::stream::{AssembledMessage, Message, MessageAccumulator, SseDecoder, StreamDelta};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const COMPACTION_BETA: &str = "compact-2026-01-12";

pub enum Credential {
    ApiKey(String),
    Oauth(String),
}

pub struct AgentClient {
    http: reqwest::Client,
    base_url: String,
    credential: Credential,
}

/// One streamed request to `/v1/messages`.
pub struct StreamRequest<'a> {
    pub model: &'a str,
    pub max_tokens: u32,
    pub system: &'a str,
    pub tools: Value,
    pub messages: &'a [Message],
    pub effort: Option<&'a str>,
    pub thinking: bool,
    pub compaction: bool,
}

impl AgentClient {
    pub fn new(credential: Credential) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            http,
            base_url: "https://api.anthropic.com".to_string(),
            credential,
        })
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url;
        self
    }

    fn build_body(&self, request: &StreamRequest<'_>) -> Value {
        let mut body = json!({
            "model": request.model,
            "max_tokens": request.max_tokens,
            "stream": true,
            "system": [{
                "type": "text",
                "text": request.system,
                "cache_control": { "type": "ephemeral" },
            }],
            "messages": request.messages,
        });

        // Cache the tool definitions by marking the last one (tools render before system).
        if let Some(tools) = request.tools.as_array() {
            if !tools.is_empty() {
                let mut tools = tools.clone();
                if let Some(last) = tools.last_mut().and_then(Value::as_object_mut) {
                    last.insert("cache_control".to_string(), json!({ "type": "ephemeral" }));
                }
                body["tools"] = Value::Array(tools);
            }
        }

        if request.thinking {
            body["thinking"] = json!({ "type": "adaptive", "display": "summarized" });
        }
        if let Some(effort) = request.effort {
            body["output_config"] = json!({ "effort": effort });
        }
        if request.compaction {
            body["context_management"] = json!({ "edits": [{ "type": "compact_20260112" }] });
        }

        body
    }

    pub async fn send(&self, request: &StreamRequest<'_>) -> Result<reqwest::Response, String> {
        let body = serde_json::to_vec(&self.build_body(request)).map_err(|e| e.to_string())?;

        let mut builder = self.apply_auth(
            self.http
                .post(format!("{}/v1/messages", self.base_url))
                .header("anthropic-version", ANTHROPIC_VERSION)
                .header("content-type", "application/json"),
        );
        if request.compaction {
            builder = builder.header("anthropic-beta", COMPACTION_BETA);
        }

        let response = builder
            .body(body)
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error {status}: {text}"));
        }
        Ok(response)
    }

    pub async fn validate_models_access(&self) -> Result<(), String> {
        let response = self
            .apply_auth(
                self.http
                    .get(format!("{}/v1/models?limit=1", self.base_url))
                    .header("anthropic-version", ANTHROPIC_VERSION),
            )
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error {status}: {text}"));
        }
        Ok(())
    }

    fn apply_auth(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.credential {
            Credential::ApiKey(key) => builder.header("x-api-key", key),
            Credential::Oauth(token) => builder.header("authorization", format!("Bearer {token}")),
        }
    }
}

/// Drive a streamed response to completion: decode SSE, accumulate the message, and
/// surface incremental deltas via `on_delta`. This is the per-turn primitive the
/// conversation loop builds on.
pub async fn collect_stream(
    response: reqwest::Response,
    mut on_delta: impl FnMut(StreamDelta),
) -> Result<AssembledMessage, String> {
    let mut decoder = SseDecoder::new();
    let mut accumulator = MessageAccumulator::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|error| error.to_string())?;
        for event in decoder.push(&bytes) {
            if let Some(delta) = accumulator.feed(&event) {
                on_delta(delta);
            }
        }
    }

    let assembled = accumulator.finish();
    if let Some(error) = assembled.error.clone() {
        Err(error)
    } else {
        Ok(assembled)
    }
}
