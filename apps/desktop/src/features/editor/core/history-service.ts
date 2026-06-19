import { invoke } from "@tauri-apps/api/core";

/// A workspace checkpoint (a commit on the folder's git branch). `createdAtUnix`
/// is in seconds.
export type CheckpointSummary = {
  id: string;
  createdAtUnix: number;
  message: string;
  changeCount: number;
  committerName: string;
  committerEmail: string;
};

/// One file changed within a checkpoint (or the working tree). `status` is the
/// git status word ("added" | "deleted" | "renamed" | "modified").
export type CheckpointChange = {
  path: string;
  status: string;
};

/// Both sides of a file's change, for a diff view. A side is `null` when the
/// file didn't exist there (added → no `before`; deleted → no `after`).
export type CheckpointFileDiff = {
  before: string | null;
  after: string | null;
  status: string;
};

export type HistoryStatus = {
  isRepo: boolean;
  checkpointCount: number;
  lastCheckpointAtUnix: number | null;
};

export type RestoreResult = {
  restored: string[];
};

/// History — a general-purpose view and manager of the workspace's real git
/// branch (HEAD). Identical for every repo; commands take just the `root`.
export function workspaceHistoryStatus(root: string) {
  return invoke<HistoryStatus>("workspace_history_status", { root });
}

/// Initialize a git repository in `root` (when the folder has none yet).
export function workspaceHistoryInitRepo(root: string) {
  return invoke<HistoryStatus>("workspace_history_init_repo", { root });
}

/// Record a checkpoint (commit the whole worktree). Resolves to `null` when
/// nothing changed.
export function workspaceHistoryCheckpoint(root: string, reason?: string) {
  return invoke<CheckpointSummary | null>("workspace_history_checkpoint", {
    reason: reason ?? null,
    root,
  });
}

export function workspaceHistoryList(root: string, limit: number) {
  return invoke<CheckpointSummary[]>("workspace_history_list", {
    limit,
    root,
  });
}

export function workspaceHistoryChanges(root: string, checkpointId: string) {
  return invoke<CheckpointChange[]>("workspace_history_changes", {
    checkpointId,
    root,
  });
}

/// Files in the worktree that differ from the last checkpoint — the staging
/// candidates for a new checkpoint.
export function workspaceHistoryWorkingChanges(root: string) {
  return invoke<CheckpointChange[]>("workspace_history_working_changes", {
    root,
  });
}

/// Both sides of a working-tree change (last checkpoint vs. current on disk),
/// for the review diff.
export function workspaceHistoryWorkingFileDiff(root: string, path: string) {
  return invoke<CheckpointFileDiff>("workspace_history_working_file_diff", {
    path,
    root,
  });
}

/// Both sides of a file's change within a past checkpoint (vs. its parent), for
/// a read-only diff view.
export function workspaceHistoryFileDiff(
  root: string,
  checkpointId: string,
  path: string,
) {
  return invoke<CheckpointFileDiff>("workspace_history_file_diff", {
    checkpointId,
    path,
    root,
  });
}

/// Record a checkpoint containing only the selected files, leaving every other
/// working change uncommitted. Resolves to `null` when the selection changes
/// nothing.
export function workspaceHistoryCheckpointSelective(
  root: string,
  message: string,
  paths: string[],
) {
  return invoke<CheckpointSummary | null>(
    "workspace_history_checkpoint_selective",
    { message, paths, root },
  );
}

/// The text of a file at a checkpoint, for previewing before restoring.
export function workspaceHistoryFileAt(
  root: string,
  checkpointId: string,
  path: string,
) {
  return invoke<string>("workspace_history_file_at", {
    checkpointId,
    path,
    root,
  });
}

/// Restore a single file to a checkpoint, overwriting the working copy. The
/// caller confirms first; no commit is added.
export function workspaceHistoryRestoreFile(
  root: string,
  checkpointId: string,
  path: string,
) {
  return invoke<RestoreResult>("workspace_history_restore_file", {
    checkpointId,
    path,
    root,
  });
}

/// Restore the whole workspace to a checkpoint, overwriting the working tree.
/// The caller confirms first; no commit is added.
export function workspaceHistoryRestoreWorkspace(
  root: string,
  checkpointId: string,
) {
  return invoke<RestoreResult>("workspace_history_restore_workspace", {
    checkpointId,
    root,
  });
}

/// Discard every uncommitted change, returning the working tree to the last
/// checkpoint (HEAD). The caller confirms first; no commit is added.
export function workspaceHistoryDiscardWorkingChanges(root: string) {
  return invoke<RestoreResult>("workspace_history_discard_working_changes", {
    root,
  });
}
