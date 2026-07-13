import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type {
  BackupActivityEntry,
  BackupKeyStatus,
  BackupRestoreExecuteResult,
  BackupRestorePlan,
  BackupSnapshotSummary,
  BackupTaskStatus,
} from "@/features/backup/backup.types";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function tauriRequired(): never {
  throw new Error("Backup requires the Tauri runtime.");
}

export async function chooseLocalBackupFolder() {
  if (!isTauriRuntime()) {
    tauriRequired();
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose GG Circuit Backup Folder",
  });

  return typeof selected === "string" ? selected : null;
}

export async function chooseRecoveryKeyExportPath() {
  if (!isTauriRuntime()) {
    tauriRequired();
  }

  return save({
    defaultPath: "gg-recovery-key.txt",
    filters: [{ name: "Text", extensions: ["txt"] }],
    title: "Export GG Circuit Recovery Key",
  });
}

export async function loadBackupKeyStatus() {
  if (!isTauriRuntime()) {
    return {
      masterKeyPresent: false,
      recoveryKeyExported: false,
      recoveryKeyExportedAt: null,
    } satisfies BackupKeyStatus;
  }

  return invoke<BackupKeyStatus>("backup_key_status");
}

export async function exportBackupRecoveryKey(path: string) {
  if (!isTauriRuntime()) {
    tauriRequired();
  }

  return invoke<BackupKeyStatus>("backup_recovery_key_export", { path });
}

export async function createLocalBackup() {
  if (!isTauriRuntime()) {
    tauriRequired();
  }

  return invoke<BackupSnapshotSummary>("backup_local_create");
}

export async function listLocalBackups() {
  if (!isTauriRuntime()) {
    return [] satisfies BackupSnapshotSummary[];
  }

  return invoke<BackupSnapshotSummary[]>("backup_local_list");
}

export async function planLocalBackupRestore(snapshotId: string) {
  if (!isTauriRuntime()) {
    tauriRequired();
  }

  return invoke<BackupRestorePlan>("backup_local_restore_plan", { snapshotId });
}

export async function executeLocalBackupRestore(snapshotId: string) {
  if (!isTauriRuntime()) {
    tauriRequired();
  }

  return invoke<BackupRestoreExecuteResult>("backup_local_restore_execute", {
    snapshotId,
  });
}

export async function loadBackupTaskStatus() {
  if (!isTauriRuntime()) {
    return {
      state: "idle",
      snapshotId: null,
      message: null,
      startedAt: null,
      finishedAt: null,
      bytesTotal: null,
      bytesCompleted: null,
      error: null,
    } satisfies BackupTaskStatus;
  }

  return invoke<BackupTaskStatus>("backup_task_status");
}

export async function listBackupActivity(limit = 8) {
  if (!isTauriRuntime()) {
    return [] satisfies BackupActivityEntry[];
  }

  return invoke<BackupActivityEntry[]>("backup_activity_list", { limit });
}

export function getBackupErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
