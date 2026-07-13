use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

pub mod inspector;
mod migrations;

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let mut connection = Connection::open(db_path).map_err(|error| error.to_string())?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| error.to_string())?;
        migrations::migrate(&mut connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn open_with_legacy_settings(
        db_path: PathBuf,
        legacy_settings_path: &Path,
    ) -> Result<Self, String> {
        let database = Self::open(db_path)?;
        database.import_legacy_app_settings(legacy_settings_path)?;
        Ok(database)
    }

    pub(crate) fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "database connection lock poisoned".to_string())
    }

    pub fn create_backup_snapshot(&self, destination: &Path) -> Result<(), String> {
        if destination.exists() {
            fs::remove_file(destination).map_err(|error| error.to_string())?;
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let destination = destination
            .to_str()
            .ok_or_else(|| "backup snapshot path is not valid UTF-8".to_string())?;

        self.connection()?
            .execute("VACUUM main INTO ?1", [destination])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn schema_version(&self) -> Result<i64, String> {
        self.connection()?
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }
}
