pub mod commands;

use std::path::PathBuf;
use std::sync::Arc;

use gg_python_lsp::PythonLspClient;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// Tauri-managed state for the Python runtime: the resolved bundled
/// interpreter and `uv` binary paths, and a lazily-started `pylsp` client
/// (started on first LSP use).
pub struct PythonState {
    interpreter: Option<PathBuf>,
    uv: Option<PathBuf>,
    client: Mutex<Option<Arc<PythonLspClient>>>,
}

impl PythonState {
    /// Resolve the interpreter and `uv` paths from the (optional) bundled
    /// resource dir, falling back to the dev layout.
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        let interpreter = gg_pyenv::python_executable(resource_dir.as_deref());
        let uv = gg_pyenv::uv_executable(resource_dir.as_deref());
        Self {
            interpreter,
            uv,
            client: Mutex::new(None),
        }
    }

    /// The bundled base interpreter. Workspaces create their `.venv` from this
    /// one; scripts run with the workspace venv when it exists, else this.
    pub fn interpreter(&self) -> Option<&PathBuf> {
        self.interpreter.as_ref()
    }

    /// The bundled `uv` binary that manages workspace environments.
    pub fn uv(&self) -> Option<&PathBuf> {
        self.uv.as_ref()
    }

    /// Get the running `pylsp` client, starting it on first use. The workspace
    /// root advertised to pylsp is the app data dir.
    async fn client(&self, app: &AppHandle) -> Result<Arc<PythonLspClient>, String> {
        let mut guard = self.client.lock().await;
        if let Some(client) = guard.as_ref() {
            return Ok(client.clone());
        }

        let interpreter = self
            .interpreter
            .as_ref()
            .ok_or_else(|| "Python runtime interpreter not found".to_string())?;
        let root = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir());

        let client = Arc::new(PythonLspClient::start(interpreter, &root).await?);
        spawn_diagnostics_forwarder(app.clone(), client.clone());
        *guard = Some(client.clone());
        Ok(client)
    }
}

/// Forward `pylsp` diagnostics notifications to the frontend as
/// `python-diagnostics` events.
fn spawn_diagnostics_forwarder(app: AppHandle, client: Arc<PythonLspClient>) {
    let mut rx = client.subscribe_diagnostics();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let _ = app.emit(
                        "python-diagnostics",
                        serde_json::json!({
                            "uri": event.uri,
                            "diagnostics": event.diagnostics,
                        }),
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
