use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::path::Path;

use crate::Database;

use super::AppSettings;

const SETTINGS_KEY: &str = "app";

impl Database {
    pub(crate) fn import_legacy_app_settings(&self, legacy_db_path: &Path) -> Result<(), String> {
        if !legacy_db_path.exists() || self.has_app_settings()? {
            return Ok(());
        }

        let legacy_connection = Connection::open_with_flags(
            legacy_db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| error.to_string())?;

        let has_settings_table = legacy_connection
            .query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM sqlite_master
                    WHERE type = 'table' AND name = 'settings'
                )
                "#,
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?
            != 0;

        if !has_settings_table {
            return Ok(());
        }

        let raw_settings: Option<String> = legacy_connection
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        let Some(raw_settings) = raw_settings else {
            return Ok(());
        };

        let settings = serde_json::from_str::<AppSettings>(&raw_settings)
            .map(AppSettings::normalized)
            .map_err(|error| error.to_string())?;
        self.save_app_settings(&settings)
    }

    pub fn load_app_settings(&self) -> Result<AppSettings, String> {
        let connection = self.connection()?;
        let raw_settings: Option<String> = connection
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        match raw_settings {
            Some(raw_settings) => serde_json::from_str::<AppSettings>(&raw_settings)
                .map(AppSettings::normalized)
                .map_err(|error| error.to_string()),
            None => {
                let default_settings = AppSettings::default();
                drop(connection);
                self.save_app_settings(&default_settings)?;
                Ok(default_settings)
            }
        }
    }

    pub fn save_app_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let settings = settings.clone().normalized();
        let serialized = serde_json::to_string(&settings).map_err(|error| error.to_string())?;

        self.connection()?
            .execute(
                r#"
                INSERT INTO settings (key, value, updated_at)
                VALUES (?1, ?2, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                params![SETTINGS_KEY, serialized],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn has_app_settings(&self) -> Result<bool, String> {
        let has_settings = self
            .connection()?
            .query_row(
                "SELECT 1 FROM settings WHERE key = ?1",
                params![SETTINGS_KEY],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .is_some();

        Ok(has_settings)
    }
}
