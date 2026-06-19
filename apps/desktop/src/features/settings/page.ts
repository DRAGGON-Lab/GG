import type { PageDefinition } from "@/pages/page.types";

export const settingsPage = {
  activity: "Settings",
  hideHeader: true,
  id: "settings",
  keywords: ["settings", "preferences", "text editor", "theme", "font"],
  label: "Settings",
  loadComponent: () =>
    import("@/features/settings/SettingsPage").then(({ SettingsPage }) => ({
      default: SettingsPage,
    })),
  subtitle: "Configure editor preferences.",
  title: "Settings",
} as const satisfies PageDefinition;
