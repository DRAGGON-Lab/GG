//! Git-based history engine for workspace folders: checkpoints are ordinary
//! commits on a project's real git branch (HEAD). Every repository is treated
//! identically, whether the app created it or the user opened a folder of their
//! own.

mod errors;
mod history;

pub use errors::{WorkspaceError, WorkspaceResult};
pub use history::{
    history_status, is_git_repo, CheckpointChange, CheckpointFileDiff, CheckpointSummary,
    HistoryStatus, HistoryStore, RestoreResult,
};
