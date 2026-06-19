import type {
  BuildCommandItemsOptions,
  CommandItem,
} from "@/commands/command.types";
import { activityIconByMode, pageRegistry } from "@/pages/page-registry";
import {
  Monitor,
  Moon,
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquareTerminal,
  Sun,
} from "@/ui";

const themeModeLabel = {
  system: "System",
  light: "Light",
  dark: "Dark",
} as const;

export function buildCommandItems({
  activePageId,
  moveActivePanelToPlacement,
  navigateToPage,
  resolvedTheme,
  setThemeMode,
  themeMode,
}: BuildCommandItemsOptions): readonly CommandItem[] {
  return [
    ...pageRegistry
      .filter(
        (page) =>
          !(
            "hiddenFromCommandPalette" in page && page.hiddenFromCommandPalette
          ),
      )
      .flatMap((page) => [
        {
          group: "Pages" as const,
          icon: activityIconByMode[page.activity],
          id: `page:${page.id}`,
          isActive: activePageId === page.id,
          keywords: [page.activity, page.label, ...page.keywords],
          label: page.label,
          run: () => navigateToPage(page.id),
          status: activePageId === page.id ? "Current" : undefined,
          subtitle: page.subtitle,
        },
        {
          group: "Pages" as const,
          icon: SquareSplitVertical,
          id: `page:${page.id}:right`,
          keywords: [
            "open",
            "split",
            "right",
            "column",
            page.activity,
            page.label,
            ...page.keywords,
          ],
          label: `Open ${page.label} to Right`,
          run: () =>
            navigateToPage(page.id, "persistent", { placement: "right" }),
          subtitle: "Open in a right split",
        },
        {
          group: "Pages" as const,
          icon: SquareSplitHorizontal,
          id: `page:${page.id}:below`,
          keywords: [
            "open",
            "split",
            "below",
            "bottom",
            "row",
            page.activity,
            page.label,
            ...page.keywords,
          ],
          label: `Open ${page.label} Below`,
          run: () =>
            navigateToPage(page.id, "persistent", { placement: "below" }),
          subtitle: "Open in a bottom split",
        },
      ]),
    ...buildFeatureCommandItems({
      navigateToPage,
    }),
    {
      group: "Appearance",
      icon: Sun,
      id: "theme:light",
      isActive: themeMode === "light",
      keywords: ["theme", "appearance", "light", "day"],
      label: "Use Light Mode",
      run: () => setThemeMode("light"),
      status: themeMode === "light" ? "Current" : undefined,
      subtitle: "Set the interface to a light appearance",
    },
    {
      group: "Appearance",
      icon: Moon,
      id: "theme:dark",
      isActive: themeMode === "dark",
      keywords: ["theme", "appearance", "dark", "night"],
      label: "Use Dark Mode",
      run: () => setThemeMode("dark"),
      status: themeMode === "dark" ? "Current" : undefined,
      subtitle: "Set the interface to a dark appearance",
    },
    {
      group: "Appearance",
      icon: Monitor,
      id: "theme:system",
      isActive: themeMode === "system",
      keywords: ["theme", "appearance", "system", "automatic", "auto"],
      label: "Use System Appearance",
      run: () => setThemeMode("system"),
      status:
        themeMode === "system"
          ? `Current: ${themeModeLabel[resolvedTheme]}`
          : undefined,
      subtitle: "Follow the macOS appearance setting",
    },
    {
      group: "View",
      icon: SquareSplitVertical,
      id: "view:move-active-right",
      keywords: ["split", "right", "column", "move", "tab", "pane"],
      label: "Move Active Tab to Right",
      run: () => moveActivePanelToPlacement("right"),
      subtitle: "Snap the active tab into a right-third pane",
    },
    {
      group: "View",
      icon: SquareSplitHorizontal,
      id: "view:move-active-below",
      keywords: ["split", "below", "bottom", "row", "move", "tab", "pane"],
      label: "Move Active Tab Below",
      run: () => moveActivePanelToPlacement("below"),
      subtitle: "Snap the active tab into a bottom-quarter pane",
    },
  ];
}

function buildFeatureCommandItems({
  navigateToPage,
}: Pick<BuildCommandItemsOptions, "navigateToPage">): readonly CommandItem[] {
  return [
    {
      group: "Features" as const,
      icon: SquareTerminal,
      id: "feature:python",
      keywords: [
        "python",
        "pyodide",
        "code",
        "script",
        "repl",
        "shell",
        "numpy",
        "numeric",
        "simulation",
      ],
      label: "Python",
      run: () => navigateToPage("python", "persistent"),
      subtitle: "Run Python in a persistent REPL.",
    },
  ];
}
