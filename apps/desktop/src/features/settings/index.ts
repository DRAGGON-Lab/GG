export { AppSettingsProvider } from "@/features/settings/AppSettingsProvider";
export { useAppSettings } from "@/features/settings/use-app-settings";
export {
  DEFAULT_ACTIVITY_ORDER,
  DEFAULT_HIDDEN_ACTIVITY_ITEMS,
  includeDefaultHiddenActivityItems,
  normalizeActivityOrder,
  normalizeHiddenActivityItems,
} from "@/features/settings/activity-order";
export {
  defaultAppSettings,
  defaultBackupSettings,
  defaultWorkspaceSettings,
  defaultPlatformSettings,
  defaultTextEditorSettings,
  BACKUP_INTERVAL_MINUTES_MAX,
  BACKUP_INTERVAL_MINUTES_MIN,
  DEFAULT_BACKUP_INTERVAL_MINUTES,
  DEFAULT_PLATFORM_SERVER_URL,
  normalizeAppSettings,
  normalizeBackupIntervalMinutes,
  normalizeWorkspaceSettings,
  normalizePlatformSettings,
  normalizeTextEditorFontSize,
  TEXT_EDITOR_FONT_FALLBACK,
  TEXT_EDITOR_FONT_SIZE_MAX,
  TEXT_EDITOR_FONT_SIZE_MIN,
  TEXT_EDITOR_FONT_SIZE_STEP,
  textEditorFontOptions,
  textEditorKeymapOptions,
  textEditorThemeOptions,
} from "@/features/settings/settings.types";
export type { ActivityRailItemId } from "@/features/settings/activity-order";
export type {
  AiProviderCommandError,
  AiProviderErrorCode,
  AppSettings,
  BackupSettings,
  BackupSnapshotSettings,
  WorkspaceSettings,
  WorkspaceKind,
  WorkspaceConfig,
  PlatformSettings,
  TextEditorFontOption,
  TextEditorKeymap,
  TextEditorSettings,
  TextEditorTheme,
} from "@/features/settings/settings.types";
