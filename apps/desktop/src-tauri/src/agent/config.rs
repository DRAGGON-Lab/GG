//! Local AI credential resolution: API keys live in the OS keychain, saved from the
//! Settings panel. The agent loop and utility calls resolve a [`Credential`] here.

use bioeng_agent::Credential;

use crate::secrets::{
    commands::key_handle,
    store::SecretStore,
    types::{AiProvider, AiProviderCommandError, AiProviderKeyStatus, CredentialSource},
};

/// Resolve the active Anthropic credential from the OS keychain entry saved from Settings.
pub fn resolve_credential(
    secret_store: &impl SecretStore,
) -> Result<Credential, AiProviderCommandError> {
    resolve_provider_api_key(secret_store, AiProvider::Anthropic).map(Credential::ApiKey)
}

pub fn resolve_provider_api_key(
    secret_store: &impl SecretStore,
    provider: AiProvider,
) -> Result<String, AiProviderCommandError> {
    let handle = key_handle(provider);
    if let Some(key) = secret_store
        .get_secret(handle.namespace(), handle.key())
        .map_err(AiProviderCommandError::secret_store)?
    {
        let key = key.expose_secret().trim().to_string();
        if !key.is_empty() {
            return Ok(key);
        }
    }

    Err(AiProviderCommandError::credential_missing_for(provider))
}

/// Presence of a provider key is the source of truth for status: the keychain entry
/// either exists (and is non-empty) or it does not.
pub fn credential_status(
    secret_store: &impl SecretStore,
    provider: AiProvider,
) -> Result<AiProviderKeyStatus, AiProviderCommandError> {
    let handle = key_handle(provider);
    let present = secret_store
        .get_secret(handle.namespace(), handle.key())
        .map_err(AiProviderCommandError::secret_store)?
        .map(|key| !key.expose_secret().trim().is_empty())
        .unwrap_or(false);

    let source = if present {
        CredentialSource::Keychain
    } else {
        CredentialSource::Missing
    };

    Ok(AiProviderKeyStatus {
        provider,
        present,
        source,
        keychain_present: present,
        last_validation_at: None,
        last_validation_error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::resolve_credential;
    use crate::secrets::{
        store::{test_store::MemorySecretStore, SecretStore},
        types::{AiProviderErrorCode, SecretString},
    };

    #[test]
    fn resolver_uses_keychain() {
        let store = MemorySecretStore::default();
        store
            .set_secret(
                "ai.anthropic",
                "api_key",
                SecretString::new("sk-keychain".to_string()),
            )
            .unwrap();

        let credential = resolve_credential(&store).unwrap();
        assert!(
            matches!(credential, bioeng_agent::Credential::ApiKey(key) if key == "sk-keychain")
        );
    }

    #[test]
    fn resolver_errors_when_keychain_key_is_missing() {
        let store = MemorySecretStore::default();
        let error = match resolve_credential(&store) {
            Ok(_) => panic!("missing keychain key should not resolve"),
            Err(error) => error,
        };

        assert_eq!(error.code, AiProviderErrorCode::CredentialMissing);
    }
}
