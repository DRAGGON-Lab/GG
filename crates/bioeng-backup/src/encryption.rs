use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    XChaCha20Poly1305,
};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::{
    errors::{BackupError, BackupResult},
    BackupFileEntry,
};

pub type BackupMasterKey = [u8; MASTER_KEY_LEN];

const ENCRYPTED_BLOB_MAGIC: &[u8; 8] = b"CGBKENC1";
const MASTER_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const RECOVERY_KEY_PREFIX: &str = "CGBK1-";

type HmacSha256 = Hmac<Sha256>;

pub fn generate_master_key() -> BackupMasterKey {
    let key = XChaCha20Poly1305::generate_key(&mut OsRng);
    let mut output = [0; MASTER_KEY_LEN];
    output.copy_from_slice(&key);
    output
}

pub fn recovery_key_for_master_key(master_key: &[u8]) -> BackupResult<String> {
    let key = normalize_master_key(master_key)?;
    Ok(format!(
        "{RECOVERY_KEY_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(key)
    ))
}

pub fn master_key_from_recovery_key(recovery_key: &str) -> BackupResult<BackupMasterKey> {
    let token = recovery_key
        .split_whitespace()
        .find(|candidate| candidate.starts_with(RECOVERY_KEY_PREFIX))
        .ok_or(BackupError::InvalidRecoveryKey)?;
    let encoded = token
        .strip_prefix(RECOVERY_KEY_PREFIX)
        .ok_or(BackupError::InvalidRecoveryKey)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| BackupError::InvalidRecoveryKey)?;

    if bytes.len() != MASTER_KEY_LEN {
        return Err(BackupError::InvalidRecoveryKey);
    }

    let mut key = [0; MASTER_KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(key)
}

pub fn key_id(master_key: &[u8]) -> BackupResult<String> {
    let key = normalize_master_key(master_key)?;
    let mut hasher = Sha256::new();
    hasher.update(b"bioeng.backup.key-id.v1");
    hasher.update(key);
    Ok(hex::encode(&hasher.finalize()[..16]))
}

pub fn object_key_for_plaintext_hash(
    master_key: &[u8],
    plaintext_sha256: &str,
) -> BackupResult<String> {
    let key = normalize_master_key(master_key)?;
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key)
        .map_err(|error| BackupError::Crypto(error.to_string()))?;
    mac.update(b"bioeng.backup.object-key.v1:");
    mac.update(plaintext_sha256.as_bytes());
    let digest = hex::encode(mac.finalize().into_bytes());
    Ok(format!(
        "objects/sha256/{}/{}/{}.encrypted",
        &digest[..2],
        &digest[2..4],
        digest
    ))
}

pub fn encrypt_bytes(master_key: &[u8], aad: &[u8], plaintext: &[u8]) -> BackupResult<Vec<u8>> {
    let key = normalize_master_key(master_key)?;
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| BackupError::Crypto(error.to_string()))?;
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|error| BackupError::Crypto(error.to_string()))?;

    let mut encrypted =
        Vec::with_capacity(ENCRYPTED_BLOB_MAGIC.len() + NONCE_LEN + ciphertext.len());
    encrypted.extend_from_slice(ENCRYPTED_BLOB_MAGIC);
    encrypted.extend_from_slice(&nonce);
    encrypted.extend_from_slice(&ciphertext);
    Ok(encrypted)
}

pub fn decrypt_bytes(master_key: &[u8], aad: &[u8], encrypted: &[u8]) -> BackupResult<Vec<u8>> {
    let key = normalize_master_key(master_key)?;

    if encrypted.len() < ENCRYPTED_BLOB_MAGIC.len() + NONCE_LEN
        || &encrypted[..ENCRYPTED_BLOB_MAGIC.len()] != ENCRYPTED_BLOB_MAGIC
    {
        return Err(BackupError::Crypto(
            "encrypted backup object has an unknown format".to_string(),
        ));
    }

    let nonce_start = ENCRYPTED_BLOB_MAGIC.len();
    let nonce_end = nonce_start + NONCE_LEN;
    let nonce = chacha20poly1305::XNonce::from_slice(&encrypted[nonce_start..nonce_end]);
    let ciphertext = &encrypted[nonce_end..];
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| BackupError::Crypto(error.to_string()))?;

    cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|error| BackupError::Crypto(error.to_string()))
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn encrypted_object_aad(entry: &BackupFileEntry) -> &[u8] {
    entry.object_key.as_bytes()
}

fn normalize_master_key(master_key: &[u8]) -> BackupResult<&[u8; MASTER_KEY_LEN]> {
    master_key
        .try_into()
        .map_err(|_| BackupError::Crypto("backup key must be 32 bytes".to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        decrypt_bytes, encrypt_bytes, generate_master_key, key_id, master_key_from_recovery_key,
        object_key_for_plaintext_hash, recovery_key_for_master_key,
    };

    #[test]
    fn encryption_round_trips_with_aad() {
        let key = generate_master_key();
        let encrypted = encrypt_bytes(&key, b"object", b"plaintext").unwrap();
        assert_ne!(encrypted, b"plaintext");
        assert_eq!(
            decrypt_bytes(&key, b"object", &encrypted).unwrap(),
            b"plaintext"
        );
        assert!(decrypt_bytes(&key, b"other", &encrypted).is_err());
    }

    #[test]
    fn recovery_key_round_trips_master_key() {
        let key = generate_master_key();
        let recovery_key = recovery_key_for_master_key(&key).unwrap();
        assert_eq!(master_key_from_recovery_key(&recovery_key).unwrap(), key);
    }

    #[test]
    fn object_keys_are_deterministic_and_keyed() {
        let key = generate_master_key();
        let other_key = generate_master_key();
        let hash = "a".repeat(64);
        assert_eq!(
            object_key_for_plaintext_hash(&key, &hash).unwrap(),
            object_key_for_plaintext_hash(&key, &hash).unwrap()
        );
        assert_ne!(
            object_key_for_plaintext_hash(&key, &hash).unwrap(),
            object_key_for_plaintext_hash(&other_key, &hash).unwrap()
        );
        assert_ne!(key_id(&key).unwrap(), key_id(&other_key).unwrap());
    }
}
