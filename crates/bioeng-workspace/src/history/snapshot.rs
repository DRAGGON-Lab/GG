//! Build a git tree from the current worktree without touching the on-disk
//! index, HEAD, or working tree.
//!
//! Blobs are written straight to the object database via `repo.blob`, then
//! assembled into a tree through a fresh in-memory [`git2::Index`]. This is the
//! one safe way to snapshot an *external* repo: it never disturbs the user's
//! staging area or branch.

use std::{
    fs,
    path::{Path, PathBuf},
};

use git2::{Index, IndexEntry, IndexTime, Oid, Repository};

use crate::errors::WorkspaceResult;

/// Directories never included in a checkpoint, regardless of `.gitignore` (an
/// opened external folder may not list them). `.lake` holds build artifacts
/// that can reach gigabytes.
pub(super) const EXCLUDED_DIRS: &[&str] = &[".git", ".lake"];

/// Snapshot the worktree under `root` into a tree object in `repo`, returning
/// its Oid.
pub fn snapshot_tree(repo: &Repository, root: &Path) -> WorkspaceResult<Oid> {
    let mut index = Index::new()?;
    let mut files = Vec::new();
    collect_files(root, root, repo, &mut files)?;

    for (relative, absolute) in files {
        let data = fs::read(&absolute)?;
        let oid = repo.blob(&data)?;
        let entry = blob_entry(&relative, oid, data.len() as u32, file_mode(&absolute));
        index.add(&entry)?;
    }

    Ok(index.write_tree_to(repo)?)
}

/// A zeroed-timestamp index entry for a blob at `unix_path` (git tree paths use
/// `/`). Timestamps are zeroed because trees are content-addressed — the entry
/// only feeds `write_tree_to`, never the on-disk index. Shared with the
/// selective-staging path.
pub(super) fn blob_entry(unix_path: &str, oid: Oid, file_size: u32, mode: u32) -> IndexEntry {
    IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size,
        id: oid,
        flags: 0,
        flags_extended: 0,
        path: unix_path.as_bytes().to_vec(),
    }
}

fn collect_files(
    root: &Path,
    dir: &Path,
    repo: &Repository,
    out: &mut Vec<(String, PathBuf)>,
) -> WorkspaceResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        let relative = match path.strip_prefix(root) {
            Ok(relative) => relative.to_path_buf(),
            Err(_) => continue,
        };

        if file_type.is_dir() {
            if EXCLUDED_DIRS.contains(&name.as_ref()) {
                continue;
            }
            if repo.is_path_ignored(&relative).unwrap_or(false) {
                continue;
            }
            collect_files(root, &path, repo, out)?;
        } else if file_type.is_file() {
            if repo.is_path_ignored(&relative).unwrap_or(false) {
                continue;
            }
            if let Some(unix) = to_unix(&relative) {
                out.push((unix, path));
            }
        }
        // Symlinks and other entry kinds are intentionally skipped.
    }
    Ok(())
}

/// git tree paths use `/` separators and forward-slashed relative paths.
fn to_unix(relative: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in relative.components() {
        let part = component.as_os_str().to_string_lossy();
        if part.is_empty() {
            return None;
        }
        parts.push(part.to_string());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

#[cfg(unix)]
pub(super) fn file_mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;

    let executable = fs::metadata(path)
        .map(|meta| meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
    if executable {
        0o100755
    } else {
        0o100644
    }
}

#[cfg(not(unix))]
pub(super) fn file_mode(_path: &Path) -> u32 {
    0o100644
}
