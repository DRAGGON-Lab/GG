import type {
  AddPanelPositionOptions,
  BuiltInContextMenuItem,
  DockviewApi,
  DockviewReadyEvent,
  GetTabContextMenuItemsParams,
  IDockviewPanel,
  ReactContextMenuItemConfig,
} from "dockview-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { pageById, pageRegistry } from "@/pages/page-registry";
import type {
  OpenAiConversationOptions,
  PageId,
  PageRuntime,
} from "@/pages/page.types";
import {
  getPageIdFromWorkbenchPanelId,
  getWorkbenchPagePanelId,
} from "@/workbench/ids";
import { getPlacementMovePosition, getPlacementSize } from "@/workbench/layout";
import type {
  DockviewDisposable,
  EnsurePagePanelOptions,
  OpenPageDisposition,
  WorkbenchController,
  WorkbenchPagePanelParams,
  WorkbenchPlacement,
  WorkbenchPlacementSize,
} from "@/workbench/workbench.types";

type UseWorkbenchControllerOptions = {
  activePageId: PageId;
  onPageActivated: (pageId: PageId | null) => void;
  pageRuntime?: PageRuntime;
};

export function useWorkbenchController({
  activePageId,
  onPageActivated,
  pageRuntime = {},
}: UseWorkbenchControllerOptions): WorkbenchController {
  const [activeWorkbenchPanelId, setActiveWorkbenchPanelId] = useState<
    string | null
  >(null);
  const [previewPagePanelId, setPreviewPagePanelIdState] = useState<
    string | null
  >(null);
  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const dockviewDisposablesRef = useRef<DockviewDisposable[]>([]);
  const previewPagePanelIdRef = useRef<string | null>(null);

  function setPreviewPagePanelId(panelId: string | null) {
    previewPagePanelIdRef.current = panelId;
    setPreviewPagePanelIdState(panelId);
  }

  function persistPreviewPanel(panelId: string) {
    if (previewPagePanelIdRef.current !== panelId) {
      return;
    }

    setPreviewPagePanelId(null);

    const pageId = getPageIdFromWorkbenchPanelId(panelId);
    const panel = dockviewApiRef.current?.getPanel(panelId);

    if (pageId && panel) {
      panel.api.updateParameters(
        getWorkbenchPagePanelParams(pageId, panelId, false),
      );
    }
  }

  function getWorkbenchPagePanelParams(
    pageId: PageId,
    panelId = getWorkbenchPagePanelId(pageId),
    isPreview = previewPagePanelIdRef.current === panelId,
    options: EnsurePagePanelOptions = {},
  ): WorkbenchPagePanelParams {
    return {
      ...pageRuntime,
      aiConversationId: options.aiConversationId ?? null,
      aiInitialContextAttachments: options.aiInitialContextAttachments ?? [],
      aiOpenRequestId: options.aiOpenRequestId ?? null,
      isPreview,
      openAiConversation,
      openPageInNewTab,
      pageId,
      persistPreviewPanel,
    };
  }

  function closePreviewPanel(api: DockviewApi, nextPreviewPanelId?: string) {
    const panelId = previewPagePanelIdRef.current;

    if (!panelId || panelId === nextPreviewPanelId) {
      return;
    }

    const panel = api.getPanel(panelId);

    if (panel) {
      api.removePanel(panel);
    }

    setPreviewPagePanelId(null);
  }

  function getReferencePagePanel(api: DockviewApi) {
    if (getPageIdFromWorkbenchPanelId(api.activePanel?.id) !== null) {
      return api.activePanel;
    }

    for (const candidatePage of pageRegistry) {
      const panel = api.getPanel(getWorkbenchPagePanelId(candidatePage.id));

      if (panel) {
        return panel;
      }
    }

    return undefined;
  }

  function getPlacementPosition(
    api: DockviewApi,
    placement: WorkbenchPlacement,
    referencePanel = getReferencePagePanel(api),
  ): AddPanelPositionOptions {
    return referencePanel
      ? {
          direction: placement,
          referencePanel,
        }
      : { direction: placement };
  }

  function resizePanelGroupForPlacement(
    api: DockviewApi,
    panel: IDockviewPanel,
    placement: WorkbenchPlacement,
  ) {
    const size: WorkbenchPlacementSize = getPlacementSize(api, placement);

    requestAnimationFrame(() => {
      panel.group.api.setSize(size);
    });
  }

  function movePanelToPlacement(
    panel: IDockviewPanel,
    placement: WorkbenchPlacement,
    api = dockviewApiRef.current,
    referencePanel = api ? getReferencePagePanel(api) : undefined,
  ) {
    if (!api) {
      return;
    }

    panel.api.moveTo({
      group: referencePanel?.group ?? panel.group,
      position: getPlacementMovePosition(placement),
    });
    panel.api.setActive();
    resizePanelGroupForPlacement(api, panel, placement);
  }

  function moveActivePanelToPlacement(placement: WorkbenchPlacement) {
    const api = dockviewApiRef.current;
    const panel = api?.activePanel;

    if (!api || !panel) {
      return;
    }

    movePanelToPlacement(panel, placement, api);
  }

  function closeActivePanel() {
    const api = dockviewApiRef.current;
    const panel = api?.activePanel;

    if (!api || !panel) {
      return;
    }

    api.removePanel(panel);
  }

  function ensurePagePanel(
    api: DockviewApi,
    pageId: PageId,
    options: EnsurePagePanelOptions = {},
  ) {
    const panelId = getWorkbenchPagePanelId(pageId, options.instanceId);
    const existingPanel = api.getPanel(panelId);
    const page = pageById[pageId];
    const disposition = options.disposition ?? "persistent";
    const existingPanelIsPreview = previewPagePanelIdRef.current === panelId;
    const shouldCreatePreview = disposition === "preview" && !existingPanel;

    if (shouldCreatePreview) {
      closePreviewPanel(api, panelId);
    } else if (disposition === "persistent" && existingPanelIsPreview) {
      setPreviewPagePanelId(null);
    }

    if (existingPanel) {
      existingPanel.api.setTitle(options.title ?? page.title);
      existingPanel.api.updateParameters(
        getWorkbenchPagePanelParams(
          pageId,
          panelId,
          disposition === "preview" && existingPanelIsPreview,
          options,
        ),
      );

      if (options.placement) {
        movePanelToPlacement(existingPanel, options.placement, api);
      }

      return existingPanel;
    }

    const referencePanel = getReferencePagePanel(api);
    const placementSize: WorkbenchPlacementSize = options.placement
      ? getPlacementSize(api, options.placement)
      : {};

    const panel = api.addPanel<WorkbenchPagePanelParams>({
      component: "page",
      id: panelId,
      initialHeight: options.initialHeight ?? placementSize.height,
      initialWidth: options.initialWidth ?? placementSize.width,
      minimumHeight: 220,
      minimumWidth: 320,
      params: getWorkbenchPagePanelParams(
        pageId,
        panelId,
        shouldCreatePreview,
        options,
      ),
      position: options.position
        ? options.position
        : options.placement
          ? getPlacementPosition(api, options.placement, referencePanel)
          : referencePanel
            ? {
                direction: "within",
                referencePanel,
              }
            : undefined,
      title: options.title ?? page.title,
    });

    if (shouldCreatePreview) {
      setPreviewPagePanelId(panel.id);
    }

    if (options.placement) {
      resizePanelGroupForPlacement(api, panel, options.placement);
    }

    return panel;
  }

  function openPageInNewTab(
    pageId: PageId,
    title = pageById[pageId].title,
    options: { placement?: WorkbenchPlacement } = {},
  ) {
    const api = dockviewApiRef.current;

    if (!api) {
      return;
    }

    ensurePagePanel(api, pageId, {
      disposition: "persistent",
      placement: options.placement,
      title,
    }).api.setActive();
  }

  function openAiConversation({
    contextAttachments = [],
    conversationId = null,
    placement = "right",
    title = "AI",
  }: OpenAiConversationOptions) {
    const api = dockviewApiRef.current;

    if (!api) {
      return;
    }

    const panel = ensurePagePanel(api, "ai", {
      aiConversationId: conversationId,
      aiInitialContextAttachments: contextAttachments,
      aiOpenRequestId: Date.now(),
      disposition: "persistent",
      placement,
      title,
    });

    panel.api.setActive();
  }

  function handleDockviewReady(event: DockviewReadyEvent) {
    const { api } = event;

    dockviewApiRef.current = api;
    dockviewDisposablesRef.current.forEach((disposable) =>
      disposable.dispose(),
    );

    const pagePanel = ensurePagePanel(api, activePageId);
    pagePanel.api.setActive();

    setActiveWorkbenchPanelId(pagePanel.id);

    dockviewDisposablesRef.current = [
      api.onDidRemovePanel((panel) => {
        if (previewPagePanelIdRef.current === panel.id) {
          setPreviewPagePanelId(null);
        }

        // With `noPanelsOverlay="emptyGroup"` dockview keeps the (now empty)
        // group when the last tab closes, and it never emits an active-panel
        // change for an empty group — so this removal is the only signal that
        // the workbench is empty. Drop the active page so the activity rail
        // stops indicating a page that is no longer open.
        if (api.panels.length === 0) {
          setActiveWorkbenchPanelId(null);
          onPageActivated(null);
        }
      }),
      api.onDidActivePanelChange((panel) => {
        const panelId = panel?.id ?? null;
        const pageId = getPageIdFromWorkbenchPanelId(panelId);

        setActiveWorkbenchPanelId(panelId);

        if (pageId) {
          onPageActivated(pageId);
        }
      }),
    ];
  }

  function navigateToPage(
    pageId: PageId,
    disposition: OpenPageDisposition = "preview",
    options: EnsurePagePanelOptions = {},
  ) {
    onPageActivated(pageId);

    const api = dockviewApiRef.current;
    if (api) {
      ensurePagePanel(api, pageId, { ...options, disposition }).api.setActive();
    }
  }

  function getTabContextMenuItems({
    panel,
  }: GetTabContextMenuItemsParams): (
    | BuiltInContextMenuItem
    | ReactContextMenuItemConfig
  )[] {
    return [
      {
        label: "Move to Right",
        action: () => movePanelToPlacement(panel, "right", undefined, panel),
      },
      {
        label: "Move Below",
        action: () => movePanelToPlacement(panel, "below", undefined, panel),
      },
      "separator",
      "close",
      "separator",
      "closeOthers",
    ];
  }

  useEffect(
    () => () => {
      dockviewDisposablesRef.current.forEach((disposable) =>
        disposable.dispose(),
      );
      dockviewDisposablesRef.current = [];
      dockviewApiRef.current = null;
    },
    [],
  );

  const syncPagePanelParams = useEffectEvent(
    (previewPanelId: string | null) => {
      const api = dockviewApiRef.current;

      if (!api) {
        return;
      }

      pageRegistry.forEach((page) => {
        const panelId = getWorkbenchPagePanelId(page.id);
        const panel = api.getPanel(panelId);

        if (!panel) {
          return;
        }

        panel.api.setTitle(page.title);
        panel.api.updateParameters(
          getWorkbenchPagePanelParams(
            page.id,
            panelId,
            previewPanelId === panelId,
          ),
        );
      });
    },
  );

  useEffect(() => {
    syncPagePanelParams(previewPagePanelId);
  }, [previewPagePanelId]);

  return {
    activeWorkbenchPanelId,
    closeActivePanel,
    getTabContextMenuItems,
    handleDockviewReady,
    moveActivePanelToPlacement,
    navigateToPage,
    openAiConversation,
  };
}
