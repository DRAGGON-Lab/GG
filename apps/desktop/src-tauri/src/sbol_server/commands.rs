//! Tauri command exposing the embedded sbol-db server's address to the
//! frontend, which passes it into the circuit's Python runtime.

use serde::Serialize;
use tauri::State;

use super::SbolServer;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbolServerInfo {
    pub base_url: String,
}

/// The loopback base URL of the running sbol-db server, e.g.
/// `http://127.0.0.1:52431`.
#[tauri::command]
pub fn sbol_server_info(server: State<'_, SbolServer>) -> SbolServerInfo {
    SbolServerInfo {
        base_url: server.base_url.clone(),
    }
}
