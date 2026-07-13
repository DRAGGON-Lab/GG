use std::path::Path;

use rusqlite::Connection;

use crate::{errors::BackupResult, BackupError};

pub fn sqlite_integrity_check(database_path: &Path) -> BackupResult<()> {
    let connection = Connection::open(database_path)?;
    let result: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(BackupError::store(format!(
            "SQLite integrity check failed: {result}"
        )));
    }

    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    let mut rows = statement.query([])?;
    if rows.next()?.is_some() {
        return Err(BackupError::store(
            "SQLite foreign key check failed for restored database",
        ));
    }

    Ok(())
}
