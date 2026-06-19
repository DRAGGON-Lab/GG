use tauri::{AppHandle, Manager, State};

use bioeng_data::{mcp::McpServerInput, Database};

use super::registry::{McpRegistry, McpServerView};

#[tauri::command]
pub async fn mcp_servers_list(
    registry: State<'_, McpRegistry>,
) -> Result<Vec<McpServerView>, String> {
    Ok(registry.statuses().await)
}

#[tauri::command]
pub async fn mcp_server_save(
    app: AppHandle,
    input: McpServerInput,
) -> Result<Vec<McpServerView>, String> {
    let config = app.state::<Database>().save_mcp_server(input)?;
    let registry = app.state::<McpRegistry>();
    registry.connect(&app, config).await;
    Ok(registry.statuses().await)
}

#[tauri::command]
pub async fn mcp_server_toggle(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<Vec<McpServerView>, String> {
    let config = app
        .state::<Database>()
        .set_mcp_server_enabled(&id, enabled)?
        .ok_or_else(|| format!("Unknown MCP server: {id}"))?;
    let registry = app.state::<McpRegistry>();
    registry.connect(&app, config).await;
    Ok(registry.statuses().await)
}

#[tauri::command]
pub async fn mcp_server_reconnect(
    app: AppHandle,
    id: String,
) -> Result<Vec<McpServerView>, String> {
    let config = app
        .state::<Database>()
        .get_mcp_server(&id)?
        .ok_or_else(|| format!("Unknown MCP server: {id}"))?;
    let registry = app.state::<McpRegistry>();
    registry.connect(&app, config).await;
    Ok(registry.statuses().await)
}

#[tauri::command]
pub async fn mcp_server_delete(app: AppHandle, id: String) -> Result<Vec<McpServerView>, String> {
    let registry = app.state::<McpRegistry>();
    registry.disconnect(&id).await;
    app.state::<Database>().delete_mcp_server(&id)?;
    Ok(registry.statuses().await)
}
