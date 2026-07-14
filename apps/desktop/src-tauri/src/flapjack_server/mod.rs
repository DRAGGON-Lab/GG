//! An embedded, pyFlapjack-compatible HTTP + WebSocket API served over the same
//! `flapjack.sqlite3` the Flapjack tab uses. It lets locally-run Python — the circuit's LOICA
//! scripts — reach the Flapjack installation through the `pyFlapjack` client, the same way the
//! `sbol_server` module exposes the SBOL corpus to the `sbol-db` client.
//!
//! Unlike `sbol_server` (an in-process Rust axum server), the Flapjack API and its numerical
//! analysis engine are Python (the `flapjack-data` package). So this launches `flapjack-data`'s
//! server as a long-lived child process in a dedicated managed virtualenv, bound to an ephemeral
//! loopback port. The server opens its own SQLite pool on the shared file; WAL mode makes that
//! safe alongside the Flapjack tab's store, and both are writers now (the tab imports studies,
//! the API uploads measurements through pyFlapjack), which WAL serializes.
//!
//! Startup is lazy: `ensure` creates the venv, installs `flapjack-data`, and launches the server
//! on first use (the circuit runtime), so app launch stays fast and needs no network.

pub mod commands;

use std::net::{Ipv4Addr, TcpListener};
use std::path::Path;
use std::time::Duration;

use gg_pyenv::{OutputLine, ServerProcess, Stream};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::python::PythonState;

/// The managed virtualenv for the server, under the app's local data dir.
const VENV_SUBDIR: &str = "flapjack-server";

/// Marker recording the installed `flapjack-data` requirement, so the (slow) install is skipped
/// when it already matches — mirroring the circuit runtime's environment marker.
const REQUIREMENT_MARKER: &str = "flapjack-server-req.txt";

/// Environment variable overriding where `flapjack-data` is installed from. Defaults to the git
/// repository, installed with the `api` and `analysis` extras. Set this to a local path
/// (`flapjack-data[api,analysis] @ file:///path`) or a PyPI requirement to install from elsewhere.
const SOURCE_ENV: &str = "GG_FLAPJACK_DATA_SOURCE";
const DEFAULT_SOURCE: &str =
    "flapjack-data[api,analysis] @ git+https://github.com/marpaia/flapjack-data.git";

fn requirement() -> String {
    std::env::var(SOURCE_ENV).unwrap_or_else(|_| DEFAULT_SOURCE.to_string())
}

/// The running server's loopback base URL and its process handle, held as Tauri managed state.
#[derive(Default)]
pub struct FlapjackServer {
    inner: Mutex<Option<Running>>,
}

struct Running {
    base_url: String,
    process: ServerProcess,
}

impl FlapjackServer {
    /// The base URL if the server is currently running, else `None`.
    pub async fn base_url(&self) -> Option<String> {
        let mut guard = self.inner.lock().await;
        let running = guard.as_mut()?;
        running
            .process
            .is_running()
            .then(|| running.base_url.clone())
    }

    /// Ensure the server is running against `db_path`, returning its base URL. Idempotent: returns
    /// the cached URL if the process is still alive; otherwise sets up the venv (once) and launches
    /// it. `db_path` is the shared `flapjack.sqlite3` the Flapjack tab created at startup.
    pub async fn ensure(
        &self,
        app: &AppHandle,
        python: &PythonState,
        db_path: &Path,
    ) -> Result<String, String> {
        let mut guard = self.inner.lock().await;
        if let Some(running) = guard.as_mut() {
            if running.process.is_running() {
                return Ok(running.base_url.clone());
            }
        }

        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?
            .join(VENV_SUBDIR);
        std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        ensure_venv(app, python, &root).await?;

        let venv_python = gg_pyenv::venv_python_path(&root);
        let port = free_loopback_port()?;
        let base_url = format!("http://127.0.0.1:{port}");

        let handle = app.clone();
        let process = gg_pyenv::spawn_module(
            &venv_python,
            "flapjack_data.api",
            &[
                "--db".into(),
                db_path.display().to_string(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                port.to_string(),
                "--create".into(),
            ],
            move |line| emit_log(&handle, line),
        )?;

        wait_for_health(&base_url).await?;
        *guard = Some(Running {
            base_url: base_url.clone(),
            process,
        });
        Ok(base_url)
    }

    /// Terminate the server if running (called on app shutdown).
    pub async fn shutdown(&self) {
        if let Some(mut running) = self.inner.lock().await.take() {
            running.process.kill().await;
        }
    }
}

/// Create the venv if absent and install `flapjack-data` when the requirement marker doesn't match,
/// streaming uv's progress to the frontend. A fast no-op once set up.
async fn ensure_venv(app: &AppHandle, python: &PythonState, root: &Path) -> Result<(), String> {
    let uv = python
        .uv()
        .ok_or_else(|| "uv binary not found in the bundled runtime".to_string())?
        .clone();
    let base = python
        .interpreter()
        .ok_or_else(|| "Python runtime interpreter not found".to_string())?
        .clone();

    if gg_pyenv::workspace_venv_python(root).is_none() {
        let handle = app.clone();
        let code =
            gg_pyenv::create_venv(&uv, &base, root, move |line| emit_log(&handle, line)).await?;
        if code != Some(0) {
            return Err("could not create the Flapjack server environment".to_string());
        }
    }

    let spec = requirement();
    let marker = root.join(REQUIREMENT_MARKER);
    let recorded = std::fs::read_to_string(&marker)
        .ok()
        .map(|s| s.trim().to_string());
    if recorded.as_deref() == Some(spec.as_str()) {
        return Ok(());
    }

    let handle = app.clone();
    let code =
        gg_pyenv::install_packages(&uv, &base, root, std::slice::from_ref(&spec), move |line| {
            emit_log(&handle, line)
        })
        .await?;
    if code != Some(0) {
        return Err("could not install flapjack-data into the server environment".to_string());
    }
    let _ = std::fs::write(&marker, spec);
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerLog {
    stream: &'static str,
    line: String,
}

fn emit_log(app: &AppHandle, line: OutputLine) {
    let stream = match line.stream {
        Stream::Stdout => "stdout",
        Stream::Stderr => "stderr",
    };
    let _ = app.emit(
        "flapjack-server-log",
        ServerLog {
            stream,
            line: line.line,
        },
    );
}

/// Reserve an ephemeral loopback port by binding and immediately releasing it, then hand the
/// number to uvicorn. A brief window exists before uvicorn rebinds, acceptable on loopback.
fn free_loopback_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|error| error.to_string())?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| error.to_string())
}

/// Poll the server's health endpoint until it answers or the timeout elapses. First launch also
/// waits out interpreter warm-up, so the budget is generous.
async fn wait_for_health(base_url: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("{base_url}/healthz");
    for _ in 0..100 {
        if let Ok(response) = client.get(&url).send().await {
            if response.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    Err("the Flapjack API server did not become healthy in time".to_string())
}
