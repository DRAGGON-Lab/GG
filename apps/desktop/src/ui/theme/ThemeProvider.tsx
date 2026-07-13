import * as React from "react";

import {
  type ResolvedTheme,
  ThemeContext,
  type ThemeMode,
} from "@/ui/theme/use-theme";

export type { ResolvedTheme, ThemeMode } from "@/ui/theme/use-theme";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
}

const storageKey = "gg.theme";
const darkModeQuery = "(prefers-color-scheme: dark)";
const nativeBackgroundColor: Record<
  ResolvedTheme,
  [number, number, number, number]
> = {
  light: [251, 252, 250, 255],
  dark: [17, 19, 15, 255],
};

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): ResolvedTheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia(darkModeQuery).matches
  ) {
    return "dark";
  }

  return "light";
}

function getStoredMode(defaultMode: ThemeMode): ThemeMode {
  if (typeof window === "undefined") {
    return defaultMode;
  }

  try {
    const storedMode = window.localStorage.getItem(storageKey);
    return isThemeMode(storedMode) ? storedMode : defaultMode;
  } catch {
    return defaultMode;
  }
}

function persistMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(storageKey, mode);
  } catch {
    // Ignore storage failures; theme state still works for the current session.
  }
}

function applyTheme(mode: ThemeMode, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolvedTheme;
}

async function applyNativeTheme(resolvedTheme: ResolvedTheme) {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  try {
    const [{ setTheme }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/app"),
      import("@tauri-apps/api/window"),
    ]);
    const currentWindow = getCurrentWindow();

    await Promise.all([
      setTheme(resolvedTheme),
      currentWindow.setTheme(resolvedTheme),
      currentWindow.setBackgroundColor(nativeBackgroundColor[resolvedTheme]),
    ]);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Unable to sync native theme", error);
    }
  }
}

export function ThemeProvider({
  children,
  defaultMode = "system",
}: ThemeProviderProps) {
  const [mode, setModeState] = React.useState<ThemeMode>(() =>
    getStoredMode(defaultMode),
  );
  const [systemTheme, setSystemTheme] =
    React.useState<ResolvedTheme>(getSystemTheme);

  const resolvedTheme = mode === "system" ? systemTheme : mode;

  React.useLayoutEffect(() => {
    applyTheme(mode, resolvedTheme);
  }, [mode, resolvedTheme]);

  React.useEffect(() => {
    void applyNativeTheme(resolvedTheme);
  }, [resolvedTheme]);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(darkModeQuery);

    function handleChange(event: MediaQueryListEvent) {
      setSystemTheme(event.matches ? "dark" : "light");
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const setMode = React.useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    persistMode(nextMode);
  }, []);

  const value = React.useMemo(
    () => ({ mode, resolvedTheme, setMode }),
    [mode, resolvedTheme, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
