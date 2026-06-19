import type { DockviewTheme } from "dockview-react";

export const dockviewThemeByMode = {
  light: {
    className: "dockview-theme-light dockview-theme-bioeng",
    colorScheme: "light",
    name: "bioengLight",
  },
  dark: {
    className: "dockview-theme-dark dockview-theme-bioeng",
    colorScheme: "dark",
    name: "bioengDark",
  },
} as const satisfies Record<"light" | "dark", DockviewTheme>;
