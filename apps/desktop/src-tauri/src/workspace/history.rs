//! History (git) Tauri commands. History is a general-purpose view and manager
//! of a workspace's real git branch (HEAD): the same for every repo, whether
//! the app created it or the user opened a folder of their own. Commands take
//! just the workspace `root`.

use std::path::Path;

use gg_workspace::{
    history_status, is_git_repo, CheckpointChange, CheckpointFileDiff, CheckpointSummary,
    HistoryStatus, HistoryStore, RestoreResult, WorkspaceError,
};

use super::run_blocking;

#[tauri::command]
pub async fn workspace_history_status(root: String) -> Result<HistoryStatus, String> {
    run_blocking(move || history_status(Path::new(&root)).map_err(Into::into)).await
}

/// Initialize a git repository in `root` (the "initialize git here" action),
/// then report status. A no-op when a repo already exists.
#[tauri::command]
pub async fn workspace_history_init_repo(root: String) -> Result<HistoryStatus, String> {
    run_blocking(move || {
        let path = Path::new(&root);
        if !is_git_repo(path) {
            HistoryStore::init(path).map_err(stringify)?;
        }
        history_status(path).map_err(Into::into)
    })
    .await
}

/// Record a checkpoint (a commit of the whole worktree on HEAD). Returns `None`
/// when nothing changed.
#[tauri::command]
pub async fn workspace_history_checkpoint(
    root: String,
    reason: Option<String>,
) -> Result<Option<CheckpointSummary>, String> {
    run_blocking(move || {
        let store = open_store(Path::new(&root))?;
        let message = reason.unwrap_or_else(|| "Checkpoint".to_string());
        store.checkpoint(&message).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn workspace_history_list(
    root: String,
    limit: usize,
) -> Result<Vec<CheckpointSummary>, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .list(limit)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn workspace_history_changes(
    root: String,
    checkpoint_id: String,
) -> Result<Vec<CheckpointChange>, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .changes(&checkpoint_id)
            .map_err(Into::into)
    })
    .await
}

/// Files in the worktree that differ from the last checkpoint — the staging
/// candidates for a new checkpoint. Read-only.
#[tauri::command]
pub async fn workspace_history_working_changes(
    root: String,
) -> Result<Vec<CheckpointChange>, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .working_changes()
            .map_err(Into::into)
    })
    .await
}

/// Both sides of a working-tree change (last checkpoint vs. current on-disk),
/// for the review diff. Read-only.
#[tauri::command]
pub async fn workspace_history_working_file_diff(
    root: String,
    path: String,
) -> Result<CheckpointFileDiff, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .working_file_diff(&path)
            .map_err(Into::into)
    })
    .await
}

/// Both sides of a file's change within a past checkpoint (vs. its parent), for
/// a read-only diff view. Read-only.
#[tauri::command]
pub async fn workspace_history_file_diff(
    root: String,
    checkpoint_id: String,
    path: String,
) -> Result<CheckpointFileDiff, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .file_diff_at(&checkpoint_id, &path)
            .map_err(Into::into)
    })
    .await
}

/// Record a checkpoint containing only the selected files, leaving every other
/// working change uncommitted. Returns `None` when the selection changes
/// nothing.
#[tauri::command]
pub async fn workspace_history_checkpoint_selective(
    root: String,
    message: String,
    paths: Vec<String>,
) -> Result<Option<CheckpointSummary>, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .checkpoint_selective(&message, &paths)
            .map_err(Into::into)
    })
    .await
}

/// The text of a file at a checkpoint, for previewing before restoring.
#[tauri::command]
pub async fn workspace_history_file_at(
    root: String,
    checkpoint_id: String,
    path: String,
) -> Result<String, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .file_at(&checkpoint_id, &path)
            .map_err(Into::into)
    })
    .await
}

/// Restore one file to its state at a checkpoint, overwriting the working copy
/// (no commit is added). The caller confirms first.
#[tauri::command]
pub async fn workspace_history_restore_file(
    root: String,
    checkpoint_id: String,
    path: String,
) -> Result<RestoreResult, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .restore_file(&checkpoint_id, &path)
            .map_err(Into::into)
    })
    .await
}

/// Restore the whole workspace to a checkpoint, overwriting the working tree
/// (no commit is added). The caller confirms first.
#[tauri::command]
pub async fn workspace_history_restore_workspace(
    root: String,
    checkpoint_id: String,
) -> Result<RestoreResult, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .restore_workspace(&checkpoint_id)
            .map_err(Into::into)
    })
    .await
}

/// Discard every uncommitted change, returning the working tree to the last
/// checkpoint (HEAD) — edits reverted, files added since removed. No commit is
/// added. The caller confirms first.
#[tauri::command]
pub async fn workspace_history_discard_working_changes(
    root: String,
) -> Result<RestoreResult, String> {
    run_blocking(move || {
        open_store(Path::new(&root))?
            .discard_working_changes()
            .map_err(Into::into)
    })
    .await
}

/// Open the history store for `root`. The folder must already be a git
/// repository (the UI offers to initialize one when it isn't).
fn open_store(root: &Path) -> Result<HistoryStore, String> {
    HistoryStore::open(root).map_err(stringify)
}

fn stringify(error: WorkspaceError) -> String {
    error.to_string()
}
