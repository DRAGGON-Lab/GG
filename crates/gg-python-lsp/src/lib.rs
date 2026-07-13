//! A generic async LSP client over stdio, used to drive `pylsp` (the
//! python-lsp-server) for GG Circuit's Python editor.
//!
//! The client spawns `python3 -m pylsp`, frames JSON-RPC with `Content-Length`
//! headers, performs `initialize`/`initialized`, and exposes the editor
//! capabilities the frontend needs: document sync, hover, completion,
//! definition, references, and document symbols. Server-published diagnostics
//! are captured into a latest-by-uri map and broadcast for the command layer to
//! emit.

mod protocol;

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::BufReader;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, oneshot, Mutex};

use protocol::{client_capabilities, read_message, FramedWriter};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Diagnostics published by the server for one document, in raw LSP shape (the
/// `params` of a `textDocument/publishDiagnostics` notification).
#[derive(Debug, Clone)]
pub struct DiagnosticsEvent {
    pub uri: String,
    /// The raw `diagnostics` array from the notification.
    pub diagnostics: Value,
    /// The raw notification `params`, useful for direct re-emission.
    pub params: Value,
}

struct Shared {
    pending: Mutex<HashMap<i64, oneshot::Sender<Value>>>,
    diagnostics: Mutex<HashMap<String, Value>>,
    diagnostics_tx: broadcast::Sender<DiagnosticsEvent>,
}

/// An async client driving a single `pylsp` process over stdio.
pub struct PythonLspClient {
    child: Mutex<Child>,
    writer: Arc<Mutex<FramedWriter<ChildStdin>>>,
    next_id: AtomicI64,
    opened: Mutex<HashMap<String, i32>>,
    shared: Arc<Shared>,
}

impl PythonLspClient {
    /// Spawn `python -m pylsp` over stdio and complete the
    /// `initialize`/`initialized` handshake. `root` is the workspace root
    /// advertised to the server (used to resolve imports).
    pub async fn start(python: &Path, root: &Path) -> Result<Self, String> {
        let mut child = tokio::process::Command::new(python)
            .arg("-m")
            .arg("pylsp")
            .current_dir(root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to start pylsp: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "could not open pylsp stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "could not open pylsp stdout".to_string())?;
        // Drain stderr so the pipe never fills and blocks the server.
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut stderr = stderr;
                let mut buf = [0u8; 4096];
                while let Ok(n) = stderr.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                }
            });
        }

        let (diagnostics_tx, _) = broadcast::channel(256);
        let shared = Arc::new(Shared {
            pending: Mutex::new(HashMap::new()),
            diagnostics: Mutex::new(HashMap::new()),
            diagnostics_tx,
        });

        spawn_reader(stdout, shared.clone());

        let client = PythonLspClient {
            child: Mutex::new(child),
            writer: Arc::new(Mutex::new(FramedWriter::new(stdin))),
            next_id: AtomicI64::new(1),
            opened: Mutex::new(HashMap::new()),
            shared,
        };

        let root_uri = path_to_uri(root);
        client
            .request(
                "initialize",
                json!({
                    "processId": std::process::id(),
                    "rootUri": root_uri,
                    "workspaceFolders": [{
                        "uri": root_uri,
                        "name": root.file_name().and_then(|n| n.to_str()).unwrap_or("workspace"),
                    }],
                    "clientInfo": { "name": "GG Circuit", "version": env!("CARGO_PKG_VERSION") },
                    "capabilities": client_capabilities(),
                }),
            )
            .await?;
        client.notify("initialized", json!({})).await?;

        Ok(client)
    }

    /// Subscribe to server-published diagnostics. Each subscriber receives every
    /// `publishDiagnostics` notification after it subscribes.
    pub fn subscribe_diagnostics(&self) -> broadcast::Receiver<DiagnosticsEvent> {
        self.shared.diagnostics_tx.subscribe()
    }

    /// The latest diagnostics array published for `uri`, or `null` if none.
    pub async fn diagnostics_for(&self, uri: &str) -> Value {
        self.shared
            .diagnostics
            .lock()
            .await
            .get(uri)
            .cloned()
            .unwrap_or(Value::Null)
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.shared.pending.lock().await.insert(id, tx);

        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        if let Err(error) = self.writer.lock().await.write(&message).await {
            self.shared.pending.lock().await.remove(&id);
            return Err(error);
        }

        let response = match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                return Err(format!("pylsp channel closed for request: {method}"));
            }
            Err(_) => {
                self.shared.pending.lock().await.remove(&id);
                return Err(format!("pylsp request timed out: {method}"));
            }
        };

        if let Some(error) = response.get("error") {
            return Err(format!("pylsp request failed: {method}: {error}"));
        }

        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let message = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.writer.lock().await.write(&message).await
    }

    /// Open a document, or send a `didChange` if already open. Tracks the
    /// per-uri version internally.
    pub async fn document_open(&self, uri: &str, text: &str) -> Result<(), String> {
        let should_open = {
            let mut opened = self.opened.lock().await;
            let first = !opened.contains_key(uri);
            opened.insert(uri.to_string(), 1);
            first
        };

        if should_open {
            self.notify(
                "textDocument/didOpen",
                json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": "python",
                        "version": 1,
                        "text": text,
                    }
                }),
            )
            .await
        } else {
            self.document_change(uri, text).await
        }
    }

    /// Send a full-text `didChange`, bumping the document version.
    pub async fn document_change(&self, uri: &str, text: &str) -> Result<(), String> {
        let version = {
            let mut opened = self.opened.lock().await;
            let entry = opened.entry(uri.to_string()).or_insert(0);
            *entry += 1;
            *entry
        };
        self.notify(
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": uri, "version": version },
                "contentChanges": [{ "text": text }],
            }),
        )
        .await
    }

    /// Close a document and forget its tracked version and diagnostics.
    pub async fn document_close(&self, uri: &str) -> Result<(), String> {
        self.opened.lock().await.remove(uri);
        self.shared.diagnostics.lock().await.remove(uri);
        self.notify(
            "textDocument/didClose",
            json!({ "textDocument": { "uri": uri } }),
        )
        .await
    }

    pub async fn hover(&self, uri: &str, line: u32, character: u32) -> Result<Value, String> {
        self.request("textDocument/hover", position_params(uri, line, character))
            .await
    }

    pub async fn completion(&self, uri: &str, line: u32, character: u32) -> Result<Value, String> {
        self.request(
            "textDocument/completion",
            position_params(uri, line, character),
        )
        .await
    }

    pub async fn definition(&self, uri: &str, line: u32, character: u32) -> Result<Value, String> {
        self.request(
            "textDocument/definition",
            position_params(uri, line, character),
        )
        .await
    }

    pub async fn references(&self, uri: &str, line: u32, character: u32) -> Result<Value, String> {
        let mut params = position_params(uri, line, character);
        params["context"] = json!({ "includeDeclaration": true });
        self.request("textDocument/references", params).await
    }

    pub async fn document_symbol(&self, uri: &str) -> Result<Value, String> {
        self.request(
            "textDocument/documentSymbol",
            json!({ "textDocument": { "uri": uri } }),
        )
        .await
    }

    /// Best-effort graceful shutdown of the language server.
    pub async fn shutdown(&self) {
        let _ = self.request("shutdown", Value::Null).await;
        let _ = self.notify("exit", Value::Null).await;
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
    }
}

fn position_params(uri: &str, line: u32, character: u32) -> Value {
    json!({
        "textDocument": { "uri": uri },
        "position": { "line": line, "character": character },
    })
}

fn spawn_reader(stdout: tokio::process::ChildStdout, shared: Arc<Shared>) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        while let Ok(Some(message)) = read_message(&mut reader).await {
            dispatch(&shared, message).await;
        }
    });
}

async fn dispatch(shared: &Arc<Shared>, message: Value) {
    if let Some(id) = message.get("id").and_then(Value::as_i64) {
        if let Some(sender) = shared.pending.lock().await.remove(&id) {
            let _ = sender.send(message);
            return;
        }
    }

    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };

    if method == "textDocument/publishDiagnostics" {
        if let Some(params) = message.get("params") {
            if let Some(uri) = params.get("uri").and_then(Value::as_str) {
                let diagnostics = params
                    .get("diagnostics")
                    .cloned()
                    .unwrap_or(Value::Array(Vec::new()));
                shared
                    .diagnostics
                    .lock()
                    .await
                    .insert(uri.to_string(), diagnostics.clone());
                let _ = shared.diagnostics_tx.send(DiagnosticsEvent {
                    uri: uri.to_string(),
                    diagnostics,
                    params: params.clone(),
                });
            }
        }
    }
}

/// Convert a filesystem path to a `file://` URI. Mirrors the convention pylsp
/// uses for the documents the editor opens.
pub fn path_to_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    let path = path.to_string_lossy();
    // On Windows, prefix the drive with a slash and normalize separators.
    #[cfg(windows)]
    {
        uri.push('/');
        uri.push_str(&path.replace('\\', "/"));
    }
    #[cfg(not(windows))]
    {
        uri.push_str(&path);
    }
    uri
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lsp_roundtrip_hover_and_completion() {
        let Some(python) = gg_pyenv::python_executable(None) else {
            eprintln!("skipping: runtime interpreter not found");
            return;
        };

        let dir = std::env::temp_dir();
        let client = PythonLspClient::start(&python, &dir)
            .await
            .expect("pylsp should start");

        let uri = "file:///tmp/gg_lsp_test.py";
        let text = "import os\ndef greet(name):\n    return name\n\ngreet\nos.\n";
        client.document_open(uri, text).await.unwrap();

        // Hover over the `greet` reference on line 4 — should surface the
        // function signature.
        let hover = client.hover(uri, 4, 2).await.unwrap();
        let contents = serde_json::to_string(&hover).unwrap();
        assert!(
            contents.contains("greet"),
            "hover should mention greet: {contents}"
        );

        // Completion after `os.` on line 5, character 3.
        let completion = client.completion(uri, 5, 3).await.unwrap();
        let items = completion
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .or_else(|| completion.as_array().cloned())
            .unwrap_or_default();
        assert!(!items.is_empty(), "expected completions for os.");

        client.document_close(uri).await.unwrap();
        client.shutdown().await;
    }
}
