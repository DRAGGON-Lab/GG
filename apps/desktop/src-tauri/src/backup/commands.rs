use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, TryLockError},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use gg_backup::{
    create_sqlite_snapshot, generate_master_key, install_staged_restore,
    master_key_from_recovery_key, recovery_key_for_master_key, stores::FileSystemBackupStore,
    BackupCreateRequest, BackupEngine, BackupFileSource, BackupMasterKey, BackupRestorePlan,
    BackupRestoreRequest, BackupRetentionPlan, BackupRetentionPolicy,
};
use gg_data::backup::{BackupActivityEntry, BackupActivityInput};
use gg_data::{
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
) -> Result<gg_backup::BackupSnapshotSummary, String> {
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
) -> Result<Vec<gg_backup::BackupSnapshotSummary>, String> {
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
    let master_key = read_master_key(&*secret_store)?
        .ok_or_else(|| "No local backup encryption key exists.".to_string())?;
    mark_backup_master_key_present(&database)?;
    let (backup_root, _, _) = backup_context(&app, &database)?;
    execute_restore(
        &app,
        database.inner(),
        task_state.inner(),
        backup_root,
        master_key,
        snapshot_id,
        false,
    )
}

#[tauri::command]
pub fn backup_portable_list(
    source_path: String,
    recovery_key_path: String,
) -> Result<Vec<gg_backup::BackupSnapshotSummary>, String> {
    let (backup_root, master_key) = portable_backup_context(&source_path, &recovery_key_path)?;
    let snapshots = BackupEngine::new(FileSystemBackupStore::new(&backup_root))
        .list_snapshots(&master_key)
        .map_err(|error| error.to_string())?;

    if snapshots.is_empty() {
        if backup_store_has_manifests(&backup_root)? {
            return Err(
                "The selected recovery key cannot decrypt any snapshots in this backup."
                    .to_string(),
            );
        }
        return Err("The selected directory contains no GG Circuit snapshots.".to_string());
    }

    Ok(snapshots)
}

#[tauri::command]
pub fn backup_portable_restore_plan(
    database: State<'_, Database>,
    source_path: String,
    recovery_key_path: String,
    snapshot_id: String,
) -> Result<BackupRestorePlan, String> {
    let (backup_root, master_key) = portable_backup_context(&source_path, &recovery_key_path)?;
    BackupEngine::new(FileSystemBackupStore::new(backup_root))
        .restore_plan(BackupRestoreRequest {
            current_schema_version: database.schema_version()?,
            master_key: &master_key,
            snapshot_id: &snapshot_id,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn backup_portable_restore_execute(
    app: AppHandle,
    database: State<'_, Database>,
    task_state: State<'_, BackupTaskState>,
    source_path: String,
    recovery_key_path: String,
    snapshot_id: String,
) -> Result<BackupRestoreExecuteResult, String> {
    let (backup_root, master_key) = portable_backup_context(&source_path, &recovery_key_path)?;
    execute_restore(
        &app,
        database.inner(),
        task_state.inner(),
        backup_root,
        master_key,
        snapshot_id,
        true,
    )
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

fn execute_restore(
    app: &AppHandle,
    database: &Database,
    task_state: &BackupTaskState,
    backup_root: PathBuf,
    master_key: BackupMasterKey,
    snapshot_id: String,
    preserve_local_settings: bool,
) -> Result<BackupRestoreExecuteResult, String> {
    let _operation = acquire_operation(task_state)?;

    set_task_status(
        task_state,
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
        let restore_id = format!("rst_{}", current_timestamp_millis_string());
        let staging_path = backup_cache_dir(app)?.join("restores").join(&restore_id);
        BackupEngine::new(FileSystemBackupStore::new(backup_root))
            .restore_to_staging(
                BackupRestoreRequest {
                    current_schema_version: database.schema_version()?,
                    master_key: &master_key,
                    snapshot_id: &snapshot_id,
                },
                &staging_path,
            )
            .map_err(|error| error.to_string())?;

        if preserve_local_settings {
            preserve_install_locality(database, &staging_path)?;
        }

        let journal = PendingRestoreJournal {
            restore_id,
            snapshot_id: snapshot_id.clone(),
            staging_path: staging_path.clone(),
            created_at: current_timestamp_millis_string(),
        };
        write_pending_restore_journal(app, &journal)?;
        Ok(BackupRestoreExecuteResult {
            restart_required: true,
            snapshot_id: snapshot_id.clone(),
            staging_path: staging_path.to_string_lossy().to_string(),
        })
    })();

    match &result {
        Ok(output) => set_task_status(
            task_state,
            BackupTaskStatus {
                state: "restore_ready".to_string(),
                snapshot_id: Some(output.snapshot_id.clone()),
                message: Some("Restore staged; restart required".to_string()),
                finished_at: Some(current_timestamp_millis_string()),
                ..BackupTaskStatus::default()
            },
        )?,
        Err(error) => set_task_status(
            task_state,
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

fn preserve_install_locality(database: &Database, staging_path: &Path) -> Result<(), String> {
    let local_settings = database.load_app_settings()?;
    let staged_database = Database::open(staging_path.join("gg.sqlite3"))?;
    let mut restored_settings = staged_database.load_app_settings()?;
    restored_settings.backup = local_settings.backup;
    restored_settings.platform = local_settings.platform;
    restored_settings.workspace = local_settings.workspace;
    staged_database.save_app_settings(&restored_settings)
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
        .name("gg-backup-scheduler".to_string())
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
) -> Result<gg_backup::BackupSnapshotSummary, String> {
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
    let result: Result<gg_backup::BackupSnapshotSummary, String> = (|| {
        let master_key = load_or_create_master_key(secret_store)?;
        let (backup_root, device_id, device_name) = backup_context(app, database)?;
        fs::create_dir_all(&work_dir).map_err(|error| error.to_string())?;
        let snapshot_database_path = work_dir.join("gg.snapshot.sqlite3");
        database.create_backup_snapshot(&snapshot_database_path)?;

        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let sbol_snapshot_path = work_dir.join("sbol.snapshot.sqlite3");
        let flapjack_snapshot_path = work_dir.join("flapjack.snapshot.sqlite3");
        create_sqlite_snapshot(&app_data_dir.join("sbol.sqlite3"), &sbol_snapshot_path)
            .map_err(|error| error.to_string())?;
        create_sqlite_snapshot(
            &app_data_dir.join("flapjack.sqlite3"),
            &flapjack_snapshot_path,
        )
        .map_err(|error| error.to_string())?;
        let store = FileSystemBackupStore::new(backup_root);
        let engine = BackupEngine::new(store);
        let summary = engine
            .create_snapshot(BackupCreateRequest {
                additional_files: vec![
                    BackupFileSource {
                        logical_path: "sbol.sqlite3".to_string(),
                        source_path: sbol_snapshot_path,
                    },
                    BackupFileSource {
                        logical_path: "flapjack.sqlite3".to_string(),
                        source_path: flapjack_snapshot_path,
                    },
                ],
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
    result: Result<BackupRetentionPlan, gg_backup::BackupError>,
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
        backup_root.join("gg-backups"),
        settings.backup.device_id,
        settings.backup.device_name,
    ))
}

fn portable_backup_context(
    source_path: &str,
    recovery_key_path: &str,
) -> Result<(PathBuf, BackupMasterKey), String> {
    let backup_root = resolve_portable_backup_root(Path::new(source_path))?;
    let recovery_key_path = Path::new(recovery_key_path);
    if !recovery_key_path.is_file() {
        return Err("Choose the recovery-key text file that belongs to this backup.".to_string());
    }

    let recovery_key = fs::read_to_string(recovery_key_path).map_err(|error| error.to_string())?;
    let master_key =
        master_key_from_recovery_key(&recovery_key).map_err(|error| error.to_string())?;
    Ok((backup_root, master_key))
}

fn resolve_portable_backup_root(selected_path: &Path) -> Result<PathBuf, String> {
    if !selected_path.is_dir() {
        return Err("Choose a GG Circuit backup directory.".to_string());
    }

    let nested = selected_path.join("gg-backups");
    let backup_root = if looks_like_backup_store(&nested) {
        nested
    } else if looks_like_backup_store(selected_path) {
        selected_path.to_path_buf()
    } else {
        return Err(
            "The selected directory is not a GG Circuit backup and does not contain gg-backups."
                .to_string(),
        );
    };

    backup_root
        .canonicalize()
        .map_err(|error| error.to_string())
}

fn looks_like_backup_store(path: &Path) -> bool {
    path.join("snapshots").is_dir() || path.join("index.json").is_file()
}

fn backup_store_has_manifests(backup_root: &Path) -> Result<bool, String> {
    let snapshots_path = backup_root.join("snapshots");
    if !snapshots_path.is_dir() {
        return Ok(false);
    }

    for entry in fs::read_dir(snapshots_path).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.join("manifest.json.encrypted").is_file() {
            return Ok(true);
        }
    }

    Ok(false)
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
    summary: &gg_backup::BackupSnapshotSummary,
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
        "GG Circuit Backup Recovery Key\n\n{recovery_key}\n\nStore this somewhere safe. Anyone with this key and your encrypted backup files can restore the backup.\n"
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
            "Choose a backup folder outside the GG Circuit app data directory.".to_string(),
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

    fn portable_fixture() -> (tempfile::TempDir, String, String) {
        let directory = tempfile::tempdir().unwrap();
        let backup_root = directory.path().join("gg-backups");
        let app_data = tempfile::tempdir().unwrap();
        let database = Database::open(app_data.path().join("gg.sqlite3")).unwrap();
        let snapshot_database = app_data.path().join("gg.snapshot.sqlite3");
        let mut donor_settings = database.load_app_settings().unwrap();
        donor_settings.backup.local_folder = Some("/donor/backups".to_string());
        donor_settings.platform.account_id = Some("donor-account".to_string());
        donor_settings.text_editor.font_size = 19;
        database.save_app_settings(&donor_settings).unwrap();
        database.create_backup_snapshot(&snapshot_database).unwrap();

        let sbol_database = Database::open(app_data.path().join("sbol.sqlite3")).unwrap();
        let mut sbol_marker = sbol_database.load_app_settings().unwrap();
        sbol_marker.text_editor.font_size = 17;
        sbol_database.save_app_settings(&sbol_marker).unwrap();
        let sbol_snapshot = app_data.path().join("sbol.snapshot.sqlite3");
        sbol_database
            .create_backup_snapshot(&sbol_snapshot)
            .unwrap();

        let flapjack_database = Database::open(app_data.path().join("flapjack.sqlite3")).unwrap();
        let mut flapjack_marker = flapjack_database.load_app_settings().unwrap();
        flapjack_marker.text_editor.font_size = 18;
        flapjack_database
            .save_app_settings(&flapjack_marker)
            .unwrap();
        let flapjack_snapshot = app_data.path().join("flapjack.snapshot.sqlite3");
        flapjack_database
            .create_backup_snapshot(&flapjack_snapshot)
            .unwrap();

        let skill_directory = app_data.path().join("skills").join("portable-test");
        fs::create_dir_all(&skill_directory).unwrap();
        fs::write(skill_directory.join("SKILL.md"), "portable skill").unwrap();

        let master_key = generate_master_key();
        BackupEngine::new(FileSystemBackupStore::new(&backup_root))
            .create_snapshot(BackupCreateRequest {
                additional_files: vec![
                    BackupFileSource {
                        logical_path: "sbol.sqlite3".to_string(),
                        source_path: sbol_snapshot,
                    },
                    BackupFileSource {
                        logical_path: "flapjack.sqlite3".to_string(),
                        source_path: flapjack_snapshot,
                    },
                ],
                app_data_dir: app_data.path(),
                app_version: "0.1.0".to_string(),
                database_snapshot_path: &snapshot_database,
                device_id: "donor-device".to_string(),
                device_name: "Donor Device".to_string(),
                manual: true,
                master_key: &master_key,
                schema_version: database.schema_version().unwrap(),
            })
            .unwrap();

        let recovery_key_path = directory.path().join("gg-recovery-key.txt");
        let recovery_key = recovery_key_for_master_key(&master_key).unwrap();
        fs::write(
            &recovery_key_path,
            recovery_key_file_contents(&recovery_key),
        )
        .unwrap();

        (
            directory,
            backup_root.to_string_lossy().to_string(),
            recovery_key_path.to_string_lossy().to_string(),
        )
    }

    fn scheduled_settings() -> AppSettings {
        let mut settings = AppSettings::default();
        settings.backup.local_folder = Some("/tmp/gg-backups".to_string());
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
    fn portable_restore_accepts_exported_or_store_directory() {
        let (directory, backup_root, recovery_key_path) = portable_fixture();

        let exported = backup_portable_list(
            directory.path().to_string_lossy().to_string(),
            recovery_key_path.clone(),
        )
        .unwrap();
        let store = backup_portable_list(backup_root, recovery_key_path).unwrap();

        assert_eq!(exported.len(), 1);
        assert_eq!(store.len(), 1);
        assert_eq!(exported[0].id, store[0].id);
    }

    #[test]
    fn portable_restore_rejects_another_recovery_key() {
        let (directory, _, recovery_key_path) = portable_fixture();
        let other_key = recovery_key_for_master_key(&generate_master_key()).unwrap();
        fs::write(&recovery_key_path, recovery_key_file_contents(&other_key)).unwrap();

        let error = backup_portable_list(
            directory.path().to_string_lossy().to_string(),
            recovery_key_path,
        )
        .unwrap_err();

        assert!(error.contains("cannot decrypt"));
    }

    #[test]
    fn portable_restore_preserves_recipient_locality() {
        let current_directory = tempfile::tempdir().unwrap();
        let current_database = Database::open(current_directory.path().join("gg.sqlite3")).unwrap();
        let mut local_settings = current_database.load_app_settings().unwrap();
        local_settings.backup.local_folder = Some("/recipient/backups".to_string());
        local_settings.platform.account_id = Some("recipient-account".to_string());
        local_settings.workspace = serde_json::from_value(serde_json::json!({
            "activeWorkspaceId": "recipient-workspace",
            "workspaces": [{
                "id": "recipient-workspace",
                "name": "Recipient",
                "root": "/recipient/project",
                "kind": "external",
                "historyEnabled": false
            }]
        }))
        .unwrap();
        current_database.save_app_settings(&local_settings).unwrap();

        let staging = tempfile::tempdir().unwrap();
        let staged_database = Database::open(staging.path().join("gg.sqlite3")).unwrap();
        let mut donor_settings = staged_database.load_app_settings().unwrap();
        donor_settings.backup.local_folder = Some("/donor/backups".to_string());
        donor_settings.platform.account_id = Some("donor-account".to_string());
        donor_settings.workspace = serde_json::from_value(serde_json::json!({
            "activeWorkspaceId": "donor-workspace",
            "workspaces": [{
                "id": "donor-workspace",
                "name": "Donor",
                "root": "/donor/project",
                "kind": "external",
                "historyEnabled": false
            }]
        }))
        .unwrap();
        donor_settings.text_editor.font_size = 19;
        staged_database.save_app_settings(&donor_settings).unwrap();
        drop(staged_database);

        preserve_install_locality(&current_database, staging.path()).unwrap();

        let restored = Database::open(staging.path().join("gg.sqlite3"))
            .unwrap()
            .load_app_settings()
            .unwrap();
        assert_eq!(
            restored.backup.local_folder.as_deref(),
            Some("/recipient/backups")
        );
        assert_eq!(
            restored.platform.account_id.as_deref(),
            Some("recipient-account")
        );
        assert_eq!(
            serde_json::to_value(&restored.workspace).unwrap(),
            serde_json::to_value(&local_settings.workspace).unwrap()
        );
        assert_eq!(restored.text_editor.font_size, 19);
    }

    #[test]
    fn portable_restore_installs_complete_donor_state() {
        let (directory, _, recovery_key_path) = portable_fixture();
        let (backup_root, master_key) =
            portable_backup_context(&directory.path().to_string_lossy(), &recovery_key_path)
                .unwrap();
        let engine = BackupEngine::new(FileSystemBackupStore::new(backup_root));
        let snapshot = engine.list_snapshots(&master_key).unwrap().remove(0);

        let recipient_parent = tempfile::tempdir().unwrap();
        let recipient_app_data = recipient_parent.path().join("app-data");
        let recipient_database = Database::open(recipient_app_data.join("gg.sqlite3")).unwrap();
        let mut recipient_settings = recipient_database.load_app_settings().unwrap();
        recipient_settings.backup.local_folder = Some("/recipient/backups".to_string());
        recipient_settings.platform.account_id = Some("recipient-account".to_string());
        recipient_database
            .save_app_settings(&recipient_settings)
            .unwrap();
        fs::write(recipient_app_data.join("recipient-marker.txt"), "preserved").unwrap();

        let staging_path = recipient_parent.path().join("staging");
        let plan = engine
            .restore_to_staging(
                BackupRestoreRequest {
                    current_schema_version: recipient_database.schema_version().unwrap(),
                    master_key: &master_key,
                    snapshot_id: &snapshot.id,
                },
                &staging_path,
            )
            .unwrap();
        assert!(plan.warnings.is_empty());
        preserve_install_locality(&recipient_database, &staging_path).unwrap();
        drop(recipient_database);

        let install = install_staged_restore(&recipient_app_data, &staging_path).unwrap();
        let previous_app_data = install.previous_app_data_dir.unwrap();
        assert_eq!(
            fs::read_to_string(previous_app_data.join("recipient-marker.txt")).unwrap(),
            "preserved"
        );

        let restored_settings = Database::open(recipient_app_data.join("gg.sqlite3"))
            .unwrap()
            .load_app_settings()
            .unwrap();
        assert_eq!(restored_settings.text_editor.font_size, 19);
        assert_eq!(
            restored_settings.backup.local_folder.as_deref(),
            Some("/recipient/backups")
        );
        assert_eq!(
            restored_settings.platform.account_id.as_deref(),
            Some("recipient-account")
        );
        assert_eq!(
            Database::open(recipient_app_data.join("sbol.sqlite3"))
                .unwrap()
                .load_app_settings()
                .unwrap()
                .text_editor
                .font_size,
            17
        );
        assert_eq!(
            Database::open(recipient_app_data.join("flapjack.sqlite3"))
                .unwrap()
                .load_app_settings()
                .unwrap()
                .text_editor
                .font_size,
            18
        );
        assert_eq!(
            fs::read_to_string(
                recipient_app_data
                    .join("skills")
                    .join("portable-test")
                    .join("SKILL.md")
            )
            .unwrap(),
            "portable skill"
        );
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
