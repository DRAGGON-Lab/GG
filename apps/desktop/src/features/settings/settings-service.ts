import { invoke } from "@tauri-apps/api/core";

import {
  type AiProviderCommandError,
  type AppSettings,
  BUNDLED_MONO_FONT_FAMILY,
  defaultAppSettings,
  normalizeAppSettings,
  TEXT_EDITOR_FONT_FALLBACK,
  type TextEditorFontOption,
  textEditorFontOptions,
} from "@/features/settings/settings.types";

const browserFallbackKey = "bioeng.settings";
const bundledMonoOption: TextEditorFontOption = {
  label: BUNDLED_MONO_FONT_FAMILY,
  value: TEXT_EDITOR_FONT_FALLBACK,
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readBrowserFallbackSettings() {
  if (typeof window === "undefined") {
    return defaultAppSettings;
  }

  try {
    const rawSettings = window.localStorage.getItem(browserFallbackKey);
    return normalizeAppSettings(
      rawSettings ? JSON.parse(rawSettings) : defaultAppSettings,
    );
  } catch {
    return defaultAppSettings;
  }
}

function writeBrowserFallbackSettings(settings: AppSettings) {
  try {
    window.localStorage.setItem(browserFallbackKey, JSON.stringify(settings));
  } catch {
    // Browser-only fallback; Tauri builds use Rust-backed storage.
  }
}

function quoteCssFontFamily(family: string) {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function toTextEditorFontOption(family: string): TextEditorFontOption {
  return {
    label: family,
    value: `${quoteCssFontFamily(family)}, ${TEXT_EDITOR_FONT_FALLBACK}`,
  };
}

export async function loadAppSettings() {
  if (!isTauriRuntime()) {
    return readBrowserFallbackSettings();
  }

  return normalizeAppSettings(await invoke<AppSettings>("settings_get"));
}

export async function loadTextEditorFontOptions() {
  if (!isTauriRuntime()) {
    return textEditorFontOptions;
  }

  const families = await invoke<string[]>("settings_list_monospace_fonts");
  const options = families
    .map((family) => family.trim())
    .filter(
      (family, index, allFamilies) =>
        family.length > 0 && allFamilies.indexOf(family) === index,
    )
    .map(toTextEditorFontOption);

  const installedOptions = options.length > 0 ? options : textEditorFontOptions;
  return [
    bundledMonoOption,
    ...installedOptions.filter(
      (option) =>
        option.label !== bundledMonoOption.label &&
        option.value !== bundledMonoOption.value,
    ),
  ];
}

export async function saveAppSettings(settings: AppSettings) {
  const normalizedSettings = normalizeAppSettings(settings);

  if (!isTauriRuntime()) {
    writeBrowserFallbackSettings(normalizedSettings);
    return normalizedSettings;
  }

  return normalizeAppSettings(
    await invoke<AppSettings>("settings_save", {
      settings: normalizedSettings,
    }),
  );
}

export function parseAiProviderCommandError(
  error: unknown,
): AiProviderCommandError {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const candidate = error as Partial<AiProviderCommandError>;
    return {
      code: isAiProviderErrorCode(candidate.code)
        ? candidate.code
        : "providerError",
      message: candidate.message ?? "AI provider error.",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: inferAiProviderErrorCode(message),
    message,
  };
}

function isAiProviderErrorCode(
  value: unknown,
): value is AiProviderCommandError["code"] {
  return (
    value === "credentialMissing" ||
    value === "invalidKey" ||
    value === "rateLimited" ||
    value === "subscriptionRequired" ||
    value === "networkUnavailable" ||
    value === "providerError" ||
    value === "secretStoreUnavailable"
  );
}

function inferAiProviderErrorCode(
  message: string,
): AiProviderCommandError["code"] {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("anthropic_api_key") ||
    normalized.includes("api key in settings") ||
    normalized.includes("credential")
  ) {
    return "credentialMissing";
  }
  // Before the "invalid" substring check, which would misclassify the
  // platform's billing errors.
  if (
    normalized.includes("subscriptionrequired") ||
    normalized.includes("402 payment required")
  ) {
    return "subscriptionRequired";
  }
  if (normalized.includes("401") || normalized.includes("invalid")) {
    return "invalidKey";
  }
  if (normalized.includes("429") || normalized.includes("rate")) {
    return "rateLimited";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("connection") ||
    normalized.includes("dns") ||
    normalized.includes("timeout")
  ) {
    return "networkUnavailable";
  }
  return "providerError";
}
