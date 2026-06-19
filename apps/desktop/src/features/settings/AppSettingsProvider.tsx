import * as React from "react";

import type { ActivityRailItemId } from "@/features/settings/activity-order";
import {
  loadAppSettings,
  loadTextEditorFontOptions,
  saveAppSettings,
} from "@/features/settings/settings-service";
import {
  type AppSettings,
  type BackupSettings,
  defaultAppSettings,
  normalizeAppSettings,
  type PlatformSettings,
  type TextEditorFontOption,
  textEditorFontOptions,
  type TextEditorSettings,
  type WorkspaceSettings,
} from "@/features/settings/settings.types";
import { AppSettingsContext } from "@/features/settings/use-app-settings";

type AppSettingsProviderProps = {
  children: React.ReactNode;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function AppSettingsProvider({ children }: AppSettingsProviderProps) {
  const [settings, setSettings] =
    React.useState<AppSettings>(defaultAppSettings);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [fontOptions, setFontOptions] = React.useState<
    readonly TextEditorFontOption[]
  >(textEditorFontOptions);
  const [fontsLoading, setFontsLoading] = React.useState(true);
  const [fontsError, setFontsError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const latestSettingsRef = React.useRef(defaultAppSettings);
  const saveRequestIdRef = React.useRef(0);

  const persistSettings = React.useCallback((nextSettings: AppSettings) => {
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    setSaving(true);
    setError(null);

    void saveAppSettings(nextSettings)
      .then((savedSettings) => {
        if (requestId !== saveRequestIdRef.current) {
          return;
        }

        latestSettingsRef.current = savedSettings;
        setSettings(savedSettings);
      })
      .catch((saveError: unknown) => {
        if (requestId === saveRequestIdRef.current) {
          setError(getErrorMessage(saveError));
        }
      })
      .finally(() => {
        if (requestId === saveRequestIdRef.current) {
          setSaving(false);
        }
      });
  }, []);

  const commitSettings = React.useCallback(
    (nextSettingsInput: unknown) => {
      const nextSettings = normalizeAppSettings(nextSettingsInput);

      latestSettingsRef.current = nextSettings;
      setSettings(nextSettings);
      persistSettings(nextSettings);
    },
    [persistSettings],
  );

  const setActivityRailSettings = React.useCallback(
    ({
      activityOrder,
      hiddenActivityItems,
    }: {
      activityOrder?: readonly ActivityRailItemId[];
      hiddenActivityItems?: readonly ActivityRailItemId[];
    }) => {
      commitSettings({
        ...latestSettingsRef.current,
        ...(activityOrder ? { activityOrder } : null),
        ...(hiddenActivityItems ? { hiddenActivityItems } : null),
      });
    },
    [commitSettings],
  );

  const setTextEditorSettings = React.useCallback(
    (nextTextEditorSettings: Partial<TextEditorSettings>) => {
      commitSettings({
        ...latestSettingsRef.current,
        textEditor: {
          ...latestSettingsRef.current.textEditor,
          ...nextTextEditorSettings,
        },
      });
    },
    [commitSettings],
  );

  const setBackupSettings = React.useCallback(
    (nextBackupSettings: Partial<BackupSettings>) => {
      commitSettings({
        ...latestSettingsRef.current,
        backup: {
          ...latestSettingsRef.current.backup,
          ...nextBackupSettings,
        },
      });
    },
    [commitSettings],
  );

  const setWorkspaceSettings = React.useCallback(
    (nextWorkspaceSettings: WorkspaceSettings) => {
      commitSettings({
        ...latestSettingsRef.current,
        workspace: nextWorkspaceSettings,
      });
    },
    [commitSettings],
  );

  const setPlatformSettings = React.useCallback(
    (nextPlatformSettings: Partial<PlatformSettings>) => {
      commitSettings({
        ...latestSettingsRef.current,
        platform: {
          ...latestSettingsRef.current.platform,
          ...nextPlatformSettings,
        },
      });
    },
    [commitSettings],
  );

  const refreshSettings = React.useCallback(() => {
    setLoading(true);
    void loadAppSettings()
      .then((loadedSettings) => {
        latestSettingsRef.current = loadedSettings;
        setSettings(loadedSettings);
        setError(null);
      })
      .catch((loadError: unknown) => {
        setError(getErrorMessage(loadError));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const refreshFontOptions = React.useCallback(() => {
    setFontsLoading(true);
    setFontsError(null);

    void loadTextEditorFontOptions()
      .then((loadedFontOptions) => {
        setFontOptions(loadedFontOptions);
      })
      .catch((fontError: unknown) => {
        setFontsError(getErrorMessage(fontError));
      })
      .finally(() => {
        setFontsLoading(false);
      });
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    void loadAppSettings()
      .then((loadedSettings) => {
        if (cancelled) {
          return;
        }

        latestSettingsRef.current = loadedSettings;
        setSettings(loadedSettings);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    void loadTextEditorFontOptions()
      .then((loadedFontOptions) => {
        if (!cancelled) {
          setFontOptions(loadedFontOptions);
        }
      })
      .catch((fontError: unknown) => {
        if (!cancelled) {
          setFontsError(getErrorMessage(fontError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFontsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = React.useMemo(
    () => ({
      error,
      fontOptions,
      fontsError,
      fontsLoading,
      loading,
      refreshFontOptions,
      refreshSettings,
      saving,
      settings,
      setActivityRailSettings,
      setBackupSettings,
      setWorkspaceSettings,
      setPlatformSettings,
      setTextEditorSettings,
    }),
    [
      error,
      fontOptions,
      fontsError,
      fontsLoading,
      loading,
      refreshFontOptions,
      refreshSettings,
      saving,
      settings,
      setActivityRailSettings,
      setBackupSettings,
      setWorkspaceSettings,
      setPlatformSettings,
      setTextEditorSettings,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
