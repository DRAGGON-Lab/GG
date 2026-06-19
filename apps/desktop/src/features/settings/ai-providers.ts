import { invoke } from "@tauri-apps/api/core";

import type { AiProviderCommandError } from "@/features/settings/settings.types";

export type AiProvider = "anthropic" | "google" | "openai" | "xai";

export type CredentialSource = "keychain" | "missing";

export type AiProviderKeyStatus = {
  provider: AiProvider;
  present: boolean;
  source: CredentialSource;
  keychainPresent: boolean;
  lastValidationAt: string | null;
  lastValidationError: string | null;
};

export type AiProviderMeta = {
  provider: AiProvider;
  label: string;
  /// Where the user creates a key, shown as a hint.
  consoleUrl: string;
  keyPlaceholder: string;
  /// Typical key length for this provider — the number of dots rendered when a
  /// key is stored (we never persist the real length, just mask a placeholder).
  maskedKeyLength: number;
};

export const AI_PROVIDERS: readonly AiProviderMeta[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    maskedKeyLength: 108,
  },
  {
    provider: "openai",
    label: "OpenAI",
    consoleUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    maskedKeyLength: 51,
  },
  {
    provider: "google",
    label: "Google Gemini",
    consoleUrl: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AIza…",
    maskedKeyLength: 39,
  },
  {
    provider: "xai",
    label: "xAI (Grok)",
    consoleUrl: "https://console.x.ai",
    keyPlaceholder: "xai-…",
    maskedKeyLength: 84,
  },
];

export function isAiProviderCommandError(
  value: unknown,
): value is AiProviderCommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

export function providerErrorMessage(error: unknown): string {
  if (isAiProviderCommandError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function listProviderKeyStatuses(): Promise<AiProviderKeyStatus[]> {
  return invoke<AiProviderKeyStatus[]>("ai_provider_key_statuses");
}

export function saveProviderKey(
  provider: AiProvider,
  key: string,
): Promise<AiProviderKeyStatus> {
  return invoke<AiProviderKeyStatus>("ai_provider_key_save", { provider, key });
}

export function validateProviderKey(
  provider: AiProvider,
): Promise<AiProviderKeyStatus> {
  return invoke<AiProviderKeyStatus>("ai_provider_key_validate", { provider });
}

export function deleteProviderKey(
  provider: AiProvider,
): Promise<AiProviderKeyStatus> {
  return invoke<AiProviderKeyStatus>("ai_provider_key_delete", { provider });
}
