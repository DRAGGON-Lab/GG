use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, TryLockError},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use bioeng_backup::{
    generate_master_key, install_staged_restore, master_key_from_recovery_key,
    recovery_key_for_master_key, stores::FileSystemBackupStore, BackupCreateRequest, BackupEngine,
    BackupMasterKey, BackupRestorePlan, BackupRestoreRequest, BackupRetentionPlan,
    BackupRetentionPolicy,
};
use bioeng_data::backup::{BackupActivityEntry, BackupActivityInput};
use bioeng_data::{
    settings::{AppSettings, BackupSnapshotSettings},
    Database,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::secrets::{
    store::SecretStore,
    types::{current_timestamp_millis_string, SecretHandle, SecretString},
    KeychainSecretStore,
};

#[derive(Default)]
pub struct BackupTaskState {
    operation: Mutex<()>,
    status: Mutex<BackupTaskStatus>,
}

const BACKUP_SCHEDULER_POLL_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTaskStatus {
    pub state: String,
    pub snapshot_id: Option<String>,
    pub message: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub bytes_total: Option<u64>,
    pub bytes_completed: Option<u64>,
    pub error: Option<String>,
}

impl Default for BackupTaskStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            snapshot_id: None,
            message: None,
            started_at: None,
            finished_at: None,
            bytes_total: None,
            bytes_completed: None,
            error: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupKeyStatus {
    pub master_key_present: bool,
    pub recovery_key_exported: bool,
    pub recovery_key_exported_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreExecuteResult {
    pub restart_required: bool,
    pub snapshot_id: String,
    pub staging_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingRestoreJournal {
    restore_id: String,
    snapshot_id: String,
    staging_path: PathBuf,
    created_at: String,
}

#[tauri::command]
pub fn backup_key_status(database: State<'_, Database>) -> Result<BackupKeyStatus, String> {
    backup_key_status_from_database(&database)
}

#[tauri::command]
pub fn backup_recovery_key_export(
    database: State<'_, Database>,
    secret_store: State<'_, KeychainSecretStore>,
    path: String,
) -> Result<BackupKeyStatus, String> {
    let path = PathBuf::from(path);
    let master_key = load_or_create_master_key(&*secret_store)?;
    let recovery_key =
        recovery_key_for_master_key(&master_key).map_err(|error| error.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, recovery_key_file_contents(&recovery_key))
        .map_err(|error| error.to_string())?;

    let mut settings = database.load_app_settings()?;
    if settings.backup.master_key_created_at.is_none() {
        settings.backup.master_key_created_at = Some(current_timestamp_millis_string());
    }
    settings.backup.recovery_key_exported_at = Some(current_timestamp_millis_string());
    let status = backup_key_status_from_settings(settings.clone());
    database.save_app_settings(&settings)?;
    Ok(status)
}

#[tauri::command]
pub fn backup_local_create(
    app: AppHandle,
    database: State<'_, Database>,
    secret_store: State<'_, KeychainSecretStore>,
    task_state: State<'_, BackupTaskState>,
) -> Result<bioeng_backup::BackupSnapshotSummary, String> {
    create_local_backup(
        &app,
        database.inner(),
        secret_store.inner(),
        task_state.inner(),
        true,
        "Creating encrypted backup",
        "Backup complete",
    )
}

#[tauri::command]
pub fn backup_local_list(
    app: AppHandle,
    database: State<'_, Database>,
    secret_store: State<'_, KeychainSecretStore>,
) -> Result<Vec<bioeng_backup::BackupSnapshotSummary>, String> {
    let Some(master_key) = read_master_key(&*secret_store)? else {
        return Ok(Vec::new());
    };
    mark_backup_master_key_present(&database)?;
    let (backup_root, _, _) = backup_context(&app, &database)?;
    let store = FileSystemBackupStore::new(backup_root);
    BackupEngine::new(store)
        .list_snapshots(&master_key)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn backup_local_restore_plan(
    app: AppHandle,
    database: State<'_, Database>,
    secret_store: State<'_, KeychainSecretStore>,
    snapshot_id: String,
) -> Result<BackupRestorePlan, String> {
    let master_key = read_master_key(&*secret_store)?
        .ok_or_else(|| "No local backup encryption key exists.".to_string())?;
    mark_backup_master_key_present(&database)?;
    let (backup_root, _, _) = backup_context(&app, &database)?;
    let store = FileSystemBackupStore::new(backup_root);
    BackupEngine::new(store)
        .restore_plan(BackupRestoreRequest {
            current_schema_version: database.schema_version()?,
            master_key: &master_key,
            snapshot_id: &snapshot_id,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn backup_local_restore_execute(
    app: AppHandle,
    database: State<'_, Database>,
    secret_store: State<'_, KeychainSecretStore>,
    task_state: State<'_, BackupTaskState>,
    snapshot_id: String,
) -> Result<BackupRestoreExecuteResult, String> {
    let _operation = acquire_operation(&task_state)?;

    set_task_status(
        &task_state,
        BackupTaskStatus {
            state: "restoring".to_string(),
            snapshot_id: Some(snapshot_id.clone()),
            message: Some("Staging restore".to_string()),
            started_at: Some(current_timestamp_millis_string()),
            ..BackupTaskStatus::default()
        },
    )?;

    let status_snapshot_id = snapshot_id.clone();
    let result: Result<BackupRestoreExecuteResult, String> = (|| {
        let master_key = read_master_key(&*secret_store)?
            .ok_or_else(|| "No local backup encryption key exists.".to_string())?;
        mark_backup_master_key_present(&database)?;
        let (backup_root, _, _) = backup_context(&app, &database)?;
        let restore_id = format!("rst_{}", current_timestamp_millis_string());
        let staging_path = backup_cache_dir(&app)?.join("restores").join(&restore_id);
        let store = FileSystemBackupStore::new(backup_root);
        let engine = BackupEngine::new(store);
        engine
            .restore_to_staging(
                BackupRestoreRequest {
                    current_schema_version: database.schema_version()?,
                    master_key: &master_key,
                    snapshot_id: &snapshot_id,
                },
                &staging_path,
            )
            .map_err(|error| error.to_string())?;

        let journal = PendingRestoreJournal {
            restore_id,
            snapshot_id: snapshot_id.clone(),
            staging_path: staging_path.clone(),
            created_at: current_timestamp_millis_string(),
        };
        write_pending_restore_journal(&app, &journal)?;
        Ok(BackupRestoreExecuteResult {
            restart_required: true,
            snapshot_id: snapshot_id.clone(),
            staging_path: staging_path.to_string_lossy().to_string(),
        })
    })();

    match &result {
        Ok(output) => set_task_status(
            &task_state,
            BackupTaskStatus {
                state: "restore_ready".to_string(),
                snapshot_id: Some(output.snapshot_id.clone()),
                message: Some("Restore staged; restart required".to_string()),
                finished_at: Some(current_timestamp_millis_string()),
                ..BackupTaskStatus::default()
            },
        )?,
        Err(error) => set_task_status(
            &task_state,
            BackupTaskStatus {
                state: "restore_failed".to_string(),
                snapshot_id: Some(status_snapshot_id),
                error: Some(error.clone()),
                finished_at: Some(current_timestamp_millis_string()),
                ..BackupTaskStatus::default()
            },
        )?,
    }

    result
}

#[tauri::command]
pub fn backup_task_status(
    task_state: State<'_, BackupTaskState>,
) -> Result<BackupTaskStatus, String> {
    task_state
        .status
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "backup task status lock poisoned".to_string())
}

#[tauri::command]
pub fn backup_activity_list(
    database: State<'_, Database>,
    limit: Option<usize>,
) -> Result<Vec<BackupActivityEntry>, String> {
    database.list_backup_activity(limit.unwrap_or(8))
}

pub fn apply_pending_restore(app_cache_dir: &Path, app_data_dir: &Path) -> Result<(), String> {
    let journal_path = pending_restore_journal_path(app_cache_dir);
    if !journal_path.exists() {
        return Ok(());
    }

    let bytes = fs::read(&journal_path).map_err(|error| error.to_string())?;
    let journal = serde_json::from_slice::<PendingRestoreJournal>(&bytes)
        .map_err(|error| error.to_string())?;
    install_staged_restore(app_data_dir, &journal.staging_path)
        .map_err(|error| error.to_string())?;
    fs::remove_file(&journal_path).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn start_backup_scheduler(app: AppHandle) {
    let result = thread::Builder::new()
        .name("bioeng-backup-scheduler".to_string())
        .spawn(move || loop {
            thread::sleep(BACKUP_SCHEDULER_POLL_INTERVAL);
            let _ = run_automatic_backup_if_due(
                &app,
                "Creating scheduled encrypted backup",
                "Scheduled backup complete",
            );
        });

    if let Err(error) = result {
        eprintln!("could not start backup scheduler: {error}");
    }
}

pub fn run_close_backup_if_due(app: &AppHandle) -> Result<(), String> {
    run_automatic_backup_if_due(
        app,
        "Creating close-time encrypted backup",
        "Close-time backup complete",
    )
}

fn run_automatic_backup_if_due(
    app: &AppHandle,
    start_message: &str,
    complete_message: &str,
) -> Result<(), String> {
    if pending_restore_journal_path(&backup_cache_dir(app)?).exists() {
        return Ok(());
    }

    let database = app.state::<Database>();
    let mut settings = database.load_app_settings()?;
    if !automatic_backup_due(&settings) {
        return Ok(());
    }

    settings.backup.last_automatic_backup_attempted_at = Some(current_timestamp_millis_string());
    database.save_app_settings(&settings)?;

    let secret_store = app.state::<KeychainSecretStore>();
    let task_state = app.state::<BackupTaskState>();
    create_local_backup(
        app,
        database.inner(),
        secret_store.inner(),
        task_state.inner(),
        false,
        start_message,
        complete_message,
    )
    .map(|_| ())
}

fn set_task_status(state: &BackupTaskState, status: BackupTaskStatus) -> Result<(), String> {
    *state
        .status
        .lock()
        .map_err(|_| "backup task status lock poisoned".to_string())? = status;
    Ok(())
}

fn create_local_backup(
    app: &AppHandle,
    database: &Database,
    secret_store: &impl SecretStore,
    task_state: &BackupTaskState,
    manual: bool,
    start_message: &str,
    complete_message: &str,
) -> Result<bioeng_backup::BackupSnapshotSummary, String> {
    let _operation = acquire_operation(task_state)?;
    let started_at = current_timestamp_millis_string();
    set_task_status(
        task_state,
        BackupTaskStatus {
            state: "backing_up".to_string(),
            message: Some(start_message.to_string()),
            started_at: Some(started_at.clone()),
            ..BackupTaskStatus::default()
        },
    )?;

    let work_dir = backup_work_dir(app)?;
    let result: Result<bioeng_backup::BackupSnapshotSummary, String> = (|| {
        let master_key = load_or_create_master_key(secret_store)?;
        let (backup_root, device_id, device_name) = backup_context(app, database)?;
        fs::create_dir_all(&work_dir).map_err(|error| error.to_string())?;
        let snapshot_database_path = work_dir.join("bioeng.snapshot.sqlite3");
        database.create_backup_snapshot(&snapshot_database_path)?;

        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let store = FileSystemBackupStore::new(backup_root);
        let engine = BackupEngine::new(store);
        let summary = engine
            .create_snapshot(BackupCreateRequest {
                app_data_dir: &app_data_dir,
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                database_snapshot_path: &snapshot_database_path,
                device_id,
                device_name,
                manual,
                master_key: &master_key,
                schema_version: database.schema_version()?,
            })
            .map_err(|error| error.to_string())?;

        update_last_backup(database, &summary)?;
        record_retention_activity(
            database,
            engine.apply_retention(&master_key, BackupRetentionPolicy::default()),
        )?;
        Ok(summary)
    })();

    let _ = fs::remove_dir_all(&work_dir);
    let finished_at = current_timestamp_millis_string();

    match &result {
        Ok(summary) => {
            let _ = database.record_backup_activity(BackupActivityInput {
                provider: "local".to_string(),
                operation: "backup".to_string(),
                status: "complete".to_string(),
                snapshot_id: Some(summary.id.clone()),
                started_at: Some(started_at),
                finished_at: Some(finished_at.clone()),
                bytes_total: summary.total_bytes,
                bytes_completed: summary.total_bytes,
                message: complete_message.to_string(),
                ..BackupActivityInput::default()
            });
            set_task_status(
                task_state,
                BackupTaskStatus {
                    state: "complete".to_string(),
                    snapshot_id: Some(summary.id.clone()),
                    message: Some(complete_message.to_string()),
                    finished_at: Some(finished_at),
                    bytes_total: Some(summary.total_bytes),
                    bytes_completed: Some(summary.total_bytes),
                    ..BackupTaskStatus::default()
                },
            )?;
        }
        Err(error) => {
            let _ = database.record_backup_activity(BackupActivityInput {
                provider: "local".to_string(),
                operation: "backup".to_string(),
                status: "failed".to_string(),
                started_at: Some(started_at),
                finished_at: Some(finished_at.clone()),
                error_code: Some("backup_error".to_string()),
                error_message: Some(error.clone()),
                message: "Backup failed".to_string(),
                ..BackupActivityInput::default()
            });
            set_task_status(
                task_state,
                BackupTaskStatus {
                    state: "failed".to_string(),
                    error: Some(error.clone()),
                    finished_at: Some(finished_at),
                    ..BackupTaskStatus::default()
                },
            )?;
        }
    }

    result
}

fn record_retention_activity(
    database: &Database,
    result: Result<BackupRetentionPlan, bioeng_backup::BackupError>,
) -> Result<(), String> {
    let finished_at = current_timestamp_millis_string();
    match result {
        Ok(plan) => {
            if plan.deleted_snapshots.is_empty() && plan.deleted_object_keys.is_empty() {
                return Ok(());
            }

            database.record_backup_activity(BackupActivityInput {
                provider: "local".to_string(),
                operation: "retention".to_string(),
                status: "complete".to_string(),
                started_at: Some(finished_at.clone()),
                finished_at: Some(finished_at),
                bytes_total: plan.freed_bytes,
                bytes_completed: plan.freed_bytes,
                message: format!(
                    "Deleted {} old snapshots and {} unreferenced objects.",
                    plan.deleted_snapshots.len(),
                    plan.deleted_object_keys.len()
                ),
                ..BackupActivityInput::default()
            })?;
        }
        Err(error) => {
            database.record_backup_activity(BackupActivityInput {
                provider: "local".to_string(),
                operation: "retention".to_string(),
                status: "failed".to_string(),
                started_at: Some(finished_at.clone()),
                finished_at: Some(finished_at),
                error_code: Some("retention_error".to_string()),
                error_message: Some(error.to_string()),
                message: "Retention failed".to_string(),
                ..BackupActivityInput::default()
            })?;
        }
    }

    Ok(())
}

fn acquire_operation(state: &BackupTaskState) -> Result<MutexGuard<'_, ()>, String> {
    state.operation.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => "A backup or restore is already in progress.".to_string(),
        TryLockError::Poisoned(_) => "backup operation lock poisoned".to_string(),
    })
}

fn automatic_backup_due(settings: &AppSettings) -> bool {
    if !settings.backup.automatic_backups_enabled || settings.backup.local_folder.is_none() {
        return false;
    }

    let Some(now_millis) = now_millis() else {
        return false;
    };

    let interval_millis = u128::from(settings.backup.automatic_interval_minutes) * 60 * 1000;
    let last_backup_millis = settings
        .backup
        .last_backup
        .as_ref()
        .and_then(|backup| timestamp_millis(&backup.created_at));
    let last_attempt_millis = settings
        .backup
        .last_automatic_backup_attempted_at
        .as_deref()
        .and_then(timestamp_millis);
    let last_millis = [last_backup_millis, last_attempt_millis]
        .into_iter()
        .flatten()
        .max();

    match last_millis {
        Some(last_millis) => now_millis.saturating_sub(last_millis) >= interval_millis,
        None => true,
    }
}

fn now_millis() -> Option<u128> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn timestamp_millis(value: &str) -> Option<u128> {
    if let Ok(millis) = value.parse::<u128>() {
        return Some(millis);
    }

    OffsetDateTime::parse(value, &Rfc3339)
        .ok()
        .and_then(|datetime| u128::try_from(datetime.unix_timestamp_nanos() / 1_000_000).ok())
}

fn backup_context(
    app: &AppHandle,
    database: &Database,
) -> Result<(PathBuf, String, String), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let mut settings = database.load_app_settings()?;
    let local_folder = settings
        .backup
        .local_folder
        .clone()
        .ok_or_else(|| "Choose a local backup folder before backing up.".to_string())?;
    let backup_root = PathBuf::from(local_folder);
    fs::create_dir_all(&backup_root).map_err(|error| error.to_string())?;
    reject_destination_inside_app_data(&backup_root, &app_data_dir)?;

    let mut changed = false;
    if settings.backup.device_id.trim().is_empty() {
        settings.backup.device_id = format!("dev_{}", current_timestamp_millis_string());
        changed = true;
    }
    if settings.backup.device_name.trim().is_empty() {
        settings.backup.device_name = default_device_name();
        changed = true;
    }
    if changed {
        database.save_app_settings(&settings)?;
    }

    Ok((
        backup_root.join("bioeng-backups"),
        settings.backup.device_id,
        settings.backup.device_name,
    ))
}

fn backup_work_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(backup_cache_dir(app)?
        .join("work")
        .join(current_timestamp_millis_string()))
}

fn backup_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    Ok(app_cache_dir.join("backup"))
}

fn write_pending_restore_journal(
    app: &AppHandle,
    journal: &PendingRestoreJournal,
) -> Result<(), String> {
    let backup_cache_dir = backup_cache_dir(app)?;
    fs::create_dir_all(&backup_cache_dir).map_err(|error| error.to_string())?;
    let path = pending_restore_journal_path(&backup_cache_dir);
    let bytes = serde_json::to_vec_pretty(journal).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn pending_restore_journal_path(app_cache_backup_dir: &Path) -> PathBuf {
    app_cache_backup_dir.join("restore-pending.json")
}

fn read_master_key(secret_store: &impl SecretStore) -> Result<Option<BackupMasterKey>, String> {
    let handle = SecretHandle::BackupMasterKey;
    let Some(secret) = secret_store
        .get_secret(handle.namespace(), handle.key())
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };

    master_key_from_recovery_key(secret.expose_secret())
        .map(Some)
        .map_err(|error| error.to_string())
}

fn load_or_create_master_key(secret_store: &impl SecretStore) -> Result<BackupMasterKey, String> {
    if let Some(master_key) = read_master_key(secret_store)? {
        return Ok(master_key);
    }

    let master_key = generate_master_key();
    let recovery_key =
        recovery_key_for_master_key(&master_key).map_err(|error| error.to_string())?;
    let handle = SecretHandle::BackupMasterKey;
    secret_store
        .set_secret(
            handle.namespace(),
            handle.key(),
            SecretString::new(recovery_key),
        )
        .map_err(|error| error.to_string())?;
    Ok(master_key)
}

fn backup_key_status_from_database(database: &Database) -> Result<BackupKeyStatus, String> {
    let settings = database.load_app_settings()?;
    Ok(backup_key_status_from_settings(settings))
}

fn backup_key_status_from_settings(settings: AppSettings) -> BackupKeyStatus {
    let master_key_present = settings.backup.master_key_created_at.is_some()
        || settings.backup.recovery_key_exported_at.is_some()
        || settings.backup.last_backup.is_some();

    BackupKeyStatus {
        master_key_present,
        recovery_key_exported: settings.backup.recovery_key_exported_at.is_some(),
        recovery_key_exported_at: settings.backup.recovery_key_exported_at,
    }
}

fn mark_backup_master_key_present(database: &Database) -> Result<(), String> {
    let mut settings = database.load_app_settings()?;
    if settings.backup.master_key_created_at.is_some() {
        return Ok(());
    }

    settings.backup.master_key_created_at = Some(current_timestamp_millis_string());
    database.save_app_settings(&settings)
}

fn update_last_backup(
    database: &Database,
    summary: &bioeng_backup::BackupSnapshotSummary,
) -> Result<(), String> {
    let mut settings = database.load_app_settings()?;
    if settings.backup.master_key_created_at.is_none() {
        settings.backup.master_key_created_at = Some(current_timestamp_millis_string());
    }
    settings.backup.last_backup = Some(BackupSnapshotSettings {
        id: summary.id.clone(),
        created_at: summary.created_at.clone(),
        total_bytes: summary.total_bytes,
        schema_version: summary.schema_version,
        attachment_count: summary.attachment_count,
    });
    database.save_app_settings(&settings)
}

fn recovery_key_file_contents(recovery_key: &str) -> String {
    format!(
        "Bio Eng Studio Backup Recovery Key\n\n{recovery_key}\n\nStore this somewhere safe. Anyone with this key and your encrypted backup files can restore the backup.\n"
    )
}

fn reject_destination_inside_app_data(
    backup_root: &Path,
    app_data_dir: &Path,
) -> Result<(), String> {
    let backup_root = backup_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let app_data_dir = app_data_dir
        .canonicalize()
        .or_else(|_| {
            fs::create_dir_all(app_data_dir)?;
            app_data_dir.canonicalize()
        })
        .map_err(|error| error.to_string())?;

    if backup_root.starts_with(&app_data_dir) {
        return Err(
            "Choose a backup folder outside the Bio Eng Studio app data directory.".to_string(),
        );
    }

    Ok(())
}

fn default_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "This device".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scheduled_settings() -> AppSettings {
        let mut settings = AppSettings::default();
        settings.backup.local_folder = Some("/tmp/bioeng-backups".to_string());
        settings.backup.automatic_interval_minutes = 60;
        settings
    }

    fn millis_ago(minutes: u64) -> String {
        let elapsed_millis = u128::from(minutes) * 60 * 1000;
        now_millis()
            .unwrap()
            .saturating_sub(elapsed_millis)
            .to_string()
    }

    #[test]
    fn automatic_backup_waits_for_destination() {
        let mut settings = scheduled_settings();
        settings.backup.local_folder = None;

        assert!(!automatic_backup_due(&settings));
    }

    #[test]
    fn automatic_backup_runs_when_no_history_exists() {
        let settings = scheduled_settings();

        assert!(automatic_backup_due(&settings));
    }

    #[test]
    fn automatic_backup_uses_last_backup_cadence() {
        let mut settings = scheduled_settings();
        settings.backup.last_backup = Some(BackupSnapshotSettings {
            id: "snapshot_recent".to_string(),
            created_at: millis_ago(30),
            total_bytes: 0,
            schema_version: 1,
            attachment_count: 0,
        });

        assert!(!automatic_backup_due(&settings));

        settings.backup.last_backup = Some(BackupSnapshotSettings {
            id: "snapshot_old".to_string(),
            created_at: millis_ago(90),
            total_bytes: 0,
            schema_version: 1,
            attachment_count: 0,
        });

        assert!(automatic_backup_due(&settings));
    }

    #[test]
    fn automatic_backup_recent_attempt_suppresses_retry() {
        let mut settings = scheduled_settings();
        settings.backup.last_backup = Some(BackupSnapshotSettings {
            id: "snapshot_old".to_string(),
            created_at: millis_ago(90),
            total_bytes: 0,
            schema_version: 1,
            attachment_count: 0,
        });
        settings.backup.last_automatic_backup_attempted_at = Some(millis_ago(5));

        assert!(!automatic_backup_due(&settings));
    }
}
