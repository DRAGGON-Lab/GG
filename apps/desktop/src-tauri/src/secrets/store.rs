use super::types::{SecretError, SecretString};
use std::{collections::BTreeMap, sync::Mutex};

const KEYCHAIN_SERVICE: &str = "org.draggonlab.gg";
#[cfg(target_vendor = "apple")]
const ERR_SEC_MISSING_ENTITLEMENT: i32 = -34018;
#[cfg(target_vendor = "apple")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

pub trait SecretStore: Send + Sync {
    fn set_secret(
        &self,
        namespace: &str,
        key: &str,
        value: SecretString,
    ) -> Result<(), SecretError>;
    fn get_secret(&self, namespace: &str, key: &str) -> Result<Option<SecretString>, SecretError>;
    fn delete_secret(&self, namespace: &str, key: &str) -> Result<(), SecretError>;
}

#[derive(Default)]
pub struct KeychainSecretStore {
    cache: Mutex<BTreeMap<String, SecretString>>,
}

impl KeychainSecretStore {
    #[cfg(not(target_vendor = "apple"))]
    fn entry(service: &str, namespace: &str, key: &str) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(service, &account_name(namespace, key))
            .map_err(|error| SecretError::backend(error.to_string()))
    }

    fn cache_get(&self, namespace: &str, key: &str) -> Result<Option<SecretString>, SecretError> {
        Ok(self
            .cache
            .lock()
            .map_err(|error| SecretError::backend(error.to_string()))?
            .get(&account_name(namespace, key))
            .cloned())
    }

    fn cache_set(
        &self,
        namespace: &str,
        key: &str,
        value: SecretString,
    ) -> Result<(), SecretError> {
        self.cache
            .lock()
            .map_err(|error| SecretError::backend(error.to_string()))?
            .insert(account_name(namespace, key), value);
        Ok(())
    }

    fn cache_remove(&self, namespace: &str, key: &str) -> Result<(), SecretError> {
        self.cache
            .lock()
            .map_err(|error| SecretError::backend(error.to_string()))?
            .remove(&account_name(namespace, key));
        Ok(())
    }
}

impl SecretStore for KeychainSecretStore {
    fn set_secret(
        &self,
        namespace: &str,
        key: &str,
        value: SecretString,
    ) -> Result<(), SecretError> {
        platform_set_secret(namespace, key, value.expose_secret())?;
        self.cache_set(namespace, key, value)
    }

    fn get_secret(&self, namespace: &str, key: &str) -> Result<Option<SecretString>, SecretError> {
        if let Some(value) = self.cache_get(namespace, key)? {
            return Ok(Some(value));
        }

        let value = platform_get_secret(KEYCHAIN_SERVICE, namespace, key)?.ok();

        match value {
            Some(value) => {
                let secret = SecretString::new(value);
                self.cache_set(namespace, key, secret.clone())?;
                Ok(Some(secret))
            }
            None => {
                self.cache_remove(namespace, key)?;
                Ok(None)
            }
        }
    }

    fn delete_secret(&self, namespace: &str, key: &str) -> Result<(), SecretError> {
        platform_delete_secret(KEYCHAIN_SERVICE, namespace, key)?;
        self.cache_remove(namespace, key)
    }
}

fn account_name(namespace: &str, key: &str) -> String {
    format!("{namespace}.{key}")
}

enum SecretLookupError {
    NoEntry,
}

#[cfg(target_vendor = "apple")]
fn platform_set_secret(namespace: &str, key: &str, value: &str) -> Result<(), SecretError> {
    use security_framework::{
        access_control::{ProtectionMode, SecAccessControl},
        base::Error as SecurityError,
        passwords::{set_generic_password_options, AccessControlOptions, PasswordOptions},
    };

    fn set_user_presence_secret(
        namespace: &str,
        key: &str,
        value: &str,
        recreate: bool,
    ) -> Result<(), SecurityError> {
        if recreate {
            delete_apple_generic_password(KEYCHAIN_SERVICE, namespace, key)?;
        }

        let account = account_name(namespace, key);
        let access_control = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
            AccessControlOptions::USER_PRESENCE.bits(),
        )?;
        let mut options = PasswordOptions::new_generic_password(KEYCHAIN_SERVICE, &account);
        options.set_access_control(access_control);
        set_generic_password_options(value.as_bytes(), options)
    }

    match set_user_presence_secret(namespace, key, value, false) {
        Ok(()) => Ok(()),
        Err(error) if is_missing_entitlement(error) => {
            set_standard_apple_generic_password(namespace, key, value)
        }
        // Recreate old generic keyring entries so they are upgraded to
        // user-presence access control the next time the user saves them.
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => {
            match set_user_presence_secret(namespace, key, value, true) {
                Ok(()) => Ok(()),
                Err(error) if is_missing_entitlement(error) => {
                    set_standard_apple_generic_password(namespace, key, value)
                }
                Err(error) => Err(SecretError::backend(error.to_string())),
            }
        }
        Err(error) => Err(SecretError::backend(error.to_string())),
    }
}

#[cfg(target_vendor = "apple")]
fn platform_get_secret(
    service: &str,
    namespace: &str,
    key: &str,
) -> Result<Result<String, SecretLookupError>, SecretError> {
    use security_framework::passwords;

    let account = account_name(namespace, key);
    match passwords::get_generic_password(service, &account) {
        Ok(value) => String::from_utf8(value)
            .map(Ok)
            .map_err(|error| SecretError::backend(error.to_string())),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(Err(SecretLookupError::NoEntry)),
        Err(error) => Err(SecretError::backend(error.to_string())),
    }
}

#[cfg(target_vendor = "apple")]
fn platform_delete_secret(service: &str, namespace: &str, key: &str) -> Result<(), SecretError> {
    delete_apple_generic_password(service, namespace, key)
        .map_err(|error| SecretError::backend(error.to_string()))
}

#[cfg(target_vendor = "apple")]
fn delete_apple_generic_password(
    service: &str,
    namespace: &str,
    key: &str,
) -> security_framework::base::Result<()> {
    use security_framework::passwords;

    let account = account_name(namespace, key);
    match passwords::delete_generic_password(service, &account) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(target_vendor = "apple")]
fn set_standard_apple_generic_password(
    namespace: &str,
    key: &str,
    value: &str,
) -> Result<(), SecretError> {
    use security_framework::passwords;

    let account = account_name(namespace, key);
    passwords::set_generic_password(KEYCHAIN_SERVICE, &account, value.as_bytes())
        .map_err(|error| SecretError::backend(error.to_string()))
}

#[cfg(target_vendor = "apple")]
fn is_missing_entitlement(error: security_framework::base::Error) -> bool {
    error.code() == ERR_SEC_MISSING_ENTITLEMENT
}

#[cfg(not(target_vendor = "apple"))]
fn platform_set_secret(namespace: &str, key: &str, value: &str) -> Result<(), SecretError> {
    KeychainSecretStore::entry(KEYCHAIN_SERVICE, namespace, key)?
        .set_password(value)
        .map_err(|error| SecretError::backend(error.to_string()))
}

#[cfg(not(target_vendor = "apple"))]
fn platform_get_secret(
    service: &str,
    namespace: &str,
    key: &str,
) -> Result<Result<String, SecretLookupError>, SecretError> {
    match KeychainSecretStore::entry(service, namespace, key)?.get_password() {
        Ok(value) => Ok(Ok(value)),
        Err(keyring::Error::NoEntry) => Ok(Err(SecretLookupError::NoEntry)),
        Err(error) => Err(SecretError::backend(error.to_string())),
    }
}

#[cfg(not(target_vendor = "apple"))]
fn platform_delete_secret(service: &str, namespace: &str, key: &str) -> Result<(), SecretError> {
    match KeychainSecretStore::entry(service, namespace, key)?.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(SecretError::backend(error.to_string())),
    }
}

#[cfg(test)]
pub mod test_store {
    use super::{SecretError, SecretStore, SecretString};
    use std::{collections::BTreeMap, sync::Mutex};

    #[derive(Default)]
    pub struct MemorySecretStore {
        secrets: Mutex<BTreeMap<String, String>>,
    }

    impl MemorySecretStore {
        fn map_key(namespace: &str, key: &str) -> String {
            format!("{namespace}.{key}")
        }
    }

    impl SecretStore for MemorySecretStore {
        fn set_secret(
            &self,
            namespace: &str,
            key: &str,
            value: SecretString,
        ) -> Result<(), SecretError> {
            self.secrets
                .lock()
                .map_err(|error| SecretError::backend(error.to_string()))?
                .insert(Self::map_key(namespace, key), value.into_inner());
            Ok(())
        }

        fn get_secret(
            &self,
            namespace: &str,
            key: &str,
        ) -> Result<Option<SecretString>, SecretError> {
            Ok(self
                .secrets
                .lock()
                .map_err(|error| SecretError::backend(error.to_string()))?
                .get(&Self::map_key(namespace, key))
                .cloned()
                .map(SecretString::new))
        }

        fn delete_secret(&self, namespace: &str, key: &str) -> Result<(), SecretError> {
            self.secrets
                .lock()
                .map_err(|error| SecretError::backend(error.to_string()))?
                .remove(&Self::map_key(namespace, key));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{test_store::MemorySecretStore, SecretStore};
    use crate::secrets::types::SecretString;

    #[test]
    fn memory_store_sets_reads_and_deletes_secret() {
        let store = MemorySecretStore::default();
        assert!(store
            .get_secret("ai.anthropic", "api_key")
            .unwrap()
            .is_none());

        store
            .set_secret(
                "ai.anthropic",
                "api_key",
                SecretString::new("sk-test".to_string()),
            )
            .unwrap();
        assert_eq!(
            store
                .get_secret("ai.anthropic", "api_key")
                .unwrap()
                .unwrap()
                .expose_secret(),
            "sk-test"
        );

        store.delete_secret("ai.anthropic", "api_key").unwrap();
        assert!(store
            .get_secret("ai.anthropic", "api_key")
            .unwrap()
            .is_none());
    }
}
