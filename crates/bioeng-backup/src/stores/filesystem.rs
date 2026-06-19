use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use walkdir::WalkDir;

use crate::{
    encryption::sha256_bytes,
    errors::{BackupError, BackupResult},
    BackupObjectMeta, BackupStore,
};

#[derive(Clone, Debug)]
pub struct FileSystemBackupStore {
    root: PathBuf,
}

impl FileSystemBackupStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn key_path(&self, key: &str) -> BackupResult<PathBuf> {
        safe_join(&self.root, key)
    }
}

impl BackupStore for FileSystemBackupStore {
    fn put_object(&self, key: &str, bytes: &[u8], expected_sha256: &str) -> BackupResult<()> {
        let actual_sha256 = sha256_bytes(bytes);
        if actual_sha256 != expected_sha256 {
            return Err(BackupError::VerifyHash {
                actual: actual_sha256,
                expected: expected_sha256.to_string(),
                path: key.to_string(),
            });
        }

        let path = self.key_path(key)?;
        if path.exists() {
            let existing = fs::read(&path)?;
            let existing_sha256 = sha256_bytes(&existing);
            if existing_sha256 == expected_sha256 {
                return Ok(());
            }

            return Err(BackupError::VerifyHash {
                actual: existing_sha256,
                expected: expected_sha256.to_string(),
                path: key.to_string(),
            });
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let temporary_path = path.with_extension("tmp");
        fs::write(&temporary_path, bytes)?;
        fs::rename(&temporary_path, &path)?;
        Ok(())
    }

    fn get_object(&self, key: &str) -> BackupResult<Vec<u8>> {
        let path = self.key_path(key)?;
        fs::read(path).map_err(BackupError::from)
    }

    fn list_objects(&self, prefix: &str) -> BackupResult<Vec<BackupObjectMeta>> {
        let root = self.key_path(prefix)?;
        if !root.exists() {
            return Ok(Vec::new());
        }

        let mut objects = Vec::new();
        for entry in WalkDir::new(root).into_iter() {
            let entry = entry.map_err(|error| BackupError::store(error.to_string()))?;
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let metadata = path.metadata()?;
            let key = path
                .strip_prefix(&self.root)
                .map_err(|error| BackupError::store(error.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");

            objects.push(BackupObjectMeta {
                key,
                size_bytes: metadata.len(),
                modified_at: metadata
                    .modified()
                    .ok()
                    .and_then(|modified| OffsetDateTime::from(modified).format(&Rfc3339).ok()),
                provider_revision: None,
            });
        }

        objects.sort_by(|left, right| left.key.cmp(&right.key));
        Ok(objects)
    }

    fn delete_object(&self, key: &str) -> BackupResult<()> {
        let path = self.key_path(key)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

pub(crate) fn safe_join(root: &Path, relative: &str) -> BackupResult<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err(BackupError::unsafe_path(relative));
    }

    let mut joined = root.to_path_buf();
    for component in path.components() {
        match component {
            Component::Normal(segment) => joined.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(BackupError::unsafe_path(relative));
            }
        }
    }

    Ok(joined)
}

#[cfg(test)]
mod tests {
    use crate::{stores::filesystem::safe_join, stores::FileSystemBackupStore, BackupStore};

    #[test]
    fn filesystem_store_rejects_unsafe_keys() {
        let temp = tempfile::tempdir().unwrap();
        let store = FileSystemBackupStore::new(temp.path());
        assert!(store.put_object("../x", b"x", "unused").is_err());
        assert!(safe_join(temp.path(), "/absolute").is_err());
    }
}
