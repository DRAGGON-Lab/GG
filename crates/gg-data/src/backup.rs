use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::Database;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupActivityEntry {
    pub id: String,
    pub provider: String,
    pub operation: String,
    pub status: String,
    pub snapshot_id: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub bytes_total: u64,
    pub bytes_completed: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Default)]
pub struct BackupActivityInput {
    pub id: Option<String>,
    pub provider: String,
    pub operation: String,
    pub status: String,
    pub snapshot_id: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub bytes_total: u64,
    pub bytes_completed: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub message: String,
}

impl Database {
    pub fn record_backup_activity(
        &self,
        input: BackupActivityInput,
    ) -> Result<BackupActivityEntry, String> {
        let id = input
            .id
            .unwrap_or_else(|| format!("bt_{}", timestamp_millis_string()));
        let started_at = input.started_at.unwrap_or_else(timestamp_millis_string);
        let entry = BackupActivityEntry {
            id,
            provider: non_empty_or_default(input.provider, "local"),
            operation: input.operation,
            status: input.status,
            snapshot_id: input.snapshot_id,
            started_at,
            finished_at: input.finished_at,
            bytes_total: input.bytes_total,
            bytes_completed: input.bytes_completed,
            error_code: input.error_code,
            error_message: input.error_message,
            message: input.message,
        };

        self.connection()?
            .execute(
                r#"
                INSERT INTO backup_activity (
                    id,
                    provider,
                    operation,
                    status,
                    snapshot_id,
                    started_at,
                    finished_at,
                    bytes_total,
                    bytes_completed,
                    error_code,
                    error_message,
                    message
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                "#,
                params![
                    entry.id,
                    entry.provider,
                    entry.operation,
                    entry.status,
                    entry.snapshot_id,
                    entry.started_at,
                    entry.finished_at,
                    u64_to_i64(entry.bytes_total)?,
                    u64_to_i64(entry.bytes_completed)?,
                    entry.error_code,
                    entry.error_message,
                    entry.message
                ],
            )
            .map_err(|error| error.to_string())?;

        Ok(entry)
    }

    pub fn list_backup_activity(&self, limit: usize) -> Result<Vec<BackupActivityEntry>, String> {
        let limit = limit.clamp(1, 100);
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT
                    id,
                    provider,
                    operation,
                    status,
                    snapshot_id,
                    started_at,
                    finished_at,
                    bytes_total,
                    bytes_completed,
                    error_code,
                    error_message,
                    message
                FROM backup_activity
                ORDER BY started_at DESC, id DESC
                LIMIT ?1
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([limit as i64], backup_activity_from_row)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }
}

fn backup_activity_from_row(row: &Row<'_>) -> rusqlite::Result<BackupActivityEntry> {
    let bytes_total: i64 = row.get(7)?;
    let bytes_completed: i64 = row.get(8)?;
    Ok(BackupActivityEntry {
        id: row.get(0)?,
        provider: row.get(1)?,
        operation: row.get(2)?,
        status: row.get(3)?,
        snapshot_id: row.get(4)?,
        started_at: row.get(5)?,
        finished_at: row.get(6)?,
        bytes_total: i64_to_u64(bytes_total),
        bytes_completed: i64_to_u64(bytes_completed),
        error_code: row.get(9)?,
        error_message: row.get(10)?,
        message: row.get(11)?,
    })
}

fn timestamp_millis_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn non_empty_or_default(value: String, default: &str) -> String {
    if value.trim().is_empty() {
        default.to_string()
    } else {
        value
    }
}

fn u64_to_i64(value: u64) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| "backup activity byte count exceeds i64".to_string())
}

fn i64_to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_activity_round_trips() {
        let temp = tempfile::tempdir().unwrap();
        let database = Database::open(temp.path().join("gg.sqlite3")).unwrap();

        database
            .record_backup_activity(BackupActivityInput {
                provider: "local".to_string(),
                operation: "backup".to_string(),
                status: "failed".to_string(),
                snapshot_id: Some("snap_test".to_string()),
                started_at: Some("1000".to_string()),
                finished_at: Some("2000".to_string()),
                bytes_total: 10,
                bytes_completed: 5,
                error_code: Some("store_error".to_string()),
                error_message: Some("disk full".to_string()),
                message: "Backup failed".to_string(),
                ..BackupActivityInput::default()
            })
            .unwrap();

        let entries = database.list_backup_activity(10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].operation, "backup");
        assert_eq!(entries[0].status, "failed");
        assert_eq!(entries[0].error_message.as_deref(), Some("disk full"));
    }
}
