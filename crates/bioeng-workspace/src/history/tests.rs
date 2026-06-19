use std::fs;
use std::path::Path;

use git2::Repository;

use super::*;

fn write(root: &Path, relative: &str, contents: &str) {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

fn dirty_paths(repo: &Repository) -> Vec<String> {
    let mut options = git2::StatusOptions::new();
    options.include_untracked(true).include_ignored(false);
    repo.statuses(Some(&mut options))
        .unwrap()
        .iter()
        .map(|entry| entry.path().unwrap_or_default().to_string())
        .collect()
}

fn status_of<'a>(changes: &'a [CheckpointChange], path: &str) -> Option<&'a str> {
    changes
        .iter()
        .find(|change| change.path == path)
        .map(|change| change.status.as_str())
}

#[test]
fn checkpoints_commit_on_head_and_skip_when_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "main.py", "x = 1\n");

    let store = HistoryStore::init(root).unwrap();
    let first = store.checkpoint("Project created").unwrap();
    assert!(first.is_some(), "first checkpoint should commit");

    // No change → no commit.
    assert!(store.checkpoint("noop").unwrap().is_none());

    write(root, "main.py", "x = 2\n");
    let second = store.checkpoint("Edit").unwrap();
    assert!(second.is_some(), "a real change should commit");

    let list = store.list(10).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].message, "Edit");
    assert_eq!(list[1].message, "Project created");

    // Commits land on the real branch.
    let repo = Repository::open(root).unwrap();
    assert!(repo.head().unwrap().peel_to_commit().is_ok());
}

#[test]
fn opening_a_user_repo_sees_its_history_and_commits_on_the_same_branch() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // A real user repo with a committed file on its branch.
    let repo = Repository::init(root).unwrap();
    write(root, "model.py", "y = True\n");
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("model.py")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("User", "user@example.com").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "user commit", &tree, &[])
        .unwrap();
    let user_head = repo.head().unwrap().peel_to_commit().unwrap().id();

    let store = HistoryStore::open(root).unwrap();
    // It surfaces the user's real commit.
    assert_eq!(store.list(10).unwrap().len(), 1);
    assert_eq!(store.list(10).unwrap()[0].message, "user commit");

    // A checkpoint commits on the same branch, child of the user's commit.
    write(root, "model.py", "y = True  # edited\n");
    let created = store
        .checkpoint_selective("via app", &["model.py".to_string()])
        .unwrap()
        .unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), created.id);
    assert_eq!(head.parent(0).unwrap().id(), user_head);

    // No private ref is created — this is the user's real history.
    assert!(repo.find_reference("refs/bioeng/checkpoints").is_err());
}

#[test]
fn commits_use_the_repo_configured_identity() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let repo = Repository::init(root).unwrap();
    {
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Ada Lovelace").unwrap();
        config.set_str("user.email", "ada@example.com").unwrap();
    }
    write(root, "main.py", "x = 1\n");

    let store = HistoryStore::open(root).unwrap();
    let checkpoint = store.checkpoint("init").unwrap().unwrap();
    assert_eq!(checkpoint.committer_name, "Ada Lovelace");
    assert_eq!(checkpoint.committer_email, "ada@example.com");
}

#[test]
fn lake_gitignore_excludes_build_artifacts() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "main.py", "x = 1\n");
    write(root, ".lake/build/junk.o", "binary noise");

    ensure_lake_gitignore(root).unwrap();
    let store = HistoryStore::init(root).unwrap();
    let gitignore = fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(gitignore.contains(".lake/"));

    let checkpoint = store.checkpoint("init").unwrap().unwrap();
    let changes = store.changes(&checkpoint.id).unwrap();
    let paths: Vec<&str> = changes.iter().map(|c| c.path.as_str()).collect();
    assert!(paths.contains(&"main.py"));
    assert!(paths.contains(&".gitignore"));
    assert!(
        !paths.iter().any(|p| p.starts_with(".lake")),
        "build artifacts must never be checkpointed: {paths:?}"
    );
}

#[test]
fn checkpoint_leaves_a_clean_git_status() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "main.py", "x = 1\n");
    write(root, ".lake/build/junk.o", "ignored noise");

    ensure_lake_gitignore(root).unwrap();
    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("Project created").unwrap().unwrap();

    // The committed tree, the index, and the worktree must all agree — no
    // phantom "staged: deleted" / "untracked" entries.
    let repo = Repository::open(root).unwrap();
    assert!(
        dirty_paths(&repo).is_empty(),
        "git status should be clean after a checkpoint, got: {:?}",
        dirty_paths(&repo)
    );
}

fn add_blob(repo: &Repository, index: &mut git2::Index, path: &str, contents: &[u8]) {
    let oid = repo.blob(contents).unwrap();
    index
        .add(&git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o100644,
            uid: 0,
            gid: 0,
            file_size: 0,
            id: oid,
            flags: 0,
            flags_extended: 0,
            path: path.as_bytes().to_vec(),
        })
        .unwrap();
}

#[test]
fn checkpoint_heals_an_index_left_stale_by_an_out_of_band_commit() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "main.py", "x = 1\n");
    write(root, ".gitignore", ".lake/\n");

    // Reproduce the old bug: commit a tree to HEAD without ever touching the
    // on-disk index (as a tree built from an in-memory index would).
    {
        let repo = Repository::init(root).unwrap();
        let mut mem = git2::Index::new().unwrap();
        add_blob(&repo, &mut mem, "main.py", b"x = 1\n");
        add_blob(&repo, &mut mem, ".gitignore", b".lake/\n");
        let tree = repo.find_tree(mem.write_tree_to(&repo).unwrap()).unwrap();
        let sig = git2::Signature::now("Bio Eng Studio", "history@bioeng.local").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "stale", &tree, &[])
            .unwrap();
        assert!(
            !dirty_paths(&repo).is_empty(),
            "precondition: the out-of-band commit should leave a dirty index"
        );
    }

    // Reads must NOT repair; opening leaves the stale index as-is.
    let store = HistoryStore::open(root).unwrap();

    // A checkpoint — even a no-op one, since the worktree already matches HEAD —
    // syncs the index, healing the repo.
    assert!(
        store.checkpoint("heal").unwrap().is_none(),
        "nothing changed, so no new commit"
    );
    let repo = Repository::open(root).unwrap();
    assert!(
        dirty_paths(&repo).is_empty(),
        "checkpoint should heal the stale index, got: {:?}",
        dirty_paths(&repo)
    );
}

#[test]
fn init_is_idempotent_over_a_pre_initialized_repo() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    // Mimic a tool having already run `git init`.
    Repository::init(root).unwrap();
    write(root, "main.py", "x = 1\n");

    let store = HistoryStore::init(root).unwrap();
    assert!(store.checkpoint("init").unwrap().is_some());
    // Re-opening must not fail or wipe history.
    let reopened = HistoryStore::open(root).unwrap();
    assert_eq!(reopened.list(10).unwrap().len(), 1);
}

#[test]
fn working_changes_lists_edits_adds_and_deletes_excluding_lake() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "keep.py", "keep 1\n");
    write(root, "gone.py", "to be deleted\n");

    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("baseline").unwrap().unwrap();

    // Diverge from the checkpoint without committing.
    write(root, "keep.py", "keep 2 (edited)\n");
    fs::remove_file(root.join("gone.py")).unwrap();
    write(root, "new.py", "added after baseline\n");
    write(root, ".lake/build/junk.o", "build noise");

    let changes = store.working_changes().unwrap();
    assert_eq!(status_of(&changes, "keep.py"), Some("modified"));
    assert_eq!(status_of(&changes, "gone.py"), Some("deleted"));
    assert_eq!(status_of(&changes, "new.py"), Some("added"));
    assert!(
        !changes
            .iter()
            .any(|change| change.path.starts_with(".lake")),
        "build artifacts must never appear as changes: {changes:?}"
    );
}

#[test]
fn working_changes_respects_the_repos_gitignore() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "main.py", "x = 1\n");
    write(root, ".gitignore", "secrets.txt\n");

    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("baseline").unwrap().unwrap();

    // A new file the repo's own .gitignore excludes must not appear.
    write(root, "secrets.txt", "do not commit me\n");
    write(root, "main.py", "x = 2\n");
    let changes = store.working_changes().unwrap();
    assert_eq!(status_of(&changes, "main.py"), Some("modified"));
    assert!(
        !changes.iter().any(|change| change.path == "secrets.txt"),
        "gitignored files must not show as changes: {changes:?}"
    );
}

#[test]
fn selective_checkpoint_commits_only_selected_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "a.py", "a1\n");
    write(root, "b.py", "b1\n");

    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("baseline").unwrap().unwrap();

    write(root, "a.py", "a2\n");
    write(root, "b.py", "b2\n");

    // Commit only A; B's edit must remain an uncommitted working change.
    let created = store
        .checkpoint_selective("just A", &["a.py".to_string()])
        .unwrap()
        .unwrap();

    let committed: Vec<String> = store
        .changes(&created.id)
        .unwrap()
        .into_iter()
        .map(|change| change.path)
        .collect();
    assert_eq!(
        committed,
        vec!["a.py".to_string()],
        "only A should be checkpointed"
    );
    assert_eq!(store.file_at(&created.id, "a.py").unwrap(), "a2\n");

    let working: Vec<String> = store
        .working_changes()
        .unwrap()
        .into_iter()
        .map(|change| change.path)
        .collect();
    assert_eq!(working, vec!["b.py".to_string()]);

    // The on-disk index tracks the committed tree, so A reads clean and only
    // B's unstaged edit shows.
    let repo = Repository::open(root).unwrap();
    assert_eq!(dirty_paths(&repo), vec!["b.py".to_string()]);
}

#[test]
fn selective_checkpoint_returns_none_when_selection_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "a.py", "a1\n");
    write(root, "b.py", "b1\n");

    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("baseline").unwrap().unwrap();

    // Edit only B, then deselect it (commit an empty selection).
    write(root, "b.py", "b2\n");
    assert!(store
        .checkpoint_selective("nothing", &[])
        .unwrap()
        .is_none());
    // B's edit survives as a working change.
    assert_eq!(store.working_changes().unwrap().len(), 1);
}

#[test]
fn file_diff_at_returns_both_sides_for_modify_and_add() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "m.py", "first\n");

    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("v1").unwrap().unwrap();

    write(root, "m.py", "second\n");
    write(root, "added.py", "added\n");
    let v2 = store.checkpoint("v2").unwrap().unwrap();

    let modified = store.file_diff_at(&v2.id, "m.py").unwrap();
    assert_eq!(modified.status, "modified");
    assert_eq!(modified.before.as_deref(), Some("first\n"));
    assert_eq!(modified.after.as_deref(), Some("second\n"));

    let added = store.file_diff_at(&v2.id, "added.py").unwrap();
    assert_eq!(added.status, "added");
    assert!(added.before.is_none());
    assert_eq!(added.after.as_deref(), Some("added\n"));
}

#[test]
fn working_file_diff_compares_last_checkpoint_to_disk() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "base.py", "base\n");

    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("v1").unwrap().unwrap();

    write(root, "base.py", "base edited\n");
    let diff = store.working_file_diff("base.py").unwrap();
    assert_eq!(diff.status, "modified");
    assert_eq!(diff.before.as_deref(), Some("base\n"));
    assert_eq!(diff.after.as_deref(), Some("base edited\n"));
}

#[test]
fn history_status_reports_a_folder_with_no_repo() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "main.py", "x = 1\n");

    let status = history_status(root).unwrap();
    assert!(!status.is_repo);
    assert_eq!(status.checkpoint_count, 0);
}

#[test]
fn restore_file_overwrites_without_committing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "main.py", "x = 1\n");

    let store = HistoryStore::init(root).unwrap();
    let original = store.checkpoint("v1").unwrap().unwrap();
    let before = store.list(10).unwrap().len();

    write(root, "main.py", "x = 999  # oops\n");
    let result = store.restore_file(&original.id, "main.py").unwrap();

    // The file is back to v1...
    assert_eq!(fs::read_to_string(root.join("main.py")).unwrap(), "x = 1\n");
    assert_eq!(result.restored, vec!["main.py".to_string()]);
    // ...and no commit was added — restore is a working-tree change only.
    assert_eq!(store.list(10).unwrap().len(), before);
}

#[test]
fn restore_workspace_adds_deletes_and_rewrites_without_committing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "keep.py", "keep 1\n");
    write(root, "gone.py", "will be deleted later\n");

    let store = HistoryStore::init(root).unwrap();
    let snapshot = store.checkpoint("baseline").unwrap().unwrap();
    let before = store.list(10).unwrap().len();

    // Diverge: modify Keep, delete Gone, add New.
    write(root, "keep.py", "keep 2 (edited)\n");
    fs::remove_file(root.join("gone.py")).unwrap();
    write(root, "new.py", "added after baseline\n");

    store.restore_workspace(&snapshot.id).unwrap();

    // Back to the baseline tree exactly.
    assert_eq!(
        fs::read_to_string(root.join("keep.py")).unwrap(),
        "keep 1\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("gone.py")).unwrap(),
        "will be deleted later\n"
    );
    assert!(
        !root.join("new.py").exists(),
        "files added after the checkpoint should be removed on restore"
    );
    // No safety commit added.
    assert_eq!(store.list(10).unwrap().len(), before);
}

#[test]
fn discard_reverts_tracked_files_but_keeps_new_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "keep.py", "v1\n");
    write(root, "gone.py", "present at the tip\n");

    let store = HistoryStore::init(root).unwrap();
    store.checkpoint("baseline").unwrap().unwrap();
    write(root, "keep.py", "v2\n");
    store.checkpoint("second").unwrap().unwrap();
    let before = store.list(10).unwrap().len();

    // Diverge from the tip: edit a tracked file, delete another, add a new one.
    write(root, "keep.py", "v3 (uncommitted)\n");
    fs::remove_file(root.join("gone.py")).unwrap();
    write(root, "new.py", "brand new, never checkpointed\n");

    store.discard_working_changes().unwrap();

    // Tracked files return to the most recent checkpoint: the edit is reverted
    // and the deletion is undone.
    assert_eq!(fs::read_to_string(root.join("keep.py")).unwrap(), "v2\n");
    assert_eq!(
        fs::read_to_string(root.join("gone.py")).unwrap(),
        "present at the tip\n"
    );
    // A `git checkout .` never deletes: the new file is left exactly as it was.
    assert_eq!(
        fs::read_to_string(root.join("new.py")).unwrap(),
        "brand new, never checkpointed\n",
        "discard must not delete files added since the last checkpoint"
    );
    // No commit added.
    assert_eq!(store.list(10).unwrap().len(), before);
}

#[test]
fn discard_working_changes_errors_without_a_checkpoint() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "draft.py", "no checkpoint yet\n");

    let store = HistoryStore::init(root).unwrap();
    assert!(store.discard_working_changes().is_err());
}
