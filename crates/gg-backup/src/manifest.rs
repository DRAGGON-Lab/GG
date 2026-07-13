use serde::{Deserialize, Serialize};

pub const INDEX_FORMAT: &str = "gg.backup.index.v1";
pub const SNAPSHOT_FORMAT: &str = "gg.backup.snapshot.v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupIndex {
    pub format: String,
    pub updated_at: String,
    pub latest_snapshot_id: Option<String>,
    pub snapshots: Vec<BackupSnapshotSummary>,
}

impl BackupIndex {
    pub fn empty(updated_at: String) -> Self {
        Self {
            format: INDEX_FORMAT.to_string(),
            updated_at,
            latest_snapshot_id: None,
            snapshots: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSnapshotSummary {
    pub id: String,
    pub created_at: String,
    pub app_version: String,
    pub schema_version: i64,
    pub total_bytes: u64,
    pub device_name: String,
    pub attachment_count: usize,
    pub manual: bool,
}

impl BackupSnapshotSummary {
    pub fn from_manifest(manifest: &SnapshotManifest) -> Self {
        let total_bytes = manifest
            .objects
            .iter()
            .map(|object| object.size_bytes)
            .sum::<u64>();

        Self {
            id: manifest.snapshot_id.clone(),
            created_at: manifest.created_at.clone(),
            app_version: manifest.app.version.clone(),
            schema_version: manifest.app.schema_version,
            total_bytes,
            device_name: manifest.device.name.clone(),
            attachment_count: manifest.attachments.len(),
            manual: manifest.manual,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifest {
    pub format: String,
    pub snapshot_id: String,
    pub created_at: String,
    pub manual: bool,
    pub app: BackupAppMetadata,
    pub device: BackupDeviceMetadata,
    pub encryption: BackupEncryptionMetadata,
    pub database: BackupFileEntry,
    pub attachments: Vec<BackupFileEntry>,
    pub objects: Vec<BackupObjectEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupAppMetadata {
    pub name: String,
    pub version: String,
    pub schema_version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDeviceMetadata {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEncryptionMetadata {
    pub mode: String,
    pub key_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileEntry {
    pub logical_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub object_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupObjectEntry {
    pub key: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::{
        BackupAppMetadata, BackupDeviceMetadata, BackupEncryptionMetadata, BackupFileEntry,
        BackupObjectEntry, SnapshotManifest, SNAPSHOT_FORMAT,
    };

    #[test]
    fn manifest_serializes_stable_format() {
        let manifest = SnapshotManifest {
            format: SNAPSHOT_FORMAT.to_string(),
            snapshot_id: "snap_test".to_string(),
            created_at: "2026-06-06T00:00:00Z".to_string(),
            manual: true,
            app: BackupAppMetadata {
                name: "GG Circuit".to_string(),
                version: "0.1.0".to_string(),
                schema_version: 7,
            },
            device: BackupDeviceMetadata {
                id: "dev_test".to_string(),
                name: "Test".to_string(),
            },
            encryption: BackupEncryptionMetadata {
                mode: "xchacha20poly1305-v1".to_string(),
                key_id: "key".to_string(),
            },
            database: BackupFileEntry {
                logical_path: "gg.sqlite3".to_string(),
                size_bytes: 1,
                sha256: "a".repeat(64),
                object_key: "objects/sha256/aa/aa/object.encrypted".to_string(),
            },
            attachments: Vec::new(),
            objects: vec![BackupObjectEntry {
                key: "objects/sha256/aa/aa/object.encrypted".to_string(),
                sha256: "a".repeat(64),
                size_bytes: 1,
            }],
        };

        let serialized = serde_json::to_string(&manifest).unwrap();
        assert!(serialized.contains("gg.backup.snapshot.v1"));
        assert!(serialized.contains("schemaVersion"));
        assert!(serialized.contains("objectKey"));
    }
}
