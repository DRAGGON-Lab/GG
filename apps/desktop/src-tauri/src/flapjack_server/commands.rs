//! Tauri commands for the embedded Flapjack API server. `flapjack_server_ensure` lazily brings it
//! up (creating its venv on first use) and returns the loopback URL; `flapjack_server_info` returns
//! the URL only if it is already running. The circuit runtime hands the URL to `pyFlapjack`.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};

use super::FlapjackServer;
use crate::flapjack::state::FlapjackStore;
use crate::python::PythonState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlapjackServerInfo {
    pub base_url: String,
}

/// Ensure the server is running (setting up its environment on first call) and return its base URL.
#[tauri::command]
pub async fn flapjack_server_ensure(
    app: AppHandle,
    server: State<'_, FlapjackServer>,
    python: State<'_, PythonState>,
    store: State<'_, FlapjackStore>,
) -> Result<FlapjackServerInfo, String> {
    let base_url = server
        .ensure(&app, &python, Path::new(&store.db_path))
        .await?;
    Ok(FlapjackServerInfo { base_url })
}

/// The loopback base URL of the running server, or an error if it has not been started.
#[tauri::command]
pub async fn flapjack_server_info(
    server: State<'_, FlapjackServer>,
) -> Result<FlapjackServerInfo, String> {
    server
        .base_url()
        .await
        .map(|base_url| FlapjackServerInfo { base_url })
        .ok_or_else(|| "the Flapjack API server is not running".to_string())
}
