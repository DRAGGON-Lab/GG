use std::{fs, io::Read, path::Path};

use sha2::Digest;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use crate::{
    attachments::{normalize_relative_path, referenced_attachments},
    database::sqlite_integrity_check,
    encryption::{
        decrypt_bytes, encrypt_bytes, encrypted_object_aad, key_id, object_key_for_plaintext_hash,
        sha256_bytes,
    },
    errors::{BackupError, BackupResult},
    manifest::{
        BackupAppMetadata, BackupDeviceMetadata, BackupEncryptionMetadata, BackupFileEntry,
        BackupIndex, BackupObjectEntry, BackupSnapshotSummary, SnapshotManifest, INDEX_FORMAT,
        SNAPSHOT_FORMAT,
    },
    restore::write_staged_file,
    retention::{build_retention_plan, BackupRetentionPlan, BackupRetentionPolicy},
    BackupStore,
};

pub struct BackupEngine<S> {
    store: S,
}

impl<S> BackupEngine<S>
where
    S: BackupStore,
{
    pub fn new(store: S) -> Self {
        Self { store }
    }

    pub fn create_snapshot(
        &self,
        request: BackupCreateRequest<'_>,
    ) -> BackupResult<BackupSnapshotSummary> {
        let created_at = now_rfc3339()?;
        let snapshot_id = snapshot_id(&created_at);
        let database_entry = self.store_artifact(
            request.master_key,
            request.database_snapshot_path,
            "bioeng.sqlite3",
        )?;

        let attachment_sources = referenced_attachments(request.app_data_dir)?;
        let mut attachments = Vec::with_capacity(attachment_sources.len());
        for attachment in attachment_sources {
            let attachment_path = request.app_data_dir.join(&attachment.relative_path);
            if !attachment_path.is_file() {
                return Err(BackupError::MissingAttachment(attachment.relative_path));
            }

            let entry = self.store_artifact(
                request.master_key,
                &attachment_path,
                &attachment.relative_path,
            )?;
            attachments.push(entry);
        }

        let mut objects = Vec::with_capacity(attachments.len() + 1);
        objects.push(object_entry_from_file_entry(&database_entry));
        objects.extend(attachments.iter().map(object_entry_from_file_entry));

        let manifest = SnapshotManifest {
            format: SNAPSHOT_FORMAT.to_string(),
            snapshot_id: snapshot_id.clone(),
            created_at,
            manual: request.manual,
            app: BackupAppMetadata {
                name: "Bio Eng Studio".to_string(),
                version: request.app_version,
                schema_version: request.schema_version,
            },
            device: BackupDeviceMetadata {
                id: request.device_id,
                name: request.device_name,
            },
            encryption: BackupEncryptionMetadata {
                mode: "xchacha20poly1305-v1".to_string(),
                key_id: key_id(request.master_key)?,
            },
            database: database_entry,
            attachments,
            objects,
        };
        let summary = BackupSnapshotSummary::from_manifest(&manifest);
        self.write_manifest_last(request.master_key, &manifest)?;
        let _ = self.update_index(&summary);
        Ok(summary)
    }

    pub fn list_snapshots(&self, master_key: &[u8]) -> BackupResult<Vec<BackupSnapshotSummary>> {
        let mut snapshots = self
            .list_valid_manifests(master_key)?
            .iter()
            .map(BackupSnapshotSummary::from_manifest)
            .collect::<Vec<_>>();
        snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(snapshots)
    }

    pub fn retention_plan(
        &self,
        master_key: &[u8],
        policy: BackupRetentionPolicy,
    ) -> BackupResult<BackupRetentionPlan> {
        let manifests = self.list_valid_manifests(master_key)?;
        let objects = self.store.list_objects("")?;
        Ok(build_retention_plan(manifests, objects, policy))
    }

    pub fn apply_retention(
        &self,
        master_key: &[u8],
        policy: BackupRetentionPolicy,
    ) -> BackupResult<BackupRetentionPlan> {
        let plan = self.retention_plan(master_key, policy)?;

        for snapshot in &plan.deleted_snapshots {
            self.store.delete_object(&manifest_key(&snapshot.id))?;
        }
        for object_key in &plan.deleted_object_keys {
            self.store.delete_object(object_key)?;
        }

        self.write_index(plan.retained_snapshots.clone())?;
        Ok(plan)
    }

    pub fn restore_plan(
        &self,
        request: BackupRestoreRequest<'_>,
    ) -> BackupResult<BackupRestorePlan> {
        let manifest = self.load_manifest(request.snapshot_id, request.master_key)?;
        let snapshot = BackupSnapshotSummary::from_manifest(&manifest);
        let required_bytes = manifest
            .objects
            .iter()
            .map(|object| object.size_bytes)
            .sum();
        let object_count = manifest.objects.len();
        let mut warnings = Vec::new();

        if manifest.app.schema_version > request.current_schema_version {
            return Err(BackupError::IncompatibleSchema {
                app_schema_version: request.current_schema_version,
                snapshot_schema_version: manifest.app.schema_version,
            });
        }

        if manifest.app.schema_version < request.current_schema_version {
            warnings.push(format!(
                "Backup schema {} is older than current schema {}; it will be opened through normal migrations after restore.",
                manifest.app.schema_version, request.current_schema_version
            ));
        }

        Ok(BackupRestorePlan {
            snapshot,
            required_bytes,
            object_count,
            warnings,
        })
    }

    pub fn restore_to_staging(
        &self,
        request: BackupRestoreRequest<'_>,
        staging_dir: &Path,
    ) -> BackupResult<BackupRestorePlan> {
        let plan = self.restore_plan(BackupRestoreRequest {
            current_schema_version: request.current_schema_version,
            master_key: request.master_key,
            snapshot_id: request.snapshot_id,
        })?;
        let manifest = self.load_manifest(request.snapshot_id, request.master_key)?;

        if staging_dir.exists() {
            return Err(BackupError::restore_install(format!(
                "staging directory already exists: {}",
                staging_dir.display()
            )));
        }
        fs::create_dir_all(staging_dir)?;

        self.restore_entry_to_staging(request.master_key, &manifest.database, staging_dir)?;
        for attachment in &manifest.attachments {
            normalize_relative_path(&attachment.logical_path)?;
            self.restore_entry_to_staging(request.master_key, attachment, staging_dir)?;
        }

        let staged_database = staging_dir.join("bioeng.sqlite3");
        sqlite_integrity_check(&staged_database)?;

        for attachment in &manifest.attachments {
            let staged_attachment = staging_dir.join(&attachment.logical_path);
            if !staged_attachment.is_file() {
                return Err(BackupError::MissingAttachment(
                    attachment.logical_path.clone(),
                ));
            }
            let actual_sha256 = sha256_file(&staged_attachment)?;
            if actual_sha256 != attachment.sha256 {
                return Err(BackupError::VerifyHash {
                    actual: actual_sha256,
                    expected: attachment.sha256.clone(),
                    path: attachment.logical_path.clone(),
                });
            }
        }

        Ok(plan)
    }

    fn store_artifact(
        &self,
        master_key: &[u8],
        path: &Path,
        logical_path: &str,
    ) -> BackupResult<BackupFileEntry> {
        let plaintext = fs::read(path)?;
        let sha256 = sha256_bytes(&plaintext);
        let object_key = object_key_for_plaintext_hash(master_key, &sha256)?;
        let entry = BackupFileEntry {
            logical_path: logical_path.to_string(),
            size_bytes: plaintext.len() as u64,
            sha256,
            object_key,
        };
        let encrypted = encrypt_bytes(master_key, encrypted_object_aad(&entry), &plaintext)?;
        let encrypted_sha256 = sha256_bytes(&encrypted);
        self.store
            .put_object(&entry.object_key, &encrypted, &encrypted_sha256)?;
        Ok(entry)
    }

    fn write_manifest_last(
        &self,
        master_key: &[u8],
        manifest: &SnapshotManifest,
    ) -> BackupResult<()> {
        let plaintext = serde_json::to_vec_pretty(manifest)?;
        let aad = manifest_aad(&manifest.snapshot_id);
        let encrypted = encrypt_bytes(master_key, aad.as_bytes(), &plaintext)?;
        let encrypted_sha256 = sha256_bytes(&encrypted);
        self.store.put_object(
            &manifest_key(&manifest.snapshot_id),
            &encrypted,
            &encrypted_sha256,
        )
    }

    fn load_manifest(
        &self,
        snapshot_id: &str,
        master_key: &[u8],
    ) -> BackupResult<SnapshotManifest> {
        let encrypted = self
            .store
            .get_object(&manifest_key(snapshot_id))
            .map_err(|error| match error {
                BackupError::Io(io_error) if io_error.kind() == std::io::ErrorKind::NotFound => {
                    BackupError::SnapshotNotFound(snapshot_id.to_string())
                }
                other => other,
            })?;
        let aad = manifest_aad(snapshot_id);
        let plaintext = decrypt_bytes(master_key, aad.as_bytes(), &encrypted)?;
        let manifest = serde_json::from_slice::<SnapshotManifest>(&plaintext)?;
        if manifest.snapshot_id != snapshot_id {
            return Err(BackupError::SnapshotNotFound(snapshot_id.to_string()));
        }
        Ok(manifest)
    }

    fn list_valid_manifests(&self, master_key: &[u8]) -> BackupResult<Vec<SnapshotManifest>> {
        let mut manifests = Vec::new();
        for object in self.store.list_objects("snapshots")? {
            if !object.key.ends_with("/manifest.json.encrypted") {
                continue;
            }

            let Some(snapshot_id) = snapshot_id_from_manifest_key(&object.key) else {
                continue;
            };

            if let Ok(manifest) = self.load_manifest(&snapshot_id, master_key) {
                manifests.push(manifest);
            }
        }

        manifests.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(manifests)
    }

    fn restore_entry_to_staging(
        &self,
        master_key: &[u8],
        entry: &BackupFileEntry,
        staging_dir: &Path,
    ) -> BackupResult<()> {
        let encrypted = self.store.get_object(&entry.object_key)?;
        let plaintext = decrypt_bytes(master_key, encrypted_object_aad(entry), &encrypted)?;
        let actual_sha256 = sha256_bytes(&plaintext);
        if actual_sha256 != entry.sha256 {
            return Err(BackupError::VerifyHash {
                actual: actual_sha256,
                expected: entry.sha256.clone(),
                path: entry.logical_path.clone(),
            });
        }
        write_staged_file(staging_dir, &entry.logical_path, &plaintext)?;
        Ok(())
    }

    fn update_index(&self, summary: &BackupSnapshotSummary) -> BackupResult<()> {
        let mut index = match self.store.get_object("index.json") {
            Ok(bytes) => serde_json::from_slice::<BackupIndex>(&bytes)
                .unwrap_or_else(|_| BackupIndex::empty(String::new())),
            Err(_) => BackupIndex::empty(String::new()),
        };

        index.format = INDEX_FORMAT.to_string();
        index.updated_at = now_rfc3339()?;
        index.latest_snapshot_id = Some(summary.id.clone());
        index.snapshots.retain(|snapshot| snapshot.id != summary.id);
        index.snapshots.push(summary.clone());
        index
            .snapshots
            .sort_by(|left, right| right.created_at.cmp(&left.created_at));

        self.write_index(index.snapshots)
    }

    fn write_index(&self, mut snapshots: Vec<BackupSnapshotSummary>) -> BackupResult<()> {
        snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        let latest_snapshot_id = snapshots.first().map(|snapshot| snapshot.id.clone());
        let index = BackupIndex {
            format: INDEX_FORMAT.to_string(),
            updated_at: now_rfc3339()?,
            latest_snapshot_id,
            snapshots,
        };

        let bytes = serde_json::to_vec_pretty(&index)?;
        let sha256 = sha256_bytes(&bytes);
        let _ = self.store.delete_object("index.json");
        self.store.put_object("index.json", &bytes, &sha256)
    }
}

pub struct BackupCreateRequest<'a> {
    pub app_data_dir: &'a Path,
    pub app_version: String,
    pub database_snapshot_path: &'a Path,
    pub device_id: String,
    pub device_name: String,
    pub manual: bool,
    pub master_key: &'a [u8],
    pub schema_version: i64,
}

pub struct BackupRestoreRequest<'a> {
    pub current_schema_version: i64,
    pub master_key: &'a [u8],
    pub snapshot_id: &'a str,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestorePlan {
    pub snapshot: BackupSnapshotSummary,
    pub required_bytes: u64,
    pub object_count: usize,
    pub warnings: Vec<String>,
}

fn object_entry_from_file_entry(entry: &BackupFileEntry) -> BackupObjectEntry {
    BackupObjectEntry {
        key: entry.object_key.clone(),
        sha256: entry.sha256.clone(),
        size_bytes: entry.size_bytes,
    }
}

fn manifest_key(snapshot_id: &str) -> String {
    format!("snapshots/{snapshot_id}/manifest.json.encrypted")
}

fn manifest_aad(snapshot_id: &str) -> String {
    format!("bioeng.backup.manifest.v1:{snapshot_id}")
}

fn snapshot_id_from_manifest_key(key: &str) -> Option<String> {
    let key = key.strip_prefix("snapshots/")?;
    let snapshot_id = key.strip_suffix("/manifest.json.encrypted")?;
    if snapshot_id.is_empty() {
        None
    } else {
        Some(snapshot_id.to_string())
    }
}

fn snapshot_id(created_at: &str) -> String {
    let timestamp = created_at
        .chars()
        .filter(|character| character.is_ascii_digit())
        .take(14)
        .collect::<String>();
    format!("snap_{timestamp}_{}", Uuid::new_v4().simple())
}

fn now_rfc3339() -> BackupResult<String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| BackupError::store(error.to_string()))
}

fn sha256_file(path: &Path) -> BackupResult<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    let mut buffer = [0; 16 * 1024];
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        use sha2::Digest;
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::{params, Connection};

    use crate::{
        generate_master_key, stores::FileSystemBackupStore, BackupCreateRequest, BackupEngine,
        BackupRestoreRequest,
    };

    #[test]
    fn local_backup_restores_database_and_attachment() {
        let app_data = tempfile::tempdir().unwrap();
        let backup_root = tempfile::tempdir().unwrap();
        let snapshot_database_path = app_data.path().join("snapshot.sqlite3");
        let live_database_path = app_data.path().join("bioeng.sqlite3");
        let skill_dir = app_data.path().join("skills").join("circuit-style");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), b"Keep circuits modular.").unwrap();

        let connection = Connection::open(&live_database_path).unwrap();
        connection
            .execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);")
            .unwrap();
        connection
            .execute(
                "VACUUM main INTO ?1",
                params![snapshot_database_path.to_string_lossy().as_ref()],
            )
            .unwrap();

        let key = generate_master_key();
        let store = FileSystemBackupStore::new(backup_root.path());
        let engine = BackupEngine::new(store);
        let summary = engine
            .create_snapshot(BackupCreateRequest {
                app_data_dir: app_data.path(),
                app_version: "0.1.0".to_string(),
                database_snapshot_path: &snapshot_database_path,
                device_id: "dev_test".to_string(),
                device_name: "Test Device".to_string(),
                manual: true,
                master_key: &key,
                schema_version: 1,
            })
            .unwrap();

        let staging_parent = tempfile::tempdir().unwrap();
        let staging = staging_parent.path().join("restore");
        engine
            .restore_to_staging(
                BackupRestoreRequest {
                    current_schema_version: 1,
                    master_key: &key,
                    snapshot_id: &summary.id,
                },
                &staging,
            )
            .unwrap();

        assert!(staging.join("bioeng.sqlite3").is_file());
        assert_eq!(
            fs::read(staging.join("skills/circuit-style/SKILL.md")).unwrap(),
            b"Keep circuits modular."
        );
    }

    #[test]
    fn corrupt_object_fails_restore_before_staging() {
        let app_data = tempfile::tempdir().unwrap();
        let backup_root = tempfile::tempdir().unwrap();
        let snapshot_database_path = app_data.path().join("snapshot.sqlite3");
        let live_database_path = app_data.path().join("bioeng.sqlite3");
        Connection::open(&live_database_path)
            .unwrap()
            .execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);")
            .unwrap();
        Connection::open(&live_database_path)
            .unwrap()
            .execute(
                "VACUUM main INTO ?1",
                params![snapshot_database_path.to_string_lossy().as_ref()],
            )
            .unwrap();

        let key = generate_master_key();
        let store = FileSystemBackupStore::new(backup_root.path());
        let engine = BackupEngine::new(store.clone());
        let summary = engine
            .create_snapshot(BackupCreateRequest {
                app_data_dir: app_data.path(),
                app_version: "0.1.0".to_string(),
                database_snapshot_path: &snapshot_database_path,
                device_id: "dev_test".to_string(),
                device_name: "Test Device".to_string(),
                manual: true,
                master_key: &key,
                schema_version: 1,
            })
            .unwrap();

        let snapshots = engine.list_snapshots(&key).unwrap();
        let manifest = engine.load_manifest(&snapshots[0].id, &key).unwrap();
        fs::write(
            backup_root.path().join(&manifest.database.object_key),
            b"corrupt",
        )
        .unwrap();

        let staging_parent = tempfile::tempdir().unwrap();
        let staging = staging_parent.path().join("restore");
        assert!(engine
            .restore_to_staging(
                BackupRestoreRequest {
                    current_schema_version: 1,
                    master_key: &key,
                    snapshot_id: &summary.id,
                },
                &staging,
            )
            .is_err());
        assert!(!staging.join("bioeng.sqlite3").exists());
    }
}
