use std::collections::BTreeSet;

use serde::Serialize;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{
    manifest::{BackupSnapshotSummary, SnapshotManifest},
    BackupObjectMeta,
};

const DEFAULT_HOURLY_SNAPSHOTS: usize = 24;
const DEFAULT_DAILY_SNAPSHOTS: usize = 30;
const DEFAULT_MONTHLY_SNAPSHOTS: usize = 12;
const DEFAULT_OBJECT_DELETE_SAFETY_SECONDS: u64 = 24 * 60 * 60;

#[derive(Clone, Debug)]
pub struct BackupRetentionPolicy {
    pub hourly_snapshots: usize,
    pub daily_snapshots: usize,
    pub monthly_snapshots: usize,
    pub object_delete_safety_seconds: u64,
}

impl Default for BackupRetentionPolicy {
    fn default() -> Self {
        Self {
            hourly_snapshots: DEFAULT_HOURLY_SNAPSHOTS,
            daily_snapshots: DEFAULT_DAILY_SNAPSHOTS,
            monthly_snapshots: DEFAULT_MONTHLY_SNAPSHOTS,
            object_delete_safety_seconds: DEFAULT_OBJECT_DELETE_SAFETY_SECONDS,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRetentionPlan {
    pub retained_snapshots: Vec<BackupSnapshotSummary>,
    pub deleted_snapshots: Vec<BackupSnapshotSummary>,
    pub deleted_object_keys: Vec<String>,
    pub protected_manual_snapshots: Vec<BackupSnapshotSummary>,
    pub freed_bytes: u64,
}

pub(crate) fn build_retention_plan(
    manifests: Vec<SnapshotManifest>,
    objects: Vec<BackupObjectMeta>,
    policy: BackupRetentionPolicy,
) -> BackupRetentionPlan {
    let mut manifests = manifests;
    manifests.sort_by(|left, right| right.created_at.cmp(&left.created_at));

    let retained_snapshot_ids = retained_snapshot_ids(&manifests, &policy);
    let mut retained_snapshots = Vec::new();
    let mut deleted_snapshots = Vec::new();
    let mut protected_manual_snapshots = Vec::new();
    let mut retained_object_keys = BTreeSet::new();

    for manifest in &manifests {
        let summary = BackupSnapshotSummary::from_manifest(manifest);
        if retained_snapshot_ids.contains(&manifest.snapshot_id) {
            retained_object_keys.extend(manifest.objects.iter().map(|object| object.key.clone()));
            if manifest.manual {
                protected_manual_snapshots.push(summary.clone());
            }
            retained_snapshots.push(summary);
        } else {
            deleted_snapshots.push(summary);
        }
    }

    let now = OffsetDateTime::now_utc();
    let mut deleted_object_keys = Vec::new();
    let mut freed_bytes = 0;
    for object in objects {
        if !object.key.starts_with("objects/") || retained_object_keys.contains(&object.key) {
            continue;
        }
        if !object_is_past_safety_window(&object, now, policy.object_delete_safety_seconds) {
            continue;
        }

        freed_bytes += object.size_bytes;
        deleted_object_keys.push(object.key);
    }

    deleted_object_keys.sort();

    BackupRetentionPlan {
        retained_snapshots,
        deleted_snapshots,
        deleted_object_keys,
        protected_manual_snapshots,
        freed_bytes,
    }
}

fn retained_snapshot_ids(
    manifests: &[SnapshotManifest],
    policy: &BackupRetentionPolicy,
) -> BTreeSet<String> {
    let mut retained = BTreeSet::new();

    for manifest in manifests {
        if manifest.manual {
            retained.insert(manifest.snapshot_id.clone());
        }
    }

    retain_by_bucket(
        manifests,
        &mut retained,
        policy.hourly_snapshots,
        BucketPrecision::Hour,
    );
    retain_by_bucket(
        manifests,
        &mut retained,
        policy.daily_snapshots,
        BucketPrecision::Day,
    );
    retain_by_bucket(
        manifests,
        &mut retained,
        policy.monthly_snapshots,
        BucketPrecision::Month,
    );

    retained
}

fn retain_by_bucket(
    manifests: &[SnapshotManifest],
    retained: &mut BTreeSet<String>,
    limit: usize,
    precision: BucketPrecision,
) {
    if limit == 0 {
        return;
    }

    let mut seen_buckets = BTreeSet::new();
    for manifest in manifests.iter().filter(|manifest| !manifest.manual) {
        let Some(bucket) = bucket_for_timestamp(&manifest.created_at, precision) else {
            continue;
        };
        if seen_buckets.insert(bucket) {
            retained.insert(manifest.snapshot_id.clone());
            if seen_buckets.len() >= limit {
                return;
            }
        }
    }
}

#[derive(Clone, Copy)]
enum BucketPrecision {
    Hour,
    Day,
    Month,
}

fn bucket_for_timestamp(value: &str, precision: BucketPrecision) -> Option<String> {
    let length = match precision {
        BucketPrecision::Hour => 13,
        BucketPrecision::Day => 10,
        BucketPrecision::Month => 7,
    };

    if value.len() >= length {
        Some(value[..length].to_string())
    } else {
        None
    }
}

fn object_is_past_safety_window(
    object: &BackupObjectMeta,
    now: OffsetDateTime,
    safety_seconds: u64,
) -> bool {
    if safety_seconds == 0 {
        return true;
    }

    let Some(modified_at) = object.modified_at.as_deref() else {
        return false;
    };
    let Ok(modified_at) = OffsetDateTime::parse(modified_at, &Rfc3339) else {
        return false;
    };
    let age = now - modified_at;
    age.whole_seconds() >= safety_seconds as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        BackupAppMetadata, BackupDeviceMetadata, BackupEncryptionMetadata, BackupObjectEntry,
    };

    #[test]
    fn retention_keeps_manual_snapshots() {
        let policy = BackupRetentionPolicy {
            hourly_snapshots: 0,
            daily_snapshots: 0,
            monthly_snapshots: 0,
            object_delete_safety_seconds: 0,
        };

        let plan = build_retention_plan(
            vec![
                manifest("manual", "2026-06-06T10:00:00Z", true, "objects/manual"),
                manifest("auto", "2026-06-06T09:00:00Z", false, "objects/auto"),
            ],
            vec![
                object("objects/manual", 10),
                object("objects/auto", 20),
                object("objects/orphan", 30),
            ],
            policy,
        );

        assert_eq!(plan.retained_snapshots.len(), 1);
        assert_eq!(plan.retained_snapshots[0].id, "manual");
        assert_eq!(plan.deleted_snapshots.len(), 1);
        assert!(plan
            .deleted_object_keys
            .contains(&"objects/auto".to_string()));
        assert!(plan
            .deleted_object_keys
            .contains(&"objects/orphan".to_string()));
        assert!(!plan
            .deleted_object_keys
            .contains(&"objects/manual".to_string()));
    }

    #[test]
    fn retention_keeps_newest_automatic_snapshot_by_bucket() {
        let policy = BackupRetentionPolicy {
            hourly_snapshots: 1,
            daily_snapshots: 2,
            monthly_snapshots: 0,
            object_delete_safety_seconds: 0,
        };

        let plan = build_retention_plan(
            vec![
                manifest("new_hour", "2026-06-06T10:40:00Z", false, "objects/new"),
                manifest(
                    "old_same_hour",
                    "2026-06-06T10:05:00Z",
                    false,
                    "objects/old",
                ),
                manifest("prior_day", "2026-06-05T08:00:00Z", false, "objects/prior"),
            ],
            Vec::new(),
            policy,
        );
        let retained = plan
            .retained_snapshots
            .iter()
            .map(|snapshot| snapshot.id.as_str())
            .collect::<Vec<_>>();

        assert!(retained.contains(&"new_hour"));
        assert!(retained.contains(&"prior_day"));
        assert!(!retained.contains(&"old_same_hour"));
    }

    fn manifest(
        snapshot_id: &str,
        created_at: &str,
        manual: bool,
        object_key: &str,
    ) -> SnapshotManifest {
        SnapshotManifest {
            format: "gg.backup.snapshot.v1".to_string(),
            snapshot_id: snapshot_id.to_string(),
            created_at: created_at.to_string(),
            manual,
            app: BackupAppMetadata {
                name: "GG Circuit".to_string(),
                version: "0.1.0".to_string(),
                schema_version: 1,
            },
            device: BackupDeviceMetadata {
                id: "dev".to_string(),
                name: "Device".to_string(),
            },
            encryption: BackupEncryptionMetadata {
                mode: "xchacha20poly1305-v1".to_string(),
                key_id: "key".to_string(),
            },
            database: crate::BackupFileEntry {
                logical_path: "gg.sqlite3".to_string(),
                size_bytes: 1,
                sha256: "0".repeat(64),
                object_key: object_key.to_string(),
            },
            attachments: Vec::new(),
            objects: vec![BackupObjectEntry {
                key: object_key.to_string(),
                sha256: "0".repeat(64),
                size_bytes: 1,
            }],
        }
    }

    fn object(key: &str, size_bytes: u64) -> BackupObjectMeta {
        BackupObjectMeta {
            key: key.to_string(),
            size_bytes,
            modified_at: Some("2026-01-01T00:00:00Z".to_string()),
            provider_revision: None,
        }
    }
}
