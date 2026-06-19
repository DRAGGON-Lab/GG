use bioeng_agent::{AgentClient, Credential};
use tauri::State;

use super::{
    store::SecretStore,
    types::{
        AiProvider, AiProviderCommandError, AiProviderKeyStatus, SecretHandle, SecretStatus,
        SecretString,
    },
    KeychainSecretStore,
};
use crate::agent::config;

#[tauri::command]
pub fn secret_status(
    secret_store: State<'_, KeychainSecretStore>,
    handle: SecretHandle,
) -> Result<SecretStatus, AiProviderCommandError> {
    let present = secret_store
        .get_secret(handle.namespace(), handle.key())
        .map_err(AiProviderCommandError::secret_store)?
        .is_some();
    Ok(SecretStatus { handle, present })
}

#[tauri::command]
pub fn secret_delete(
    secret_store: State<'_, KeychainSecretStore>,
    handle: SecretHandle,
) -> Result<SecretStatus, AiProviderCommandError> {
    secret_store
        .delete_secret(handle.namespace(), handle.key())
        .map_err(AiProviderCommandError::secret_store)?;
    Ok(SecretStatus {
        handle,
        present: false,
    })
}

#[tauri::command]
pub fn ai_provider_key_save(
    secret_store: State<'_, KeychainSecretStore>,
    provider: AiProvider,
    key: String,
) -> Result<AiProviderKeyStatus, AiProviderCommandError> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(AiProviderCommandError::credential_missing_for(provider));
    }

    let handle = key_handle(provider);
    secret_store
        .set_secret(handle.namespace(), handle.key(), SecretString::new(key))
        .map_err(AiProviderCommandError::secret_store)?;
    config::credential_status(&*secret_store, provider)
}

#[tauri::command]
pub fn ai_provider_key_status(
    secret_store: State<'_, KeychainSecretStore>,
    provider: AiProvider,
) -> Result<AiProviderKeyStatus, AiProviderCommandError> {
    config::credential_status(&*secret_store, provider)
}

#[tauri::command]
pub fn ai_provider_key_statuses(
    secret_store: State<'_, KeychainSecretStore>,
) -> Result<Vec<AiProviderKeyStatus>, AiProviderCommandError> {
    AiProvider::all()
        .iter()
        .copied()
        .map(|provider| config::credential_status(&*secret_store, provider))
        .collect()
}

#[tauri::command]
pub async fn ai_provider_key_validate(
    secret_store: State<'_, KeychainSecretStore>,
    provider: AiProvider,
) -> Result<AiProviderKeyStatus, AiProviderCommandError> {
    match provider {
        AiProvider::Anthropic => {
            let credential = config::resolve_credential(&*secret_store)?;
            validate_anthropic_credential(credential).await?;
        }
        AiProvider::Google => {
            let key = config::resolve_provider_api_key(&*secret_store, provider)?;
            validate_google_credential(key).await?;
        }
        AiProvider::OpenAi => {
            let key = config::resolve_provider_api_key(&*secret_store, provider)?;
            validate_openai_credential(key).await?;
        }
        AiProvider::XAi => {
            let key = config::resolve_provider_api_key(&*secret_store, provider)?;
            validate_xai_credential(key).await?;
        }
    }

    config::credential_status(&*secret_store, provider)
}

#[tauri::command]
pub fn ai_provider_key_delete(
    secret_store: State<'_, KeychainSecretStore>,
    provider: AiProvider,
) -> Result<AiProviderKeyStatus, AiProviderCommandError> {
    let handle = key_handle(provider);
    secret_store
        .delete_secret(handle.namespace(), handle.key())
        .map_err(AiProviderCommandError::secret_store)?;
    config::credential_status(&*secret_store, provider)
}

pub fn key_handle(provider: AiProvider) -> SecretHandle {
    match provider {
        AiProvider::Anthropic => SecretHandle::AnthropicApiKey,
        AiProvider::Google => SecretHandle::GoogleApiKey,
        AiProvider::OpenAi => SecretHandle::OpenAiApiKey,
        AiProvider::XAi => SecretHandle::XAiApiKey,
    }
}

async fn validate_anthropic_credential(
    credential: Credential,
) -> Result<(), AiProviderCommandError> {
    AgentClient::new(credential)
        .map_err(AiProviderCommandError::provider_error)?
        .validate_models_access()
        .await
        .map_err(AiProviderCommandError::provider_error)
}

async fn validate_openai_credential(key: String) -> Result<(), AiProviderCommandError> {
    let response = reqwest::Client::new()
        .get("https://api.openai.com/v1/models?limit=1")
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| {
            AiProviderCommandError::provider_error_for(AiProvider::OpenAi, error.to_string())
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(AiProviderCommandError::provider_error_for(
            AiProvider::OpenAi,
            format!("OpenAI API error {status}: {text}"),
        ));
    }
    Ok(())
}

async fn validate_google_credential(key: String) -> Result<(), AiProviderCommandError> {
    let response = reqwest::Client::new()
        .get("https://generativelanguage.googleapis.com/v1beta/models")
        .header("x-goog-api-key", key)
        .send()
        .await
        .map_err(|error| {
            AiProviderCommandError::provider_error_for(AiProvider::Google, error.to_string())
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(AiProviderCommandError::provider_error_for(
            AiProvider::Google,
            format!("Google Gemini API error {status}: {text}"),
        ));
    }
    Ok(())
}

async fn validate_xai_credential(key: String) -> Result<(), AiProviderCommandError> {
    let response = reqwest::Client::new()
        .get("https://api.x.ai/v1/models")
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| {
            AiProviderCommandError::provider_error_for(AiProvider::XAi, error.to_string())
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(AiProviderCommandError::provider_error_for(
            AiProvider::XAi,
            format!("xAI API error {status}: {text}"),
        ));
    }
    Ok(())
}
