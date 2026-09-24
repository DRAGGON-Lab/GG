use std::path::Path;

use rusqlite::{params, Connection};

use crate::{errors::BackupResult, BackupError};

pub fn create_sqlite_snapshot(source: &Path, destination: &Path) -> BackupResult<()> {
    if destination.exists() {
        std::fs::remove_file(destination)?;
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let destination = destination
        .to_str()
        .ok_or_else(|| BackupError::store("backup snapshot path is not valid UTF-8"))?;
    Connection::open(source)?.execute("VACUUM main INTO ?1", params![destination])?;
    sqlite_integrity_check(Path::new(destination))
}

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

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{create_sqlite_snapshot, sqlite_integrity_check};

    #[test]
    fn creates_consistent_snapshot_from_live_wal_database() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("live.sqlite3");
        let destination = directory.path().join("snapshot.sqlite3");
        let connection = Connection::open(&source).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .execute_batch("CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('ok');")
            .unwrap();

        create_sqlite_snapshot(&source, &destination).unwrap();

        sqlite_integrity_check(&destination).unwrap();
        let snapshot = Connection::open(destination).unwrap();
        let value: String = snapshot
            .query_row("SELECT value FROM records", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "ok");
    }
}
