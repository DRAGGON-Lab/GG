use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::GrnLeanState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrnAnalyzerStatus {
    available: bool,
    source: Option<String>,
}

#[tauri::command]
pub fn grn_analyzer_status(state: State<'_, GrnLeanState>) -> GrnAnalyzerStatus {
    GrnAnalyzerStatus {
        available: state.analyzer().is_some(),
        source: state.source().map(str::to_owned),
    }
}

#[tauri::command]
pub async fn grn_analyze(state: State<'_, GrnLeanState>, design: String) -> Result<Value, String> {
    // Parse once before crossing the process boundary. The Lean executable
    // remains authoritative for schema interpretation and certificate logic.
    serde_json::from_str::<Value>(&design)
        .map_err(|error| format!("Invalid design JSON: {error}"))?;
    let analyzer = state
        .analyzer()
        .ok_or_else(|| "The grn-lean analyzer is not installed.".to_string())?;

    let mut child = Command::new(analyzer)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start grn-lean: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open grn-lean input.".to_string())?;
    stdin
        .write_all(design.as_bytes())
        .await
        .map_err(|error| format!("Could not send the design to grn-lean: {error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("Could not read grn-lean output: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            "grn-lean rejected the design.".to_string()
        } else {
            format!("grn-lean rejected the design: {}", stderr.trim())
        });
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("grn-lean returned invalid JSON: {error}"))
}
