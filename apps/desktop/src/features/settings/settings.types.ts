import {
  type ActivityRailItemId,
  DEFAULT_ACTIVITY_ORDER,
  DEFAULT_HIDDEN_ACTIVITY_ITEMS,
  includeDefaultHiddenActivityItems,
  normalizeActivityOrder,
  normalizeHiddenActivityItems,
} from "@/features/settings/activity-order";

export type TextEditorTheme = "matchApp" | "light" | "dark";
export type TextEditorKeymap = "default" | "vim";

export type TextEditorSettings = {
  fontFamily: string;
  fontSize: number;
  keymap: TextEditorKeymap;
  theme: TextEditorTheme;
};

/** Vestigial platform account settings, retained for settings compatibility.
 * Bio Eng Studio runs AI locally via provider API keys; see ai-providers.ts. */
export type PlatformSettings = {
  serverUrl: string;
  accountId: string | null;
  accountEmail: string | null;
  workspaceId: string | null;
  deviceId: string | null;
  utilityConversationId: string | null;
};

export type BackupSnapshotSettings = {
  id: string;
  createdAt: string;
  totalBytes: number;
  schemaVersion: number;
  attachmentCount: number;
};

export type BackupSettings = {
  localFolder: string | null;
  automaticBackupsEnabled: boolean;
  automaticIntervalMinutes: number;
  deviceId: string;
  deviceName: string;
  masterKeyCreatedAt: string | null;
  recoveryKeyExportedAt: string | null;
  lastAutomaticBackupAttemptedAt: string | null;
  lastBackup: BackupSnapshotSettings | null;
};

export type WorkspaceKind = "managed" | "external";

export type WorkspaceConfig = {
  id: string;
  name: string;
  root: string;
  kind: WorkspaceKind;
  /// `null` = not yet asked (external workspaces only). Managed workspaces are
  /// always `true`.
  historyEnabled: boolean | null;
  lastOpenedAt: string | null;
  lastPath: string | null;
};

export type WorkspaceSettings = {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceConfig[];
};

export type AiProviderErrorCode =
  | "credentialMissing"
  | "invalidKey"
  | "rateLimited"
  | "subscriptionRequired"
  | "networkUnavailable"
  | "providerError"
  | "secretStoreUnavailable";

export type AiProviderCommandError = {
  code: AiProviderErrorCode;
  message: string;
};

export type AppSettings = {
  activityOrder: ActivityRailItemId[];
  hiddenActivityItems: ActivityRailItemId[];
  platform: PlatformSettings;
  backup: BackupSettings;
  workspace: WorkspaceSettings;
  textEditor: TextEditorSettings;
};

export type TextEditorFontOption = {
  label: string;
  value: string;
};

export const TEXT_EDITOR_FONT_SIZE_MIN = 9;
export const TEXT_EDITOR_FONT_SIZE_MAX = 28;
export const TEXT_EDITOR_FONT_SIZE_STEP = 1;
export const DEFAULT_TEXT_EDITOR_FONT_SIZE = 13;
export const BACKUP_INTERVAL_MINUTES_MIN = 15;
export const BACKUP_INTERVAL_MINUTES_MAX = 7 * 24 * 60;
export const DEFAULT_BACKUP_INTERVAL_MINUTES = 60;
export const BUNDLED_MONO_FONT_FAMILY = "IBM Plex Mono";
export const TEXT_EDITOR_FONT_FALLBACK =
  "IBM Plex Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace";

export const textEditorThemeOptions = [
  { label: "Match Interface", value: "matchApp" },
  { label: "Bio Eng Studio Light", value: "light" },
  { label: "Bio Eng Studio Dark", value: "dark" },
] as const satisfies readonly {
  label: string;
  value: TextEditorTheme;
}[];

export const textEditorKeymapOptions = [
  { label: "Default", value: "default" },
  { label: "Vim", value: "vim" },
] as const satisfies readonly {
  label: string;
  value: TextEditorKeymap;
}[];

export const textEditorFontOptions = [
  {
    label: "IBM Plex Mono",
    value: TEXT_EDITOR_FONT_FALLBACK,
  },
  {
    label: "SF Mono",
    value: "SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace",
  },
  {
    label: "Menlo",
    value: "Menlo, Monaco, Consolas, Liberation Mono, monospace",
  },
  {
    label: "JetBrains Mono",
    value:
      "JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, monospace",
  },
  {
    label: "Fira Code",
    value: "Fira Code, SFMono-Regular, Consolas, Liberation Mono, monospace",
  },
  {
    label: "Source Code Pro",
    value:
      "Source Code Pro, SFMono-Regular, Consolas, Liberation Mono, monospace",
  },
  {
    label: "Iosevka",
    value: "Iosevka, SFMono-Regular, Consolas, Liberation Mono, monospace",
  },
] as const satisfies readonly TextEditorFontOption[];

export const defaultTextEditorSettings: TextEditorSettings = {
  fontFamily: textEditorFontOptions[0].value,
  fontSize: DEFAULT_TEXT_EDITOR_FONT_SIZE,
  keymap: "default",
  theme: "matchApp",
};

export const DEFAULT_PLATFORM_SERVER_URL = "https://api.bioeng.build";

export const defaultPlatformSettings: PlatformSettings = {
  serverUrl: DEFAULT_PLATFORM_SERVER_URL,
  accountId: null,
  accountEmail: null,
  workspaceId: null,
  deviceId: null,
  utilityConversationId: null,
};

export const defaultBackupSettings: BackupSettings = {
  localFolder: null,
  automaticBackupsEnabled: true,
  automaticIntervalMinutes: DEFAULT_BACKUP_INTERVAL_MINUTES,
  deviceId: "",
  deviceName: "",
  masterKeyCreatedAt: null,
  recoveryKeyExportedAt: null,
  lastAutomaticBackupAttemptedAt: null,
  lastBackup: null,
};

export const defaultWorkspaceSettings: WorkspaceSettings = {
  activeWorkspaceId: null,
  workspaces: [],
};

export const defaultAppSettings: AppSettings = {
  activityOrder: [...DEFAULT_ACTIVITY_ORDER],
  hiddenActivityItems: [...DEFAULT_HIDDEN_ACTIVITY_ITEMS],
  platform: defaultPlatformSettings,
  backup: defaultBackupSettings,
  workspace: defaultWorkspaceSettings,
  textEditor: defaultTextEditorSettings,
};

export function isTextEditorTheme(value: unknown): value is TextEditorTheme {
  return value === "matchApp" || value === "light" || value === "dark";
}

export function isTextEditorKeymap(value: unknown): value is TextEditorKeymap {
  return value === "default" || value === "vim";
}

export function normalizeTextEditorFontSize(value: unknown) {
  const fontSize = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(fontSize)) {
    return DEFAULT_TEXT_EDITOR_FONT_SIZE;
  }

  return Math.min(
    TEXT_EDITOR_FONT_SIZE_MAX,
    Math.max(TEXT_EDITOR_FONT_SIZE_MIN, Math.round(fontSize)),
  );
}

export function normalizePlatformSettings(value: unknown): PlatformSettings {
  if (!value || typeof value !== "object") {
    return defaultPlatformSettings;
  }

  const candidate = value as Partial<PlatformSettings>;
  const serverUrl = nonEmptyString(candidate.serverUrl);

  return {
    serverUrl: serverUrl
      ? serverUrl.replace(/\/+$/, "")
      : DEFAULT_PLATFORM_SERVER_URL,
    accountId: nonEmptyString(candidate.accountId),
    accountEmail: nonEmptyString(candidate.accountEmail),
    workspaceId: nonEmptyString(candidate.workspaceId),
    deviceId: nonEmptyString(candidate.deviceId),
    utilityConversationId: nonEmptyString(candidate.utilityConversationId),
  };
}

export function normalizeBackupSettings(value: unknown): BackupSettings {
  if (!value || typeof value !== "object") {
    return defaultBackupSettings;
  }

  const candidate = value as Partial<BackupSettings>;
  return {
    localFolder: nonEmptyString(candidate.localFolder),
    automaticBackupsEnabled:
      candidate.automaticBackupsEnabled ??
      defaultBackupSettings.automaticBackupsEnabled,
    automaticIntervalMinutes: normalizeBackupIntervalMinutes(
      candidate.automaticIntervalMinutes,
    ),
    deviceId: nonEmptyString(candidate.deviceId) ?? "",
    deviceName: nonEmptyString(candidate.deviceName) ?? "",
    masterKeyCreatedAt: nonEmptyString(candidate.masterKeyCreatedAt),
    recoveryKeyExportedAt: nonEmptyString(candidate.recoveryKeyExportedAt),
    lastAutomaticBackupAttemptedAt: nonEmptyString(
      candidate.lastAutomaticBackupAttemptedAt,
    ),
    lastBackup: normalizeBackupSnapshotSettings(candidate.lastBackup),
  };
}

export function normalizeBackupIntervalMinutes(value: unknown) {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(minutes)) {
    return DEFAULT_BACKUP_INTERVAL_MINUTES;
  }

  return Math.min(
    BACKUP_INTERVAL_MINUTES_MAX,
    Math.max(BACKUP_INTERVAL_MINUTES_MIN, Math.round(minutes)),
  );
}

function normalizeBackupSnapshotSettings(
  value: unknown,
): BackupSnapshotSettings | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BackupSnapshotSettings>;
  const id = nonEmptyString(candidate.id);
  const createdAt = nonEmptyString(candidate.createdAt);
  const totalBytes = normalizeNonNegativeNumber(candidate.totalBytes);
  const schemaVersion = normalizeNonNegativeNumber(candidate.schemaVersion);
  const attachmentCount = normalizeNonNegativeNumber(candidate.attachmentCount);

  if (!id || !createdAt) {
    return null;
  }

  return {
    id,
    createdAt,
    totalBytes,
    schemaVersion,
    attachmentCount,
  };
}

export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== "object") {
    return defaultWorkspaceSettings;
  }

  const candidate = value as Partial<WorkspaceSettings>;
  const workspaces = Array.isArray(candidate.workspaces)
    ? normalizeWorkspaceList(candidate.workspaces)
    : [];
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const activeWorkspaceId = nonEmptyString(candidate.activeWorkspaceId);

  return {
    activeWorkspaceId:
      activeWorkspaceId && workspaceIds.has(activeWorkspaceId)
        ? activeWorkspaceId
        : null,
    workspaces,
  };
}

function normalizeWorkspaceList(values: unknown[]) {
  const workspaces: WorkspaceConfig[] = [];
  const workspaceIds = new Set<string>();

  for (const value of values) {
    const workspace = normalizeWorkspaceEntry(value);

    if (workspace && !workspaceIds.has(workspace.id)) {
      workspaceIds.add(workspace.id);
      workspaces.push(workspace);
    }
  }

  return workspaces;
}

function normalizeWorkspaceEntry(value: unknown): WorkspaceConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<WorkspaceConfig>;
  const id = nonEmptyString(candidate.id);
  const root = nonEmptyString(candidate.root);

  if (!id || !root) {
    return null;
  }

  const kind: WorkspaceKind =
    candidate.kind === "managed" ? "managed" : "external";
  // Managed workspaces always keep history; mirror the Rust normalization.
  const historyEnabled =
    kind === "managed"
      ? true
      : typeof candidate.historyEnabled === "boolean"
        ? candidate.historyEnabled
        : null;

  return {
    id,
    name: nonEmptyString(candidate.name) ?? workspaceNameFromRoot(root),
    root,
    kind,
    historyEnabled,
    lastOpenedAt: nonEmptyString(candidate.lastOpenedAt),
    lastPath: nonEmptyString(candidate.lastPath),
  };
}

function workspaceNameFromRoot(root: string) {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

function normalizeNonNegativeNumber(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.round(numericValue));
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") {
    return defaultAppSettings;
  }

  const candidate = value as Partial<AppSettings>;
  const existingActivityOrderIncludesDefaultHiddenItems =
    Array.isArray(candidate.activityOrder) &&
    DEFAULT_HIDDEN_ACTIVITY_ITEMS.every((itemId) =>
      candidate.activityOrder?.includes(itemId),
    );
  const hiddenActivityItems = normalizeHiddenActivityItems(
    candidate.hiddenActivityItems,
  );
  const textEditor =
    candidate.textEditor && typeof candidate.textEditor === "object"
      ? (candidate.textEditor as Partial<TextEditorSettings>)
      : {};
  const fontFamily =
    typeof textEditor.fontFamily === "string" &&
    textEditor.fontFamily.trim().length > 0
      ? textEditor.fontFamily
      : defaultTextEditorSettings.fontFamily;
  return {
    activityOrder: normalizeActivityOrder(candidate.activityOrder),
    hiddenActivityItems: existingActivityOrderIncludesDefaultHiddenItems
      ? hiddenActivityItems
      : includeDefaultHiddenActivityItems(hiddenActivityItems),
    platform: normalizePlatformSettings(candidate.platform),
    backup: normalizeBackupSettings(candidate.backup),
    workspace: normalizeWorkspaceSettings(candidate.workspace),
    textEditor: {
      fontFamily,
      fontSize: normalizeTextEditorFontSize(textEditor.fontSize),
      keymap: isTextEditorKeymap(textEditor.keymap)
        ? textEditor.keymap
        : defaultTextEditorSettings.keymap,
      theme: isTextEditorTheme(textEditor.theme)
        ? textEditor.theme
        : defaultTextEditorSettings.theme,
    },
  };
}
