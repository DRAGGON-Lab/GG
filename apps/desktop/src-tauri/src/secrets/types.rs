use serde::{Deserialize, Serialize};
use std::{
    fmt,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn expose_secret(&self) -> &str {
        &self.0
    }

    #[cfg(test)]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretString(REDACTED)")
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SecretHandle {
    AnthropicApiKey,
    GoogleApiKey,
    OpenAiApiKey,
    XAiApiKey,
    BackupMasterKey,
    BackupRecoveryKeyStatus,
    DropboxRefreshToken,
    GoogleRefreshToken,
    S3SecretAccessKey,
    PlatformRefreshToken,
}

impl SecretHandle {
    pub fn namespace(self) -> &'static str {
        match self {
            Self::AnthropicApiKey => "ai.anthropic",
            Self::GoogleApiKey => "ai.google",
            Self::OpenAiApiKey => "ai.openai",
            Self::XAiApiKey => "ai.xai",
            Self::BackupMasterKey => "backup",
            Self::BackupRecoveryKeyStatus => "backup",
            Self::DropboxRefreshToken => "backup.dropbox",
            Self::GoogleRefreshToken => "backup.google",
            Self::S3SecretAccessKey => "backup.s3",
            Self::PlatformRefreshToken => "platform.auth",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::AnthropicApiKey => "api_key",
            Self::GoogleApiKey => "api_key",
            Self::OpenAiApiKey => "api_key",
            Self::XAiApiKey => "api_key",
            Self::BackupMasterKey => "master_key",
            Self::BackupRecoveryKeyStatus => "recovery_key_status",
            Self::DropboxRefreshToken => "refresh_token",
            Self::GoogleRefreshToken => "refresh_token",
            Self::S3SecretAccessKey => "secret_access_key",
            Self::PlatformRefreshToken => "refresh_token",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub handle: SecretHandle,
    pub present: bool,
}

#[derive(Clone, Debug)]
pub struct SecretError {
    message: String,
}

impl SecretError {
    pub fn backend(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for SecretError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SecretError {}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    #[default]
    Anthropic,
    Google,
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "xai")]
    XAi,
}

#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CredentialSource {
    Keychain,
    Missing,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderKeyStatus {
    pub provider: AiProvider,
    pub present: bool,
    pub source: CredentialSource,
    pub keychain_present: bool,
    pub last_validation_at: Option<String>,
    pub last_validation_error: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderErrorCode {
    CredentialMissing,
    InvalidKey,
    RateLimited,
    NetworkUnavailable,
    ProviderError,
    SecretStoreUnavailable,
}

impl AiProviderErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CredentialMissing => "credentialMissing",
            Self::InvalidKey => "invalidKey",
            Self::RateLimited => "rateLimited",
            Self::NetworkUnavailable => "networkUnavailable",
            Self::ProviderError => "providerError",
            Self::SecretStoreUnavailable => "secretStoreUnavailable",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCommandError {
    pub code: AiProviderErrorCode,
    pub message: String,
}

impl AiProviderCommandError {
    pub fn credential_missing_for(provider: AiProvider) -> Self {
        Self {
            code: AiProviderErrorCode::CredentialMissing,
            message: format!(
                "Add an API key for {} in Settings to use AI features.",
                provider.label()
            ),
        }
    }

    pub fn secret_store(error: SecretError) -> Self {
        Self {
            code: AiProviderErrorCode::SecretStoreUnavailable,
            message: format!("Could not access the OS keychain: {}", error.message()),
        }
    }

    pub fn provider_error(error: impl Into<String>) -> Self {
        Self::provider_error_for(AiProvider::Anthropic, error)
    }

    pub fn provider_error_for(provider: AiProvider, error: impl Into<String>) -> Self {
        let message = error.into();
        let normalized = message.to_lowercase();
        let code = if normalized.contains("401")
            || normalized.contains("403")
            || normalized.contains("authentication_error")
            || normalized.contains("invalid x-api-key")
            || normalized.contains("invalid api key")
            || normalized.contains("api key not valid")
            || normalized.contains("permission_denied")
        {
            AiProviderErrorCode::InvalidKey
        } else if normalized.contains("429")
            || normalized.contains("rate_limit")
            || normalized.contains("rate limit")
            || normalized.contains("quota")
        {
            AiProviderErrorCode::RateLimited
        } else if normalized.contains("error sending request")
            || normalized.contains("network")
            || normalized.contains("dns")
            || normalized.contains("connection")
            || normalized.contains("timed out")
            || normalized.contains("timeout")
        {
            AiProviderErrorCode::NetworkUnavailable
        } else {
            AiProviderErrorCode::ProviderError
        };

        Self {
            code,
            message: user_facing_provider_message(provider, code, &message),
        }
    }

    pub fn generic(error: impl Into<String>) -> Self {
        Self {
            code: AiProviderErrorCode::ProviderError,
            message: error.into(),
        }
    }
}

impl From<String> for AiProviderCommandError {
    fn from(error: String) -> Self {
        Self::generic(error)
    }
}

impl From<&str> for AiProviderCommandError {
    fn from(error: &str) -> Self {
        Self::generic(error)
    }
}

impl AiProvider {
    pub fn all() -> &'static [AiProvider] {
        &[
            AiProvider::Anthropic,
            AiProvider::Google,
            AiProvider::OpenAi,
            AiProvider::XAi,
        ]
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Anthropic => "Anthropic",
            Self::Google => "Google Gemini",
            Self::OpenAi => "OpenAI",
            Self::XAi => "xAI",
        }
    }
}

fn user_facing_provider_message(
    provider: AiProvider,
    code: AiProviderErrorCode,
    original: &str,
) -> String {
    let provider_label = provider.label();
    match code {
        AiProviderErrorCode::InvalidKey => {
            format!("The {provider_label} API key was rejected. Check the key in Settings.")
        }
        AiProviderErrorCode::RateLimited => {
            format!(
                "{provider_label} reported a quota or rate-limit error. Try again later or check the account."
            )
        }
        AiProviderErrorCode::NetworkUnavailable => {
            format!(
                "Bio Eng Studio could not reach {provider_label}. Check the network connection and try again."
            )
        }
        AiProviderErrorCode::ProviderError => original.to_string(),
        AiProviderErrorCode::CredentialMissing | AiProviderErrorCode::SecretStoreUnavailable => {
            original.to_string()
        }
    }
}

pub fn current_timestamp_millis_string() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    millis.to_string()
}
