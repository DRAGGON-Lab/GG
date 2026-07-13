//! Whole-file staging: review the worktree's uncommitted changes since the last
//! checkpoint and commit only a chosen subset — the "git add + open a PR"
//! experience.
//!
//! As with the snapshot path, the on-disk index is never used to build trees: a
//! selective tree is assembled in an in-memory [`git2::Index`] seeded from the
//! current tip, so an external repo's real staging area is never disturbed.

use std::{fs, path::Path};

use git2::{Delta, DiffOptions, Index, Tree};

use super::snapshot;
use super::types::{CheckpointChange, CheckpointFileDiff, CheckpointSummary};
use super::HistoryStore;
use crate::errors::WorkspaceResult;

impl HistoryStore {
    /// Files in the worktree that differ from the last checkpoint — the staging
    /// candidates. Compared tree-to-worktree (ignoring the index), so it means
    /// "what changed since the last checkpoint" regardless of any real staging.
    /// Build artifacts (`.lake/`) and `.git/` are always excluded.
    pub fn working_changes(&self) -> WorkspaceResult<Vec<CheckpointChange>> {
        let tip = self.tip()?;
        let tip_tree = match &tip {
            Some(commit) => Some(commit.tree()?),
            None => None,
        };

        let mut options = DiffOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        let diff = self
            .repo
            .diff_tree_to_workdir(tip_tree.as_ref(), Some(&mut options))?;

        let mut changes = Vec::new();
        for delta in diff.deltas() {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default();
            if path.is_empty() || is_excluded(&path) {
                continue;
            }
            changes.push(CheckpointChange {
                path,
                status: workdir_status_label(delta.status()).to_string(),
            });
        }
        Ok(changes)
    }

    /// Both sides of a working-tree change: the file at the last checkpoint vs.
    /// its current on-disk contents. A side is `None` when the file is absent
    /// there (a fresh file has no `before`; a deleted one no `after`).
    pub fn working_file_diff(&self, relative_path: &str) -> WorkspaceResult<CheckpointFileDiff> {
        let before = self.tip_blob_text(relative_path)?;
        let after = match fs::read(self.root.join(relative_path)) {
            Ok(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let status = file_diff_status(before.is_some(), after.is_some()).to_string();
        Ok(CheckpointFileDiff {
            before,
            after,
            status,
        })
    }

    /// Both sides of a file's change within a past checkpoint (vs. its parent),
    /// for a read-only diff view.
    pub fn file_diff_at(
        &self,
        checkpoint_id: &str,
        relative_path: &str,
    ) -> WorkspaceResult<CheckpointFileDiff> {
        let commit = self.find_commit(checkpoint_id)?;
        let tree = commit.tree()?;
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let before = match &parent_tree {
            Some(tree) => self.tree_blob_text(tree, relative_path)?,
            None => None,
        };
        let after = self.tree_blob_text(&tree, relative_path)?;
        let status = file_diff_status(before.is_some(), after.is_some()).to_string();
        Ok(CheckpointFileDiff {
            before,
            after,
            status,
        })
    }

    /// Commit only `paths` from the worktree, leaving every other working change
    /// uncommitted. Returns `None` when the selection changes nothing. The tree
    /// is the tip's, with the selected paths applied from disk (or removed if
    /// deleted), so unselected files keep their last-checkpoint contents.
    pub fn checkpoint_selective(
        &self,
        message: &str,
        paths: &[String],
    ) -> WorkspaceResult<Option<CheckpointSummary>> {
        let parent = self.tip()?;
        let mut index = Index::new()?;
        if let Some(parent) = &parent {
            index.read_tree(&parent.tree()?)?;
        }

        for path in paths {
            if is_excluded(path) {
                continue;
            }
            let absolute = self.root.join(path);
            match fs::read(&absolute) {
                Ok(data) => {
                    let oid = self.repo.blob(&data)?;
                    let entry = snapshot::blob_entry(
                        path,
                        oid,
                        data.len() as u32,
                        snapshot::file_mode(&absolute),
                    );
                    index.add(&entry)?;
                }
                // A selected file that has since been deleted on disk → drop it.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    let _ = index.remove_path(Path::new(path));
                }
                Err(error) => return Err(error.into()),
            }
        }

        let tree_oid = index.write_tree_to(&self.repo)?;
        let tree = self.repo.find_tree(tree_oid)?;
        let unchanged = parent
            .as_ref()
            .is_some_and(|commit| commit.tree_id() == tree_oid);

        // Keep the on-disk index tracking the committed tree, so the unselected
        // edits read as ordinary unstaged changes against the new HEAD.
        self.sync_index_to_tree(&tree)?;
        if unchanged {
            return Ok(None);
        }

        Ok(Some(self.commit_tree(message, &tree, parent.as_ref())?))
    }

    fn tip_blob_text(&self, relative_path: &str) -> WorkspaceResult<Option<String>> {
        let tip = match self.tip()? {
            Some(commit) => commit,
            None => return Ok(None),
        };
        let tree = tip.tree()?;
        self.tree_blob_text(&tree, relative_path)
    }

    fn tree_blob_text(
        &self,
        tree: &Tree<'_>,
        relative_path: &str,
    ) -> WorkspaceResult<Option<String>> {
        let entry = match tree.get_path(Path::new(relative_path)) {
            Ok(entry) => entry,
            Err(_) => return Ok(None),
        };
        let object = entry.to_object(&self.repo)?;
        Ok(object
            .as_blob()
            .map(|blob| String::from_utf8_lossy(blob.content()).into_owned()))
    }
}

fn is_excluded(path: &str) -> bool {
    snapshot::EXCLUDED_DIRS
        .iter()
        .any(|dir| path == *dir || path.starts_with(&format!("{dir}/")))
}

fn file_diff_status(has_before: bool, has_after: bool) -> &'static str {
    match (has_before, has_after) {
        (false, true) => "added",
        (true, false) => "deleted",
        (true, true) => "modified",
        (false, false) => "unchanged",
    }
}

fn workdir_status_label(status: Delta) -> &'static str {
    match status {
        Delta::Added | Delta::Untracked => "added",
        Delta::Deleted => "deleted",
        Delta::Modified | Delta::Typechange => "modified",
        Delta::Renamed => "renamed",
        Delta::Copied => "copied",
        _ => "other",
    }
}
