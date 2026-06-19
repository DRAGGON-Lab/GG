//! Restoring worktree contents from a checkpoint.
//!
//! Restore is `git checkout <commit> -- <path>`-style: it overwrites working
//! files with their contents at the chosen commit and adds no commit of its own
//! (the caller confirms first, since uncommitted edits to those files are
//! replaced). Workspace restore applies a tree-to-tree diff by hand
//! (write/delete files) rather than `checkout_tree`, so the index is left
//! alone — the restored files simply read as ordinary uncommitted changes
//! against HEAD until the user decides to commit them.

use std::{fs, path::Path};

use git2::{Delta, Oid, Tree};

use super::snapshot;
use super::types::RestoreResult;
use super::HistoryStore;
use crate::errors::{WorkspaceError, WorkspaceResult};

/// Whether reverting the working tree should also delete files added since the
/// target — the one behavioural difference between a full restore and a discard.
#[derive(PartialEq, Eq)]
enum RemoveAddedSince {
    Yes,
    No,
}

impl HistoryStore {
    /// The UTF-8 contents of a file at a checkpoint, for previewing.
    pub fn file_at(&self, checkpoint_id: &str, relative_path: &str) -> WorkspaceResult<String> {
        let bytes = self.blob_bytes_at(checkpoint_id, relative_path)?;
        String::from_utf8(bytes)
            .map_err(|_| WorkspaceError::message("That file isn't text and can't be previewed."))
    }

    /// Restore a single file to its state at `checkpoint_id`, overwriting the
    /// working copy. Adds no commit.
    pub fn restore_file(
        &self,
        checkpoint_id: &str,
        relative_path: &str,
    ) -> WorkspaceResult<RestoreResult> {
        let contents = self.blob_bytes_at(checkpoint_id, relative_path)?;

        let destination = self.root.join(relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&destination, &contents)?;

        Ok(RestoreResult {
            restored: vec![relative_path.to_string()],
        })
    }

    /// Restore the entire workspace to `checkpoint_id`, overwriting the working
    /// tree. Files added since the checkpoint are removed; changed and deleted
    /// files are rewritten from the checkpoint. Adds no commit.
    pub fn restore_workspace(&self, checkpoint_id: &str) -> WorkspaceResult<RestoreResult> {
        let target_oid = self.tree_oid_at(checkpoint_id)?;
        let target_tree = self.repo.find_tree(target_oid)?;
        self.restore_to_tree(&target_tree, RemoveAddedSince::Yes)
    }

    /// Discard uncommitted edits, returning tracked files to the last checkpoint
    /// (HEAD) — the `git checkout .` gesture. Edited files are reverted and
    /// files deleted since are rewritten, but files *added* since are left in
    /// place: discard never deletes. Adds no commit. Errors when there is no
    /// checkpoint to return to. The caller confirms first.
    pub fn discard_working_changes(&self) -> WorkspaceResult<RestoreResult> {
        let tip = self.tip()?.ok_or_else(|| {
            WorkspaceError::message("There's no checkpoint yet to discard changes against.")
        })?;
        let target_tree = tip.tree()?;
        self.restore_to_tree(&target_tree, RemoveAddedSince::No)
    }

    /// Bring the working tree's tracked files in line with `target_tree`: write
    /// back any file that differs and, when `remove_added` is `Yes`, delete
    /// files present now but absent in the target (those added since). The index
    /// is left alone — the result reads as ordinary working-tree changes against
    /// HEAD. Shared by full restore (which removes added files) and discard
    /// (which leaves them, matching `git checkout .`).
    fn restore_to_tree(
        &self,
        target_tree: &Tree<'_>,
        remove_added: RemoveAddedSince,
    ) -> WorkspaceResult<RestoreResult> {
        let current_oid = snapshot::snapshot_tree(&self.repo, &self.root)?;
        let current_tree = self.repo.find_tree(current_oid)?;
        let diff = self
            .repo
            .diff_tree_to_tree(Some(&current_tree), Some(target_tree), None)?;

        let mut restored = Vec::new();
        for delta in diff.deltas() {
            match delta.status() {
                // Present now but absent in the target → added since the
                // checkpoint. A full restore removes it; a discard leaves any
                // new file untouched.
                Delta::Deleted => {
                    if remove_added == RemoveAddedSince::No {
                        continue;
                    }
                    if let Some(path) = delta.old_file().path() {
                        let _ = fs::remove_file(self.root.join(path));
                        restored.push(path.to_string_lossy().to_string());
                    }
                }
                // Otherwise write the target's version back out.
                _ => {
                    let target_file = delta.new_file();
                    let oid = target_file.id();
                    if let (Some(path), false) = (target_file.path(), oid.is_zero()) {
                        let blob = self.repo.find_blob(oid)?;
                        let destination = self.root.join(path);
                        if let Some(parent) = destination.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        fs::write(&destination, blob.content())?;
                        restored.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }

        Ok(RestoreResult { restored })
    }

    fn tree_oid_at(&self, checkpoint_id: &str) -> WorkspaceResult<Oid> {
        Ok(self.find_commit(checkpoint_id)?.tree_id())
    }

    fn blob_bytes_at(&self, checkpoint_id: &str, relative_path: &str) -> WorkspaceResult<Vec<u8>> {
        let commit = self.find_commit(checkpoint_id)?;
        let tree = commit.tree()?;
        let entry = tree.get_path(Path::new(relative_path)).map_err(|_| {
            WorkspaceError::message(format!("{relative_path} isn't in that checkpoint."))
        })?;
        let object = entry.to_object(&self.repo)?;
        let blob = object
            .as_blob()
            .ok_or_else(|| WorkspaceError::message("That path isn't a file."))?;
        Ok(blob.content().to_vec())
    }
}
