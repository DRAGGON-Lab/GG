import * as React from "react";

import type { ActivityRailItemId } from "@/features/settings/activity-order";
import type {
  AppSettings,
  BackupSettings,
  PlatformSettings,
  TextEditorFontOption,
  TextEditorSettings,
  WorkspaceSettings,
} from "@/features/settings/settings.types";

export type AppSettingsContextValue = {
  error: string | null;
  fontOptions: readonly TextEditorFontOption[];
  fontsError: string | null;
  fontsLoading: boolean;
  loading: boolean;
  refreshFontOptions: () => void;
  refreshSettings: () => void;
  saving: boolean;
  settings: AppSettings;
  setActivityRailSettings: (settings: {
    activityOrder?: readonly ActivityRailItemId[];
    hiddenActivityItems?: readonly ActivityRailItemId[];
  }) => void;
  setBackupSettings: (settings: Partial<BackupSettings>) => void;
  setWorkspaceSettings: (settings: WorkspaceSettings) => void;
  setPlatformSettings: (settings: Partial<PlatformSettings>) => void;
  setTextEditorSettings: (settings: Partial<TextEditorSettings>) => void;
};

export const AppSettingsContext =
  React.createContext<AppSettingsContextValue | null>(null);

export function useAppSettings() {
  const context = React.useContext(AppSettingsContext);

  if (!context) {
    throw new Error("useAppSettings must be used within AppSettingsProvider");
  }

  return context;
}
