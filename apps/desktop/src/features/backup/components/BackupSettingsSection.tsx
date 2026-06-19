import { useCallback, useEffect, useState } from "react";

import {
  chooseLocalBackupFolder,
  chooseRecoveryKeyExportPath,
  createLocalBackup,
  executeLocalBackupRestore,
  exportBackupRecoveryKey,
  getBackupErrorMessage,
  listBackupActivity,
  listLocalBackups,
  loadBackupKeyStatus,
  loadBackupTaskStatus,
  planLocalBackupRestore,
} from "@/features/backup/backup-service";
import type {
  BackupActivityEntry,
  BackupKeyStatus,
  BackupRestoreExecuteResult,
  BackupSnapshotSummary,
  BackupTaskStatus,
} from "@/features/backup/backup.types";
import {
  BACKUP_INTERVAL_MINUTES_MAX,
  BACKUP_INTERVAL_MINUTES_MIN,
  type BackupSettings,
  normalizeBackupIntervalMinutes,
  useAppSettings,
} from "@/features/settings";
import { saveAppSettings } from "@/features/settings/settings-service";
import { useAsyncResource } from "@/lib/use-async-resource";
import {
  AlertCircle,
  Button,
  CheckCircle2,
  FolderOpen,
  History,
  KeyRound,
  LoaderCircle,
  Play,
  RotateCcw,
  Save,
  TimerReset,
  X,
} from "@/ui";

const settingsSectionClassName =
  "grid max-w-[760px] gap-3.5 [@container(max-width:520px)]:gap-3";

const settingsListClassName =
  "grid min-w-0 overflow-hidden rounded-[7px] border border-cg-border bg-cg-surface";

const settingsRowClassName =
  "grid min-w-0 grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-cg-border px-2.5 py-2 last:border-b-0 [@container(max-width:620px)]:grid-cols-[minmax(0,1fr)_auto] [@container(max-width:440px)]:grid-cols-1";

const settingsLabelClassName =
  "flex min-w-0 items-center gap-2 text-[12px] font-bold leading-tight text-cg-fg [@container(max-width:620px)]:col-span-full [&>svg]:text-cg-muted";

const detailClassName =
  "min-w-0 truncate text-[12px] font-semibold leading-tight text-cg-fg";

const mutedDetailClassName =
  "min-w-0 truncate text-[11px] font-semibold leading-tight text-cg-muted";

const compactButtonClassName = "h-7 rounded-[6px] px-2 text-[11.5px]";

const compactInputClassName =
  "h-7 w-[78px] rounded-[6px] border border-cg-border bg-cg-editor px-2 text-right font-[inherit] text-[12px] leading-none text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

type BackupAction = "choose" | "backup" | "export" | "refresh" | null;

export function BackupSettingsSection() {
  const { refreshSettings, setBackupSettings, settings } = useAppSettings();
  const [keyStatus, setKeyStatus] = useState<BackupKeyStatus | null>(null);
  const [taskStatus, setTaskStatus] = useState<BackupTaskStatus | null>(null);
  const [snapshots, setSnapshots] = useState<BackupSnapshotSummary[]>([]);
  const [activity, setActivity] = useState<BackupActivityEntry[]>([]);
  const [action, setAction] = useState<BackupAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [intervalDraft, setIntervalDraft] = useState(() =>
    String(settings.backup.automaticIntervalMinutes),
  );
  const [restoreSnapshot, setRestoreSnapshot] =
    useState<BackupSnapshotSummary | null>(null);
  const backupSettings = settings.backup;
  const localFolder = backupSettings.localFolder;
  const busy = action !== null;

  const [prevLocalFolder, setPrevLocalFolder] = useState(localFolder);
  if (prevLocalFolder !== localFolder) {
    setPrevLocalFolder(localFolder);
    setError(null);
    if (!localFolder) {
      setSnapshots([]);
    }
  }

  const [prevIntervalMinutes, setPrevIntervalMinutes] = useState(
    backupSettings.automaticIntervalMinutes,
  );
  if (prevIntervalMinutes !== backupSettings.automaticIntervalMinutes) {
    setPrevIntervalMinutes(backupSettings.automaticIntervalMinutes);
    setIntervalDraft(String(backupSettings.automaticIntervalMinutes));
  }

  const refreshBackupState = useCallback(
    (includeSnapshots = false) => {
      void loadBackupKeyStatus()
        .then(setKeyStatus)
        .catch((error) => setError(getBackupErrorMessage(error)));
      void loadBackupTaskStatus()
        .then(setTaskStatus)
        .catch((error) => setError(getBackupErrorMessage(error)));
      void listBackupActivity()
        .then(setActivity)
        .catch((error) => setError(getBackupErrorMessage(error)));

      if (!localFolder || !includeSnapshots) {
        return;
      }

      void listLocalBackups()
        .then(setSnapshots)
        .catch((error) => setError(getBackupErrorMessage(error)));
    },
    [localFolder],
  );

  useEffect(() => {
    refreshBackupState();
  }, [refreshBackupState]);

  function handleAutomaticIntervalCommit() {
    const minutes = normalizeBackupIntervalMinutes(intervalDraft);
    setIntervalDraft(String(minutes));
    setBackupSettings({ automaticIntervalMinutes: minutes });
  }

  async function handleChooseFolder() {
    setAction("choose");
    setError(null);
    try {
      const selected = await chooseLocalBackupFolder();
      if (!selected) {
        return;
      }

      await saveAppSettings({
        ...settings,
        backup: {
          ...settings.backup,
          localFolder: selected,
        },
      });
      refreshSettings();
    } catch (error) {
      setError(getBackupErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function handleExportRecoveryKey() {
    setAction("export");
    setError(null);
    try {
      const selected = await chooseRecoveryKeyExportPath();
      if (!selected) {
        return;
      }

      const status = await exportBackupRecoveryKey(selected);
      setKeyStatus(status);
      refreshSettings();
    } catch (error) {
      setError(getBackupErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function handleBackupNow() {
    setAction("backup");
    setError(null);
    try {
      const snapshot = await createLocalBackup();
      setSnapshots((current) => [
        snapshot,
        ...current.filter((candidate) => candidate.id !== snapshot.id),
      ]);
      setTaskStatus(await loadBackupTaskStatus());
      setKeyStatus(await loadBackupKeyStatus());
      setActivity(await listBackupActivity());
      refreshSettings();
    } catch (error) {
      setError(getBackupErrorMessage(error));
      setTaskStatus(await loadBackupTaskStatus().catch(() => null));
    } finally {
      setAction(null);
    }
  }

  async function handleRefresh() {
    setAction("refresh");
    setError(null);
    try {
      await Promise.all([
        loadBackupKeyStatus().then(setKeyStatus),
        loadBackupTaskStatus().then(setTaskStatus),
        listBackupActivity().then(setActivity),
        localFolder ? listLocalBackups().then(setSnapshots) : Promise.resolve(),
      ]);
    } catch (error) {
      setError(getBackupErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  return (
    <section
      className={`${settingsSectionClassName} mb-6`}
      aria-labelledby="backup"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5 [@container(max-width:520px)]:items-start [@container(max-width:520px)]:gap-2 [@container(max-width:520px)]:self-start [@container(max-width:520px)]:flex-col">
        <h2
          className="m-0 text-[14px] font-bold leading-none text-cg-fg"
          id="backup"
        >
          Backup
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex-none text-[11px] font-semibold leading-none text-cg-muted [&[data-error]]:text-cg-danger"
            data-error={error ? "" : undefined}
          >
            {formatTaskStatus(taskStatus, error)}
          </span>
          <Button
            className={compactButtonClassName}
            disabled={busy}
            onClick={handleRefresh}
            size="none"
            variant="ghost"
          >
            {action === "refresh" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={13}
                strokeWidth={1.8}
              />
            ) : (
              <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            Refresh
          </Button>
          <Button
            className={compactButtonClassName}
            disabled={busy || !localFolder}
            onClick={handleBackupNow}
            size="none"
            variant="default"
          >
            {action === "backup" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={13}
                strokeWidth={1.8}
              />
            ) : (
              <Play aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            Backup Now
          </Button>
        </div>
      </header>

      <div className={settingsListClassName}>
        <div className={settingsRowClassName}>
          <div className={settingsLabelClassName}>
            <FolderOpen
              aria-hidden="true"
              className="flex-none"
              size={15}
              strokeWidth={1.8}
            />
            <span>Destination</span>
          </div>
          <div
            className={localFolder ? detailClassName : mutedDetailClassName}
            title={localFolder ?? undefined}
          >
            {localFolder ?? "Not selected"}
          </div>
          <Button
            className={compactButtonClassName}
            disabled={busy}
            onClick={handleChooseFolder}
            size="none"
            variant="ghost"
          >
            {action === "choose" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={13}
                strokeWidth={1.8}
              />
            ) : (
              <FolderOpen aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            Choose
          </Button>
        </div>

        <div className={settingsRowClassName}>
          <div className={settingsLabelClassName}>
            <TimerReset
              aria-hidden="true"
              className="flex-none"
              size={15}
              strokeWidth={1.8}
            />
            <span>Schedule</span>
          </div>
          <div className={mutedDetailClassName}>
            {formatAutomaticBackupStatus(backupSettings, localFolder)}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2 [@container(max-width:440px)]:justify-start">
            <label className="flex h-7 min-w-0 items-center gap-1.5 text-[11.5px] font-semibold leading-none text-cg-fg">
              <input
                checked={backupSettings.automaticBackupsEnabled}
                className="size-3.5 accent-cg-focus"
                onChange={(event) => {
                  setBackupSettings({
                    automaticBackupsEnabled: event.currentTarget.checked,
                  });
                }}
                type="checkbox"
              />
              <span>Enabled</span>
            </label>
            <label className="flex h-7 min-w-0 items-center gap-1.5 text-[11.5px] font-semibold leading-none text-cg-muted">
              <input
                aria-label="Automatic backup interval in minutes"
                className={compactInputClassName}
                inputMode="numeric"
                max={BACKUP_INTERVAL_MINUTES_MAX}
                min={BACKUP_INTERVAL_MINUTES_MIN}
                onBlur={handleAutomaticIntervalCommit}
                onChange={(event) =>
                  setIntervalDraft(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                type="number"
                value={intervalDraft}
              />
              <span>min</span>
            </label>
          </div>
        </div>

        <div className={settingsRowClassName}>
          <div className={settingsLabelClassName}>
            <KeyRound
              aria-hidden="true"
              className="flex-none"
              size={15}
              strokeWidth={1.8}
            />
            <span>Recovery Key</span>
          </div>
          <div className={mutedDetailClassName}>
            {formatRecoveryKeyStatus(
              keyStatus,
              backupSettings.recoveryKeyExportedAt,
            )}
          </div>
          <Button
            className={compactButtonClassName}
            disabled={busy}
            onClick={handleExportRecoveryKey}
            size="none"
            variant="ghost"
          >
            {action === "export" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={13}
                strokeWidth={1.8}
              />
            ) : (
              <Save aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            Export
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <History
              aria-hidden="true"
              className="flex-none text-cg-muted"
              size={15}
              strokeWidth={1.8}
            />
            <h3 className="m-0 text-[12.5px] font-bold leading-tight text-cg-fg">
              Snapshots
            </h3>
          </div>
          <span className="min-w-0 truncate text-[11px] font-semibold leading-tight text-cg-muted">
            {snapshots.length > 0 ? `${snapshots.length} available` : "None"}
            {backupSettings.lastBackup
              ? ` · Last ${formatDate(backupSettings.lastBackup.createdAt)}`
              : ""}
          </span>
        </div>

        {snapshots.length > 0 ? (
          <div className="min-w-0 overflow-hidden rounded-[7px] border border-cg-border bg-cg-surface">
            <div
              aria-hidden="true"
              className="grid min-w-0 grid-cols-[minmax(150px,1.2fr)_minmax(105px,0.75fr)_78px_70px_72px_80px_auto] items-center gap-3 border-b border-cg-border bg-cg-editor px-2.5 py-1.5 text-[10px] font-bold uppercase leading-none text-cg-muted [@container(max-width:720px)]:hidden"
            >
              <span>Date</span>
              <span>Device</span>
              <span>Size</span>
              <span>Schema</span>
              <span>Files</span>
              <span>Type</span>
              <span className="text-right">Action</span>
            </div>
            <div className="grid min-w-0">
              {snapshots.map((snapshot) => (
                <SnapshotRow
                  busy={busy}
                  key={snapshot.id}
                  onRestore={setRestoreSnapshot}
                  snapshot={snapshot}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-3 text-[11.5px] font-semibold leading-tight text-cg-muted">
            No local snapshots
          </div>
        )}
      </div>

      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="m-0 text-[12.5px] font-bold leading-tight text-cg-fg">
            Activity
          </h3>
          <span className="min-w-0 truncate text-[11px] font-semibold leading-tight text-cg-muted">
            {activity.length > 0 ? `${activity.length} recent` : "None"}
          </span>
        </div>

        {activity.length > 0 ? (
          <div className="grid min-w-0 overflow-hidden rounded-[7px] border border-cg-border bg-cg-surface">
            {activity.slice(0, 6).map((entry) => (
              <ActivityRow entry={entry} key={entry.id} />
            ))}
          </div>
        ) : (
          <div className="rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-3 text-[11.5px] font-semibold leading-tight text-cg-muted">
            No backup activity yet
          </div>
        )}
      </div>

      {error ? (
        <div className="flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-danger/35 bg-cg-danger/10 px-2.5 py-2 text-[11.5px] leading-snug text-cg-danger">
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 flex-none"
            size={14}
            strokeWidth={1.8}
          />
          <span className="min-w-0">{error}</span>
        </div>
      ) : null}

      {restoreSnapshot ? (
        <RestoreDialog
          onClose={() => setRestoreSnapshot(null)}
          onRestoreStaged={() => {
            void handleRefresh();
          }}
          snapshot={restoreSnapshot}
        />
      ) : null}
    </section>
  );
}

function SnapshotRow({
  busy,
  onRestore,
  snapshot,
}: {
  busy: boolean;
  onRestore: (snapshot: BackupSnapshotSummary) => void;
  snapshot: BackupSnapshotSummary;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(150px,1.2fr)_minmax(105px,0.75fr)_78px_70px_72px_80px_auto] items-center gap-3 border-b border-cg-border px-2.5 py-1.5 text-[11.5px] font-semibold leading-tight text-cg-fg last:border-b-0 hover:bg-cg-surface-hover [@container(max-width:720px)]:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="truncate">{formatDate(snapshot.createdAt)}</div>
        <div className="hidden truncate text-[10.5px] font-semibold leading-tight text-cg-muted [@container(max-width:720px)]:block">
          {snapshot.deviceName} · {formatBytes(snapshot.totalBytes)} · schema{" "}
          {snapshot.schemaVersion} · {snapshot.attachmentCount} files ·{" "}
          {formatSnapshotType(snapshot)}
        </div>
      </div>
      <div className="truncate text-cg-muted [@container(max-width:720px)]:hidden">
        {snapshot.deviceName}
      </div>
      <div className="truncate text-cg-muted [@container(max-width:720px)]:hidden">
        {formatBytes(snapshot.totalBytes)}
      </div>
      <div className="truncate text-cg-muted [@container(max-width:720px)]:hidden">
        {snapshot.schemaVersion}
      </div>
      <div className="truncate text-cg-muted [@container(max-width:720px)]:hidden">
        {snapshot.attachmentCount}
      </div>
      <div className="truncate text-cg-muted [@container(max-width:720px)]:hidden">
        {formatSnapshotType(snapshot)}
      </div>
      <div className="flex justify-end">
        <Button
          className={compactButtonClassName}
          disabled={busy}
          onClick={() => onRestore(snapshot)}
          size="none"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
          Restore
        </Button>
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: BackupActivityEntry }) {
  const failed = entry.status === "failed";
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-cg-border px-2.5 py-1.5 text-[11.5px] font-semibold leading-tight last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        {failed ? (
          <AlertCircle
            aria-hidden="true"
            className="flex-none text-cg-danger"
            size={13}
            strokeWidth={1.8}
          />
        ) : (
          <CheckCircle2
            aria-hidden="true"
            className="flex-none text-cg-muted"
            size={13}
            strokeWidth={1.8}
          />
        )}
        <div className="min-w-0">
          <div
            className={`truncate ${failed ? "text-cg-danger" : "text-cg-fg"}`}
          >
            {formatActivityTitle(entry)}
          </div>
          <div className="truncate text-[10.5px] text-cg-muted">
            {formatActivityDetail(entry)}
          </div>
        </div>
      </div>
      <span className="min-w-0 truncate text-[10.5px] text-cg-muted">
        {formatDate(entry.startedAt)}
      </span>
    </div>
  );
}

function RestoreDialog({
  onClose,
  onRestoreStaged,
  snapshot,
}: {
  onClose: () => void;
  onRestoreStaged: () => void;
  snapshot: BackupSnapshotSummary;
}) {
  const planResource = useAsyncResource(snapshot.id, (snapshotId) =>
    planLocalBackupRestore(snapshotId).catch((error: unknown) => {
      throw new Error(getBackupErrorMessage(error));
    }),
  );
  const plan = planResource.data;
  const [result, setResult] = useState<BackupRestoreExecuteResult | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const busy = stageBusy || planResource.loading;
  const error = stageError ?? planResource.error;

  async function handleStageRestore() {
    setStageBusy(true);
    setStageError(null);
    try {
      const output = await executeLocalBackupRestore(snapshot.id);
      setResult(output);
      onRestoreStaged();
    } catch (error) {
      setStageError(getBackupErrorMessage(error));
    } finally {
      setStageBusy(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      role="dialog"
    >
      <div className="grid max-h-[min(520px,calc(100vh-32px))] w-[min(520px,calc(100vw-32px))] min-w-0 gap-3 overflow-auto rounded-[8px] border border-cg-border bg-cg-surface p-3 shadow-xl">
        <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-b border-cg-border pb-2">
          <div className="min-w-0">
            <h3 className="m-0 text-[14px] font-bold leading-tight text-cg-fg">
              Restore Backup
            </h3>
            <div className="mt-1 text-[11px] font-semibold leading-tight text-cg-muted">
              {formatDate(snapshot.createdAt)}
            </div>
          </div>
          <Button
            aria-label="Close restore dialog"
            className="size-7 rounded-[6px] p-0"
            disabled={busy}
            onClick={onClose}
            size="none"
            variant="ghost"
          >
            <X aria-hidden="true" size={14} strokeWidth={1.8} />
          </Button>
        </header>

        {busy && !plan ? (
          <div className="flex items-center gap-2 text-[12px] font-semibold text-cg-muted">
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
              size={14}
              strokeWidth={1.8}
            />
            Verifying snapshot
          </div>
        ) : null}

        {plan ? (
          <div className="grid gap-2 text-[12px] leading-snug text-cg-fg">
            <div className="grid grid-cols-2 gap-2 [@container(max-width:420px)]:grid-cols-1">
              <PlanMetric label="Objects" value={String(plan.objectCount)} />
              <PlanMetric
                label="Size"
                value={formatBytes(plan.requiredBytes)}
              />
              <PlanMetric
                label="Schema"
                value={String(plan.snapshot.schemaVersion)}
              />
              <PlanMetric
                label="Attachments"
                value={String(plan.snapshot.attachmentCount)}
              />
            </div>
            {plan.warnings.map((warning) => (
              <div
                className="rounded-[6px] border border-cg-border bg-cg-editor px-2 py-1.5 text-[11.5px] leading-snug text-cg-muted"
                key={warning}
              >
                {warning}
              </div>
            ))}
          </div>
        ) : null}

        {result ? (
          <div className="flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-success/35 bg-cg-success/10 px-2.5 py-2 text-[11.5px] leading-snug text-cg-success">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 flex-none"
              size={14}
              strokeWidth={1.8}
            />
            <span className="min-w-0">
              Restore staged. Restart Bio Eng Studio to install it.
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-danger/35 bg-cg-danger/10 px-2.5 py-2 text-[11.5px] leading-snug text-cg-danger">
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 flex-none"
              size={14}
              strokeWidth={1.8}
            />
            <span className="min-w-0">{error}</span>
          </div>
        ) : null}

        <footer className="flex min-w-0 justify-end gap-2">
          <Button
            className={compactButtonClassName}
            disabled={busy}
            onClick={onClose}
            size="none"
            variant="ghost"
          >
            {result ? "Close" : "Cancel"}
          </Button>
          {!result ? (
            <Button
              className={compactButtonClassName}
              disabled={busy || !plan}
              onClick={handleStageRestore}
              size="none"
              variant="default"
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                  size={13}
                  strokeWidth={1.8}
                />
              ) : (
                <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
              )}
              Stage Restore
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function PlanMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-cg-border bg-cg-editor px-2 py-1.5">
      <div className="text-[10.5px] font-bold leading-tight text-cg-muted">
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-bold leading-tight text-cg-fg">
        {value}
      </div>
    </div>
  );
}

function formatSnapshotType(snapshot: BackupSnapshotSummary) {
  return snapshot.manual ? "Manual" : "Auto";
}

function formatActivityTitle(entry: BackupActivityEntry) {
  const operation =
    entry.operation === "backup"
      ? "Backup"
      : entry.operation === "restore"
        ? "Restore"
        : "Retention";

  if (entry.status === "failed") {
    return `${operation} failed`;
  }
  if (entry.status === "skipped") {
    return `${operation} skipped`;
  }
  if (entry.status === "started") {
    return `${operation} started`;
  }
  return `${operation} complete`;
}

function formatActivityDetail(entry: BackupActivityEntry) {
  if (entry.errorMessage) {
    return entry.errorMessage;
  }
  if (entry.message) {
    return entry.message;
  }
  if (entry.bytesCompleted > 0) {
    return formatBytes(entry.bytesCompleted);
  }
  return entry.snapshotId ?? "Local folder";
}

function formatAutomaticBackupStatus(
  backupSettings: BackupSettings,
  localFolder: string | null,
) {
  if (!localFolder) {
    return "Waiting for local folder";
  }

  if (!backupSettings.automaticBackupsEnabled) {
    return "Disabled";
  }

  const baseStatus = `Every ${backupSettings.automaticIntervalMinutes} min`;
  return backupSettings.lastAutomaticBackupAttemptedAt
    ? `${baseStatus} · Last attempt ${formatDate(
        backupSettings.lastAutomaticBackupAttemptedAt,
      )}`
    : baseStatus;
}

function formatRecoveryKeyStatus(
  keyStatus: BackupKeyStatus | null,
  exportedAt: string | null,
) {
  if (!keyStatus) {
    return "Checking";
  }

  if (!keyStatus.masterKeyPresent) {
    return "Not created";
  }

  const exported = keyStatus.recoveryKeyExportedAt ?? exportedAt;
  return exported ? `Exported ${formatDate(exported)}` : "Not exported";
}

function formatTaskStatus(
  status: BackupTaskStatus | null,
  error: string | null,
) {
  if (error) {
    return "Backup Error";
  }

  if (!status || status.state === "idle") {
    return "Idle";
  }

  if (status.state === "backing_up") {
    return "Backing Up";
  }
  if (status.state === "restoring") {
    return "Staging Restore";
  }
  if (status.state === "restore_ready") {
    return "Restart Required";
  }
  if (status.state === "restore_failed") {
    return "Restore Error";
  }
  if (status.state === "failed") {
    return "Backup Error";
  }
  return "Complete";
}

function formatDate(value: string) {
  const date = /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
