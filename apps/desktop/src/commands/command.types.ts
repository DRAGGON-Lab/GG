import type { PageId } from "@/pages/page.types";
import type { LucideIcon, ResolvedTheme, ThemeMode } from "@/ui";
import type {
  EnsurePagePanelOptions,
  OpenPageDisposition,
  WorkbenchPlacement,
} from "@/workbench/workbench.types";

export type CommandGroup = "Pages" | "Features" | "Appearance" | "View";

/// The palette shows app commands.
export type CommandPaletteMode = "commands";

export type CommandItem = {
  group: CommandGroup;
  icon: LucideIcon;
  id: string;
  isActive?: boolean;
  /// Keep the palette open after running (mode-switching items).
  keepOpen?: boolean;
  keywords: readonly string[];
  label: string;
  run: () => void;
  shortcut?: string;
  status?: string;
  subtitle: string;
};

export type CommandGroupResult = {
  commands: readonly CommandItem[];
  group: CommandGroup;
};

export type BuildCommandItemsOptions = {
  activePageId: PageId;
  moveActivePanelToPlacement: (placement: WorkbenchPlacement) => void;
  navigateToPage: (
    pageId: PageId,
    disposition?: OpenPageDisposition,
    options?: EnsurePagePanelOptions,
  ) => void;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (mode: ThemeMode) => void;
  themeMode: ThemeMode;
};
