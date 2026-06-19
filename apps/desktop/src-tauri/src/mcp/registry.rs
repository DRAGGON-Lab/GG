use std::collections::HashMap;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;
use tokio::sync::Mutex;

use rmcp::model::{CallToolRequestParams, ClientCapabilities, ClientInfo, Implementation};
use rmcp::service::RunningService;
use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, ConfigureCommandExt,
    StreamableHttpClientTransport, TokioChildProcess,
};
use rmcp::{RoleClient, ServiceExt};

use bioeng_data::{
    mcp::{McpServerConfig, McpTransport},
    Database,
};

/// Emitted whenever a server's connection status changes so the settings UI can refresh.
pub const MCP_SERVERS_CHANGED_EVENT: &str = "mcp-servers-changed";

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum McpServerStatus {
    Disabled,
    Connecting,
    Connected { tool_count: usize },
    Error { message: String },
}

/// Config plus live status and tool names, for the settings UI.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    #[serde(flatten)]
    pub config: McpServerConfig,
    pub status: McpServerStatus,
    pub tools: Vec<String>,
}

struct ServerEntry {
    config: McpServerConfig,
    status: McpServerStatus,
    service: Option<RunningService<RoleClient, ClientInfo>>,
    tools: Vec<ToolInfo>,
}

#[derive(Clone)]
struct ToolInfo {
    /// The server-local tool name (no namespace prefix).
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Default)]
pub struct McpRegistry {
    entries: Mutex<HashMap<String, ServerEntry>>,
}

impl McpRegistry {
    /// Build the API `tools` entries for every connected server, namespaced.
    pub async fn tools_for_agent(&self) -> Vec<Value> {
        let entries = self.entries.lock().await;
        let mut tools = Vec::new();
        for entry in entries.values() {
            if !matches!(entry.status, McpServerStatus::Connected { .. }) {
                continue;
            }
            for tool in &entry.tools {
                tools.push(json!({
                    "name": namespaced(&entry.config.name, &tool.name),
                    "description": format!("[{}] {}", entry.config.name, tool.description),
                    "input_schema": tool.input_schema.clone(),
                }));
            }
        }
        tools
    }

    /// Whether a namespaced tool call should skip the permission prompt, per its
    /// server's auto-allow setting.
    pub async fn auto_allow(&self, namespaced_tool: &str) -> bool {
        let Some((server, _)) = split_namespaced(namespaced_tool) else {
            return false;
        };
        let entries = self.entries.lock().await;
        entries
            .values()
            .find(|entry| entry.config.name == server)
            .map(|entry| entry.config.auto_allow_tools)
            .unwrap_or(false)
    }

    /// Route a namespaced tool call to its owning server.
    pub async fn call_tool(&self, namespaced_tool: &str, input: &Value) -> Result<Value, String> {
        let (server, tool) = split_namespaced(namespaced_tool)
            .ok_or_else(|| format!("Malformed MCP tool name: {namespaced_tool}"))?;
        let entries = self.entries.lock().await;
        let entry = entries
            .values()
            .find(|entry| entry.config.name == server)
            .ok_or_else(|| format!("MCP server `{server}` is not connected"))?;
        let service = entry
            .service
            .as_ref()
            .ok_or_else(|| format!("MCP server `{server}` is not connected"))?;
        let mut params = CallToolRequestParams::new(tool.to_string());
        if let Value::Object(map) = input {
            params = params.with_arguments(map.clone());
        }
        let result = service
            .call_tool(params)
            .await
            .map_err(|error| format!("MCP tool `{namespaced_tool}` failed: {error}"))?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub async fn statuses(&self) -> Vec<McpServerView> {
        let entries = self.entries.lock().await;
        let mut views: Vec<McpServerView> = entries
            .values()
            .map(|entry| McpServerView {
                config: entry.config.clone(),
                status: entry.status.clone(),
                tools: entry.tools.iter().map(|tool| tool.name.clone()).collect(),
            })
            .collect();
        views.sort_by(|a, b| {
            a.config
                .name
                .to_lowercase()
                .cmp(&b.config.name.to_lowercase())
        });
        views
    }

    /// Connect (or reconnect) one server, replacing any existing entry. A disabled
    /// server is recorded but not dialed.
    pub async fn connect(&self, app: &AppHandle, config: McpServerConfig) {
        self.disconnect(&config.id).await;

        if !config.enabled {
            let mut entries = self.entries.lock().await;
            entries.insert(
                config.id.clone(),
                ServerEntry {
                    config,
                    status: McpServerStatus::Disabled,
                    service: None,
                    tools: Vec::new(),
                },
            );
            drop(entries);
            emit_changed(app);
            return;
        }

        {
            let mut entries = self.entries.lock().await;
            entries.insert(
                config.id.clone(),
                ServerEntry {
                    config: config.clone(),
                    status: McpServerStatus::Connecting,
                    service: None,
                    tools: Vec::new(),
                },
            );
        }
        emit_changed(app);

        let (status, service, tools) = match dial(&config).await {
            Ok((service, tools)) => (
                McpServerStatus::Connected {
                    tool_count: tools.len(),
                },
                Some(service),
                tools,
            ),
            Err(message) => (McpServerStatus::Error { message }, None, Vec::new()),
        };

        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries.get_mut(&config.id) {
            entry.status = status;
            entry.service = service;
            entry.tools = tools;
        }
        drop(entries);
        emit_changed(app);
    }

    pub async fn disconnect(&self, id: &str) {
        let entry = {
            let mut entries = self.entries.lock().await;
            entries.remove(id)
        };
        if let Some(entry) = entry {
            if let Some(service) = entry.service {
                let _ = service.cancel().await;
            }
        }
    }

    /// Cancel every live connection (used on app exit).
    pub async fn shutdown_all(&self) {
        let drained: Vec<ServerEntry> = {
            let mut entries = self.entries.lock().await;
            entries.drain().map(|(_, entry)| entry).collect()
        };
        for entry in drained {
            if let Some(service) = entry.service {
                let _ = service.cancel().await;
            }
        }
    }
}

async fn dial(
    config: &McpServerConfig,
) -> Result<(RunningService<RoleClient, ClientInfo>, Vec<ToolInfo>), String> {
    let client_info = client_info();
    let service = match config.transport {
        McpTransport::Stdio => {
            let command = config.command.clone();
            let args = config.args.clone();
            let env = config.env.clone();
            let transport = TokioChildProcess::new(Command::new(&command).configure(|cmd| {
                cmd.args(&args);
                for (key, value) in &env {
                    cmd.env(key, value);
                }
            }))
            .map_err(|error| format!("Could not start `{command}`: {error}"))?;
            client_info
                .serve(transport)
                .await
                .map_err(|error| format!("MCP handshake failed: {error}"))?
        }
        McpTransport::Http => {
            let transport = http_transport(config)?;
            client_info
                .serve(transport)
                .await
                .map_err(|error| format!("MCP handshake failed: {error}"))?
        }
    };

    let tools = service
        .list_all_tools()
        .await
        .map_err(|error| format!("Could not list tools: {error}"))?
        .into_iter()
        .map(|tool| ToolInfo {
            name: tool.name.to_string(),
            description: tool
                .description
                .map(|description| description.to_string())
                .unwrap_or_default(),
            input_schema: serde_json::to_value(&*tool.input_schema)
                .unwrap_or_else(|_| json!({ "type": "object" })),
        })
        .collect();

    Ok((service, tools))
}

fn http_transport(
    config: &McpServerConfig,
) -> Result<StreamableHttpClientTransport<reqwest::Client>, String> {
    let mut custom_headers = HashMap::new();
    for (key, value) in &config.headers {
        let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| format!("Invalid header name: {key}"))?;
        let value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|_| format!("Invalid value for header `{key}`"))?;
        custom_headers.insert(name, value);
    }
    let transport_config = StreamableHttpClientTransportConfig::with_uri(config.url.clone())
        .custom_headers(custom_headers);
    Ok(StreamableHttpClientTransport::with_client(
        reqwest::Client::default(),
        transport_config,
    ))
}

fn client_info() -> ClientInfo {
    ClientInfo::new(
        ClientCapabilities::default(),
        Implementation::new("bioeng", env!("CARGO_PKG_VERSION")),
    )
}

/// Connect every enabled stored server in the background at startup.
pub fn spawn_initial_connect(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let configs = match app.state::<Database>().list_mcp_servers() {
            Ok(configs) => configs,
            Err(error) => {
                eprintln!("could not load MCP servers: {error}");
                return;
            }
        };
        let registry = app.state::<McpRegistry>();
        for config in configs {
            registry.connect(&app, config).await;
        }
    });
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(MCP_SERVERS_CHANGED_EVENT, ());
}

fn namespaced(server: &str, tool: &str) -> String {
    format!("{}{}__{}", super::MCP_TOOL_PREFIX, server, tool)
}

fn split_namespaced(namespaced_tool: &str) -> Option<(&str, &str)> {
    namespaced_tool
        .strip_prefix(super::MCP_TOOL_PREFIX)?
        .split_once("__")
}
