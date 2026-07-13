//! `Content-Length`-framed JSON-RPC over async stdio.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

/// Writes JSON-RPC messages with `Content-Length` headers to a child's stdin.
pub struct FramedWriter<W> {
    inner: W,
}

impl<W: AsyncWrite + Unpin> FramedWriter<W> {
    pub fn new(inner: W) -> Self {
        Self { inner }
    }

    pub async fn write(&mut self, message: &Value) -> Result<(), String> {
        let payload = serde_json::to_vec(message).map_err(|error| error.to_string())?;
        let header = format!("Content-Length: {}\r\n\r\n", payload.len());
        self.inner
            .write_all(header.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        self.inner
            .write_all(&payload)
            .await
            .map_err(|error| error.to_string())?;
        self.inner.flush().await.map_err(|error| error.to_string())
    }
}

/// Read one `Content-Length`-framed message. Returns `Ok(None)` at clean EOF.
pub async fn read_message<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> Result<Option<Value>, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .await
            .map_err(|error| error.to_string())?;
        if bytes == 0 {
            return Ok(None);
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            if key.eq_ignore_ascii_case("content-length") {
                content_length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|error| error.to_string())?,
                );
            }
        }
    }

    let length =
        content_length.ok_or_else(|| "pylsp message missing Content-Length".to_string())?;
    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&payload)
        .map(Some)
        .map_err(|error| error.to_string())
}

/// Client capabilities advertised during `initialize`. Covers the editor
/// features the frontend uses: hover, completion, definition, references,
/// document symbols, and diagnostics.
pub fn client_capabilities() -> Value {
    json!({
        "textDocument": {
            "synchronization": {
                "dynamicRegistration": false,
                "didSave": true,
            },
            "publishDiagnostics": {
                "relatedInformation": true,
            },
            "hover": {
                "dynamicRegistration": false,
                "contentFormat": ["markdown", "plaintext"],
            },
            "completion": {
                "dynamicRegistration": false,
                "completionItem": {
                    "snippetSupport": false,
                    "documentationFormat": ["markdown", "plaintext"],
                },
            },
            "definition": { "dynamicRegistration": false },
            "references": { "dynamicRegistration": false },
            "documentSymbol": {
                "dynamicRegistration": false,
                "hierarchicalDocumentSymbolSupport": true,
            },
        },
        "workspace": {
            "workspaceFolders": true,
        },
    })
}
