//! Serializable shapes returned by the history engine. Timestamps are Unix
//! seconds (numbers), leaving date grouping/formatting to the UI.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSummary {
    /// The commit hash, used as the checkpoint id.
    pub id: String,
    /// Commit time, Unix seconds.
    pub created_at_unix: i64,
    pub message: String,
    /// Number of files changed vs. the previous checkpoint.
    pub change_count: usize,
    /// Who recorded the commit (the git committer) — the repo's configured
    /// identity, or the app identity when git has none.
    pub committer_name: String,
    pub committer_email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointChange {
    pub path: String,
    /// `added` | `modified` | `deleted` | `renamed` | `other`.
    pub status: String,
}

/// Both sides of a single file's change, for a diff view. A side is `None` when
/// the file didn't exist there (added → no `before`; deleted → no `after`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileDiff {
    pub before: Option<String>,
    pub after: Option<String>,
    /// `added` | `modified` | `deleted` | `unchanged`.
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStatus {
    /// Whether a git repository backs this workspace yet.
    pub is_repo: bool,
    pub checkpoint_count: usize,
    pub last_checkpoint_at_unix: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    /// Worktree-relative paths written or removed by the restore.
    pub restored: Vec<String>,
}
