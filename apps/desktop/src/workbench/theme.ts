import type { DockviewTheme } from "dockview-react";

export const dockviewThemeByMode = {
  light: {
    className: "dockview-theme-light dockview-theme-gg",
    colorScheme: "light",
    name: "ggLight",
  },
  dark: {
    className: "dockview-theme-dark dockview-theme-gg",
    colorScheme: "dark",
    name: "ggDark",
  },
} as const satisfies Record<"light" | "dark", DockviewTheme>;
