use std::path::{Path, PathBuf};

use gg_pyenv::{EnvStatus, InstalledPackage, OutputLine, Stream};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use super::PythonState;

/// A simple monotonic run id source. Run ids identify which output events
/// belong to which command invocation.
fn next_run_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    COUNTER.fetch_add(1, Ordering::SeqCst)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub run_id: u64,
    /// Process exit code, or `null` if terminated by a signal.
    pub exit_code: Option<i32>,
}

/// The bundled `uv` binary, or an error when the runtime is incomplete.
fn require_uv(state: &PythonState) -> Result<PathBuf, String> {
    state
        .uv()
        .cloned()
        .ok_or_else(|| "uv binary not found in the bundled runtime".to_string())
}

/// Build a streaming sink that forwards each output line to the frontend on
/// `event` (e.g. `python-env-output`), tagged with `run_id`.
fn line_emitter(
    app: &AppHandle,
    event: &'static str,
    run_id: u64,
) -> impl Fn(OutputLine) + Send + Sync + 'static {
    let app = app.clone();
    move |output: OutputLine| {
        let stream = match output.stream {
            Stream::Stdout => "stdout",
            Stream::Stderr => "stderr",
        };
        let _ = app.emit(
            event,
            serde_json::json!({
                "runId": run_id,
                "stream": stream,
                "line": output.line,
            }),
        );
    }
}

/// Run Python code (written to a temp file, or the supplied `path`), streaming
/// each output line to the frontend as `python-run-output` events and resolving
/// to the final exit code. When `workspace_root` has a `.venv`, the script runs
/// with that interpreter; otherwise the bundled base interpreter is used.
///
/// The script runs through a wrapper that captures rich output (matplotlib
/// figures and `display(obj)`), which arrives as `stream: "display"` events
/// carrying a JSON MIME bundle.
///
/// Emitted event `python-run-output` payload (camelCase):
///   `{ runId, stream: "stdout" | "stderr" | "display", line }`
#[tauri::command]
pub async fn python_run_script(
    app: AppHandle,
    code: String,
    path: Option<String>,
    workspace_root: Option<String>,
) -> Result<RunResult, String> {
    let state = app.state::<PythonState>();
    let interpreter = workspace_root
        .as_deref()
        .and_then(|root| gg_pyenv::workspace_venv_python(Path::new(root)))
        .or_else(|| state.interpreter().cloned())
        .ok_or_else(|| "Python runtime interpreter not found".to_string())?;

    let run_id = next_run_id();

    // The figure-capturing run wrapper lives in the app cache, refreshed each
    // run so it tracks the bundled source. Kept out of the user's project dir.
    let runs_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("python-runs");
    std::fs::create_dir_all(&runs_dir).map_err(|error| error.to_string())?;
    let runner_path = runs_dir.join("gg_runner.py");
    std::fs::write(&runner_path, gg_pyenv::RUNNER_SOURCE).map_err(|error| error.to_string())?;

    // Resolve the script path: an explicit path, or a temp file holding `code`.
    let (script_path, cwd): (PathBuf, PathBuf) = match path {
        Some(path) => {
            let script_path = PathBuf::from(&path);
            let cwd = script_path
                .parent()
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir);
            std::fs::write(&script_path, &code).map_err(|error| error.to_string())?;
            (script_path, cwd)
        }
        None => {
            let script_path = runs_dir.join(format!("run-{run_id}.py"));
            std::fs::write(&script_path, &code).map_err(|error| error.to_string())?;
            (script_path, runs_dir.clone())
        }
    };

    let emit_app = app.clone();
    let on_line = move |output: OutputLine| {
        // A stdout line carrying the display sentinel is a rich MIME bundle, not
        // text. Everything else flows through as its own stream.
        let (stream, line) = match output.stream {
            Stream::Stdout => match output.line.strip_prefix(gg_pyenv::DISPLAY_SENTINEL) {
                Some(json) => ("display", json.to_string()),
                None => ("stdout", output.line),
            },
            Stream::Stderr => ("stderr", output.line),
        };
        let _ = emit_app.emit(
            "python-run-output",
            serde_json::json!({
                "runId": run_id,
                "stream": stream,
                "line": line,
            }),
        );
    };

    let exit_code =
        gg_pyenv::run_script_with_capture(&interpreter, &runner_path, &script_path, &cwd, on_line)
            .await?;

    Ok(RunResult { run_id, exit_code })
}

/// The `.venv` status for `workspace_root`: whether it exists, its Python
/// version, and how many packages it holds.
#[tauri::command]
pub async fn python_env_status(
    app: AppHandle,
    workspace_root: String,
) -> Result<EnvStatus, String> {
    let state = app.state::<PythonState>();
    let uv = require_uv(&state)?;
    Ok(gg_pyenv::env_status(Path::new(&workspace_root), &uv).await)
}

/// Create (or reuse) `workspace_root/.venv` from the bundled interpreter,
/// streaming uv's progress as `python-env-output` events.
#[tauri::command]
pub async fn python_env_create(
    app: AppHandle,
    workspace_root: String,
) -> Result<RunResult, String> {
    let state = app.state::<PythonState>();
    let uv = require_uv(&state)?;
    let base_python = state
        .interpreter()
        .cloned()
        .ok_or_else(|| "Python runtime interpreter not found".to_string())?;

    let run_id = next_run_id();
    let on_line = line_emitter(&app, "python-env-output", run_id);
    let exit_code =
        gg_pyenv::create_venv(&uv, &base_python, Path::new(&workspace_root), on_line).await?;
    Ok(RunResult { run_id, exit_code })
}

/// List packages installed in `workspace_root/.venv` (empty when none exists).
#[tauri::command]
pub async fn python_packages_list(
    app: AppHandle,
    workspace_root: String,
) -> Result<Vec<InstalledPackage>, String> {
    let state = app.state::<PythonState>();
    let uv = require_uv(&state)?;
    gg_pyenv::list_packages(&uv, Path::new(&workspace_root)).await
}

/// Install `packages` into `workspace_root/.venv`, streaming uv's progress as
/// `python-env-output` events.
#[tauri::command]
pub async fn python_packages_install(
    app: AppHandle,
    workspace_root: String,
    packages: Vec<String>,
) -> Result<RunResult, String> {
    let state = app.state::<PythonState>();
    let uv = require_uv(&state)?;
    let base_python = state
        .interpreter()
        .cloned()
        .ok_or_else(|| "Python runtime interpreter not found".to_string())?;
    let run_id = next_run_id();
    let on_line = line_emitter(&app, "python-env-output", run_id);
    let exit_code = gg_pyenv::install_packages(
        &uv,
        &base_python,
        Path::new(&workspace_root),
        &packages,
        on_line,
    )
    .await?;
    Ok(RunResult { run_id, exit_code })
}

/// Uninstall `packages` from `workspace_root/.venv`, streaming uv's progress as
/// `python-env-output` events.
#[tauri::command]
pub async fn python_packages_uninstall(
    app: AppHandle,
    workspace_root: String,
    packages: Vec<String>,
) -> Result<RunResult, String> {
    let state = app.state::<PythonState>();
    let uv = require_uv(&state)?;
    let run_id = next_run_id();
    let on_line = line_emitter(&app, "python-env-output", run_id);
    let exit_code =
        gg_pyenv::uninstall_packages(&uv, Path::new(&workspace_root), &packages, on_line).await?;
    Ok(RunResult { run_id, exit_code })
}

/// Whether the interpreter was found, and (if so) its version string.
///
/// Returns `{ available: bool, path: string | null, version: string | null }`.
#[tauri::command]
pub async fn python_runtime_status(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<PythonState>();
    let Some(interpreter) = state.interpreter().cloned() else {
        return Ok(serde_json::json!({
            "available": false,
            "path": Value::Null,
            "version": Value::Null,
        }));
    };

    let version = gg_pyenv::python_version(&interpreter).await.ok();
    Ok(serde_json::json!({
        "available": true,
        "path": interpreter.to_string_lossy(),
        "version": version,
    }))
}

#[tauri::command]
pub async fn python_lsp_document_open(
    app: AppHandle,
    uri: String,
    text: String,
) -> Result<(), String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.document_open(&uri, &text).await
}

#[tauri::command]
pub async fn python_lsp_document_change(
    app: AppHandle,
    uri: String,
    text: String,
) -> Result<(), String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.document_change(&uri, &text).await
}

#[tauri::command]
pub async fn python_lsp_document_close(app: AppHandle, uri: String) -> Result<(), String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.document_close(&uri).await
}

#[tauri::command]
pub async fn python_lsp_hover(
    app: AppHandle,
    uri: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.hover(&uri, line, character).await
}

#[tauri::command]
pub async fn python_lsp_completions(
    app: AppHandle,
    uri: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.completion(&uri, line, character).await
}

#[tauri::command]
pub async fn python_lsp_definition(
    app: AppHandle,
    uri: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.definition(&uri, line, character).await
}

#[tauri::command]
pub async fn python_lsp_references(
    app: AppHandle,
    uri: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.references(&uri, line, character).await
}

#[tauri::command]
pub async fn python_lsp_document_symbols(app: AppHandle, uri: String) -> Result<Value, String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    client.document_symbol(&uri).await
}

/// Latest diagnostics published for `uri` (the raw LSP `diagnostics` array, or
/// `null` if none yet). Diagnostics are also pushed via `python-diagnostics`
/// events as the server publishes them; this is for initial/pull state.
#[tauri::command]
pub async fn python_lsp_diagnostics(app: AppHandle, uri: String) -> Result<Value, String> {
    let state = app.state::<PythonState>();
    let client = state.client(&app).await?;
    Ok(client.diagnostics_for(&uri).await)
}
