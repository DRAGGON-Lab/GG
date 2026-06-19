import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildCommandItems } from "@/commands/command-items";
import { filterCommands, groupCommands } from "@/commands/command-search";
import type { CommandItem } from "@/commands/command.types";
import { CommandPalette } from "@/commands/CommandPalette";
import { useAppSettings } from "@/features/settings";
import type { ActivityRailItemId } from "@/features/settings/activity-order";
import { orderActivityItems } from "@/pages/activity-items";
import { preloadPageComponent } from "@/pages/page-loader";
import { pageByActivity, pageById, pageRegistry } from "@/pages/page-registry";
import type {
  ActivityMode,
  PageDefinition,
  PageId,
  TopLevelActivityMode,
} from "@/pages/page.types";
import { ActivityBar } from "@/shell/ActivityBar";
import { TopBar } from "@/shell/TopBar";
import { useTheme } from "@/ui";
import { useWorkbenchController } from "@/workbench/useWorkbenchController";
import { Workbench } from "@/workbench/Workbench";

import "@/app/app.css";
import "@/ui/theme/dockview.css";

const PAGE_PRELOAD_START_DELAY_MS = 700;
const PAGE_PRELOAD_INTERVAL_MS = 180;

function App() {
  const [activePageId, setActivePageId] = useState<PageId | null>(null);
  const [hasInitializedActivePage, setHasInitializedActivePage] =
    useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const pagePreloadStartedRef = useRef(false);
  const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useTheme();
  const { loading: settingsLoading, settings } = useAppSettings();
  const orderedActivityItems = useMemo(
    () =>
      orderActivityItems(settings.activityOrder, settings.hiddenActivityItems),
    [settings.activityOrder, settings.hiddenActivityItems],
  );
  const configuredInitialPageId = useMemo(() => {
    const [firstActivityItem] = orderedActivityItems;

    return firstActivityItem
      ? pageByActivity[firstActivityItem.label]
      : "settings";
  }, [orderedActivityItems]);
  // Open the configured page once, when settings first load. This is a one-time
  // initialization, not a "null → reset" rule: after startup the active page is
  // allowed to become null again (e.g. closing the last tab), and we must not
  // snap it back to the initial page when that happens.
  if (!settingsLoading && !hasInitializedActivePage) {
    setHasInitializedActivePage(true);
    setActivePageId(configuredInitialPageId);
  }

  const effectiveActivePageId =
    activePageId ??
    (settingsLoading ? pageByActivity.Editor : configuredInitialPageId);
  // The activity-rail indicator tracks the page that is actually open; with no
  // tab open there is nothing to indicate.
  const activityMode: ActivityMode | null = activePageId
    ? pageById[activePageId].activity
    : null;

  const openCommandPalette = useCallback(() => {
    setCommandQuery("");
    setSelectedCommandIndex(0);
    setCommandPaletteOpen(true);
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setCommandQuery(value);
    setSelectedCommandIndex(0);
  }, []);

  const setActivePageState = useCallback((pageId: PageId | null) => {
    setActivePageId(pageId);
  }, []);

  const workbenchController = useWorkbenchController({
    activePageId: effectiveActivePageId,
    onPageActivated: setActivePageState,
  });

  const navigateToActivity = useCallback(
    (mode: TopLevelActivityMode) => {
      workbenchController.navigateToPage(pageByActivity[mode], "persistent");
    },
    [workbenchController],
  );

  const openSettings = useCallback(() => {
    workbenchController.navigateToPage("settings", "persistent");
  }, [workbenchController]);

  const preloadActivity = useCallback((mode: TopLevelActivityMode) => {
    preloadPageComponent(pageById[pageByActivity[mode]]);
  }, []);

  const preloadSettings = useCallback(() => {
    preloadPageComponent(pageById.settings);
  }, []);

  const commandItems = useMemo(
    () =>
      buildCommandItems({
        activePageId: effectiveActivePageId,
        moveActivePanelToPlacement:
          workbenchController.moveActivePanelToPlacement,
        navigateToPage: workbenchController.navigateToPage,
        resolvedTheme,
        setThemeMode,
        themeMode,
      }),
    [
      effectiveActivePageId,
      resolvedTheme,
      setThemeMode,
      themeMode,
      workbenchController,
    ],
  );

  const filteredCommands = useMemo(
    () => filterCommands(commandItems, commandQuery),
    [commandItems, commandQuery],
  );

  const groupedCommands = useMemo(
    () => groupCommands(filteredCommands),
    [filteredCommands],
  );

  const runCommand = useCallback((command: CommandItem | undefined) => {
    if (!command) {
      return;
    }

    command.run();

    if (!command.keepOpen) {
      setCommandPaletteOpen(false);
      setCommandQuery("");
    }
  }, []);

  const handleCommandPaletteOpenChange = useCallback((open: boolean) => {
    setCommandPaletteOpen(open);
    if (open) {
      setSelectedCommandIndex(0);
    } else {
      setCommandQuery("");
    }
  }, []);

  useEffect(() => {
    if (settingsLoading || pagePreloadStartedRef.current) {
      return;
    }

    pagePreloadStartedRef.current = true;

    const pagePreloadQueue = buildPagePreloadQueue({
      activePageId: effectiveActivePageId,
      activityOrder: settings.activityOrder,
      hiddenActivityItems: settings.hiddenActivityItems,
    });
    const timeoutIds: number[] = [];
    let cancelled = false;
    let didStartPreloading = false;

    function preloadPageAtIndex(index: number) {
      if (cancelled || index >= pagePreloadQueue.length) {
        return;
      }

      didStartPreloading = true;
      preloadPageComponent(pagePreloadQueue[index]);
      timeoutIds.push(
        window.setTimeout(
          () => preloadPageAtIndex(index + 1),
          PAGE_PRELOAD_INTERVAL_MS,
        ),
      );
    }

    timeoutIds.push(
      window.setTimeout(
        () => preloadPageAtIndex(0),
        PAGE_PRELOAD_START_DELAY_MS,
      ),
    );

    return () => {
      cancelled = true;
      if (!didStartPreloading) {
        pagePreloadStartedRef.current = false;
      }

      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    effectiveActivePageId,
    settings.activityOrder,
    settings.hiddenActivityItems,
    settingsLoading,
  ]);

  useEffect(() => {
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        openCommandPalette();
      } else if (key === "w") {
        event.preventDefault();
        workbenchController.closeActivePanel();
      } else if (!event.shiftKey && /^[1-9]$/.test(key)) {
        const activityItem = orderedActivityItems[Number(key) - 1];
        if (activityItem) {
          event.preventDefault();
          navigateToActivity(activityItem.label);
        }
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleWindowKeyDown, {
        capture: true,
      });
  }, [
    navigateToActivity,
    openCommandPalette,
    orderedActivityItems,
    workbenchController,
  ]);

  const maxCommandIndex = Math.max(filteredCommands.length - 1, 0);
  if (
    selectedCommandIndex >= filteredCommands.length &&
    selectedCommandIndex !== maxCommandIndex
  ) {
    setSelectedCommandIndex(maxCommandIndex);
  }

  return (
    <main className="grid h-screen w-screen grid-rows-[46px_minmax(0,1fr)] overflow-hidden bg-cg-bg text-cg-fg [--app-activitybar-width:46px]">
      <TopBar onOpenCommandPalette={openCommandPalette} />

      <div className="app-main grid min-h-0 min-w-0 grid-cols-[var(--app-activitybar-width)_minmax(0,1fr)] bg-cg-editor">
        <ActivityBar
          activityMode={activityMode}
          onNavigateToActivity={navigateToActivity}
          onOpenSettings={openSettings}
          onPreloadActivity={preloadActivity}
          onPreloadSettings={preloadSettings}
        />

        <div className="relative col-start-2 grid min-h-0 min-w-0">
          {settingsLoading ? null : (
            <Workbench
              controller={workbenchController}
              resolvedTheme={resolvedTheme}
            />
          )}
        </div>
      </div>

      <CommandPalette
        filteredCommands={filteredCommands}
        groupedCommands={groupedCommands}
        onOpenChange={handleCommandPaletteOpenChange}
        open={commandPaletteOpen}
        query={commandQuery}
        runCommand={runCommand}
        selectedCommandIndex={selectedCommandIndex}
        setQuery={handleQueryChange}
        setSelectedCommandIndex={setSelectedCommandIndex}
      />
    </main>
  );
}

function buildPagePreloadQueue({
  activePageId,
  activityOrder,
  hiddenActivityItems,
}: {
  activePageId: PageId;
  activityOrder: readonly ActivityRailItemId[];
  hiddenActivityItems: readonly ActivityRailItemId[];
}) {
  const pageIds = new Set<PageId>();
  const pages: PageDefinition[] = [];

  function addPage(pageId: PageId) {
    if (pageIds.has(pageId)) {
      return;
    }

    pageIds.add(pageId);
    pages.push(pageById[pageId]);
  }

  addPage(activePageId);

  for (const activityItem of orderActivityItems(
    activityOrder,
    hiddenActivityItems,
  )) {
    addPage(activityItem.pageId);
  }

  addPage("settings");

  for (const page of pageRegistry) {
    addPage(page.id);
  }

  return pages;
}

export default App;
