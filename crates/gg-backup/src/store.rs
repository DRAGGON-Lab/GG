use crate::errors::BackupResult;

#[derive(Clone, Debug)]
pub struct BackupObjectMeta {
    pub key: String,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
    pub provider_revision: Option<String>,
}

pub trait BackupStore {
    fn put_object(&self, key: &str, bytes: &[u8], expected_sha256: &str) -> BackupResult<()>;
    fn get_object(&self, key: &str) -> BackupResult<Vec<u8>>;
    fn list_objects(&self, prefix: &str) -> BackupResult<Vec<BackupObjectMeta>>;
    fn delete_object(&self, key: &str) -> BackupResult<()>;
}
