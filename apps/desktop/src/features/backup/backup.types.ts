export type BackupSnapshotSummary = {
  id: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  totalBytes: number;
  deviceName: string;
  attachmentCount: number;
  manual: boolean;
};

export type BackupKeyStatus = {
  masterKeyPresent: boolean;
  recoveryKeyExported: boolean;
  recoveryKeyExportedAt: string | null;
};

export type BackupRestorePlan = {
  snapshot: BackupSnapshotSummary;
  requiredBytes: number;
  objectCount: number;
  warnings: string[];
};

export type BackupRestoreExecuteResult = {
  restartRequired: boolean;
  snapshotId: string;
  stagingPath: string;
};

export type BackupTaskStatus = {
  state:
    | "idle"
    | "backing_up"
    | "complete"
    | "failed"
    | "restoring"
    | "restore_ready"
    | "restore_failed";
  snapshotId: string | null;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  bytesTotal: number | null;
  bytesCompleted: number | null;
  error: string | null;
};

export type BackupActivityEntry = {
  id: string;
  provider: string;
  operation: "backup" | "restore" | "retention";
  status: "started" | "complete" | "failed" | "skipped";
  snapshotId: string | null;
  startedAt: string;
  finishedAt: string | null;
  bytesTotal: number;
  bytesCompleted: number;
  errorCode: string | null;
  errorMessage: string | null;
  message: string;
};
