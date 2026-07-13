use std::{fmt, path::PathBuf};

pub type BackupResult<T> = Result<T, BackupError>;

#[derive(Debug)]
pub enum BackupError {
    Crypto(String),
    IncompatibleSchema {
        app_schema_version: i64,
        snapshot_schema_version: i64,
    },
    InvalidRecoveryKey,
    Io(std::io::Error),
    Json(serde_json::Error),
    MissingAttachment(String),
    MissingBackupDestination,
    MissingBackupKey,
    RestoreInstall(String),
    SnapshotNotFound(String),
    Sqlite(rusqlite::Error),
    Store(String),
    UnsafePath(String),
    VerifyHash {
        actual: String,
        expected: String,
        path: String,
    },
}

impl BackupError {
    pub fn store(message: impl Into<String>) -> Self {
        Self::Store(message.into())
    }

    pub fn unsafe_path(path: impl Into<String>) -> Self {
        Self::UnsafePath(path.into())
    }

    pub fn restore_install(message: impl Into<String>) -> Self {
        Self::RestoreInstall(message.into())
    }

    pub fn path_display(path: PathBuf) -> String {
        path.to_string_lossy().to_string()
    }
}

impl fmt::Display for BackupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Crypto(message) => write!(formatter, "Backup encryption failed: {message}"),
            Self::IncompatibleSchema {
                app_schema_version,
                snapshot_schema_version,
            } => write!(
                formatter,
                "This backup uses schema version {snapshot_schema_version}, but this app supports schema version {app_schema_version}."
            ),
            Self::InvalidRecoveryKey => formatter.write_str("The recovery key is not valid."),
            Self::Io(error) => write!(formatter, "File system error: {error}"),
            Self::Json(error) => write!(formatter, "Backup metadata error: {error}"),
            Self::MissingAttachment(path) => {
                write!(formatter, "Backup attachment is missing: {path}.")
            }
            Self::MissingBackupDestination => {
                formatter.write_str("Choose a local backup folder before backing up.")
            }
            Self::MissingBackupKey => formatter.write_str("No local backup encryption key exists."),
            Self::RestoreInstall(message) => write!(formatter, "Restore install failed: {message}"),
            Self::SnapshotNotFound(snapshot_id) => {
                write!(formatter, "Backup snapshot was not found: {snapshot_id}.")
            }
            Self::Sqlite(error) => write!(formatter, "SQLite error: {error}"),
            Self::Store(message) => write!(formatter, "Backup storage error: {message}"),
            Self::UnsafePath(path) => write!(formatter, "Backup path is not safe: {path}."),
            Self::VerifyHash {
                actual,
                expected,
                path,
            } => write!(
                formatter,
                "Backup object verification failed for {path}: expected {expected}, found {actual}."
            ),
        }
    }
}

impl std::error::Error for BackupError {}

impl From<std::io::Error> for BackupError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for BackupError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for BackupError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}
