//! Git-based history for workspace folders — a general-purpose view and manager
//! of a project's real git branch (HEAD).
//!
//! Every repository is treated identically, whether the app created it or the
//! user opened a folder of their own: checkpoints are ordinary commits on HEAD,
//! authored by the repo's configured git identity (falling back to an app
//! identity only when git has none). The UI keeps a calm "checkpoint"
//! vocabulary, but there is no hidden ref and no separate mode — it is the
//! user's real history.

mod restore;
#[allow(dead_code)]
mod retention;
mod snapshot;
mod staging;
mod types;

pub use types::{
    CheckpointChange, CheckpointFileDiff, CheckpointSummary, HistoryStatus, RestoreResult,
};

use std::path::{Path, PathBuf};

use git2::{Commit, Delta, Repository, Signature, Tree};

use crate::errors::{WorkspaceError, WorkspaceResult};

const HISTORY_NAME: &str = "Bio Eng Studio";
const HISTORY_EMAIL: &str = "history@bioeng.local";

/// Whether a git repository exists at `root`.
pub fn is_git_repo(root: &Path) -> bool {
    Repository::open(root).is_ok()
}

/// History status for a workspace, without requiring the caller to open a repo
/// (handles the "folder has no repo yet" case).
pub fn history_status(root: &Path) -> WorkspaceResult<HistoryStatus> {
    if is_git_repo(root) {
        return HistoryStore::open(root)?.status();
    }
    Ok(HistoryStatus {
        is_repo: false,
        checkpoint_count: 0,
        last_checkpoint_at_unix: None,
    })
}

/// Ensure a project's `.gitignore` excludes build artifacts (`.lake/`). Called
/// only when the app *creates* a managed project — never on a folder the user
/// opened, whose files we leave untouched. (Snapshots and the staging diff
/// already hard-exclude `.lake`/`.git` regardless of `.gitignore`.)
#[allow(dead_code)]
pub fn ensure_lake_gitignore(root: &Path) -> WorkspaceResult<()> {
    let gitignore = root.join(".gitignore");
    let mut contents = std::fs::read_to_string(&gitignore).unwrap_or_default();

    let already = contents
        .lines()
        .any(|line| matches!(line.trim(), ".lake" | ".lake/" | "/.lake" | "/.lake/"));
    if already {
        return Ok(());
    }

    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    contents.push_str(".lake/\n");
    std::fs::write(&gitignore, contents)?;
    Ok(())
}

pub struct HistoryStore {
    repo: Repository,
    root: PathBuf,
}

impl HistoryStore {
    /// Open an existing repository at `root`. Errors if there is none.
    pub fn open(root: &Path) -> WorkspaceResult<Self> {
        let repo = Repository::open(root)
            .map_err(|_| WorkspaceError::message("This folder is not a git repository."))?;
        Ok(Self {
            repo,
            root: root.to_path_buf(),
        })
    }

    /// Open the repository at `root`, initializing one if none exists yet — the
    /// "initialize git here" action, and project creation.
    pub fn init(root: &Path) -> WorkspaceResult<Self> {
        let repo = match Repository::open(root) {
            Ok(repo) => repo,
            Err(_) => Repository::init(root)?,
        };
        Ok(Self {
            repo,
            root: root.to_path_buf(),
        })
    }

    /// Record a checkpoint of the entire worktree on HEAD. Returns `None` when
    /// nothing changed (no empty commits). Used for the initial project commit;
    /// the UI's create path is [`HistoryStore::checkpoint_selective`].
    pub fn checkpoint(&self, message: &str) -> WorkspaceResult<Option<CheckpointSummary>> {
        let tree_oid = snapshot::snapshot_tree(&self.repo, &self.root)?;
        let tree = self.repo.find_tree(tree_oid)?;
        let parent = self.tip()?;
        let unchanged = parent.as_ref().is_some_and(|p| p.tree_id() == tree_oid);

        // Commits land on the real branch, so the on-disk index must track the
        // committed tree — otherwise `git status` shows every file as
        // staged-deleted + untracked, since trees are built out-of-band and
        // nothing is staged during the snapshot. Sync even when skipping, to
        // self-heal a stale index.
        self.sync_index_to_tree(&tree)?;

        if unchanged {
            return Ok(None);
        }

        Ok(Some(self.commit_tree(message, &tree, parent.as_ref())?))
    }

    /// Commit `tree` on HEAD, authored by the repo's configured git identity
    /// (falling back to the app identity when git has none). Shared by full
    /// snapshots and selective (chosen-file) checkpoints.
    fn commit_tree(
        &self,
        message: &str,
        tree: &Tree<'_>,
        parent: Option<&Commit<'_>>,
    ) -> WorkspaceResult<CheckpointSummary> {
        let signature = self.signature()?;
        let parents: Vec<&Commit<'_>> = parent.into_iter().collect();
        let oid = self.repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            tree,
            &parents,
        )?;
        let commit = self.repo.find_commit(oid)?;
        self.summary(&commit)
    }

    /// The repo's configured commit identity, or the app identity when git has
    /// no `user.name`/`user.email` set.
    fn signature(&self) -> WorkspaceResult<Signature<'static>> {
        match self.repo.signature() {
            Ok(signature) => Ok(signature),
            Err(_) => Ok(Signature::now(HISTORY_NAME, HISTORY_EMAIL)?),
        }
    }

    /// Most-recent-first list of checkpoints, capped at `limit`.
    pub fn list(&self, limit: usize) -> WorkspaceResult<Vec<CheckpointSummary>> {
        let tip = match self.tip()? {
            Some(tip) => tip,
            None => return Ok(Vec::new()),
        };
        let mut revwalk = self.repo.revwalk()?;
        revwalk.push(tip.id())?;
        revwalk.set_sorting(git2::Sort::TIME)?;

        let mut out = Vec::new();
        for oid in revwalk {
            let commit = self.repo.find_commit(oid?)?;
            out.push(self.summary(&commit)?);
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    /// The files changed by a checkpoint, vs. its parent.
    pub fn changes(&self, checkpoint_id: &str) -> WorkspaceResult<Vec<CheckpointChange>> {
        let commit = self.find_commit(checkpoint_id)?;
        let tree = commit.tree()?;
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let diff = self
            .repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;

        let mut changes = Vec::new();
        for delta in diff.deltas() {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default();
            changes.push(CheckpointChange {
                path,
                status: status_label(delta.status()).to_string(),
            });
        }
        Ok(changes)
    }

    pub fn status(&self) -> WorkspaceResult<HistoryStatus> {
        let tip = self.tip()?;
        let last_checkpoint_at_unix = tip.as_ref().map(|commit| commit.time().seconds());
        let checkpoint_count = match &tip {
            Some(tip) => {
                let mut revwalk = self.repo.revwalk()?;
                revwalk.push(tip.id())?;
                revwalk.count()
            }
            None => 0,
        };
        Ok(HistoryStatus {
            is_repo: true,
            checkpoint_count,
            last_checkpoint_at_unix,
        })
    }

    /// The current branch tip (HEAD) commit, if any.
    fn tip(&self) -> WorkspaceResult<Option<Commit<'_>>> {
        Ok(self
            .repo
            .head()
            .ok()
            .and_then(|reference| reference.peel_to_commit().ok()))
    }

    fn find_commit(&self, checkpoint_id: &str) -> WorkspaceResult<Commit<'_>> {
        let oid = git2::Oid::from_str(checkpoint_id)
            .map_err(|_| WorkspaceError::message("Invalid checkpoint id."))?;
        Ok(self.repo.find_commit(oid)?)
    }

    /// Point the on-disk index at `tree`, so `git status` reflects only real
    /// edits. Worktree is untouched. Only ever called from the
    /// checkpoint/restore path, which is serialized per workspace — index writes
    /// must never happen on a read path, or concurrent History reads would
    /// collide on `.git/index.lock`.
    fn sync_index_to_tree(&self, tree: &Tree<'_>) -> WorkspaceResult<()> {
        let mut index = self.repo.index()?;
        index.read_tree(tree)?;
        index.write()?;
        Ok(())
    }

    fn summary(&self, commit: &Commit<'_>) -> WorkspaceResult<CheckpointSummary> {
        let tree = commit.tree()?;
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let diff = self
            .repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
        let committer = commit.committer();
        Ok(CheckpointSummary {
            id: commit.id().to_string(),
            created_at_unix: commit.time().seconds(),
            message: commit.summary().unwrap_or_default().to_string(),
            change_count: diff.deltas().len(),
            committer_name: committer.name().unwrap_or_default().to_string(),
            committer_email: committer.email().unwrap_or_default().to_string(),
        })
    }
}

fn status_label(status: Delta) -> &'static str {
    match status {
        Delta::Added => "added",
        Delta::Deleted => "deleted",
        Delta::Modified => "modified",
        Delta::Renamed => "renamed",
        Delta::Copied => "copied",
        _ => "other",
    }
}

#[cfg(test)]
mod tests;
