import type {
  AddPanelPositionOptions,
  BuiltInContextMenuItem,
  DockviewReadyEvent,
  GetTabContextMenuItemsParams,
  ReactContextMenuItemConfig,
} from "dockview-react";

import type {
  OpenAiConversationOptions,
  PageId,
  PageRuntime,
} from "@/pages/page.types";

export type DockviewDisposable = {
  dispose: () => void;
};

export type OpenPageDisposition = "preview" | "persistent";

export type WorkbenchPlacement = "right" | "below";

export type WorkbenchPlacementSize = {
  height?: number;
  width?: number;
};

export type EnsurePagePanelOptions = {
  aiConversationId?: string | null;
  aiInitialContextAttachments?: PageRuntime["aiInitialContextAttachments"];
  aiOpenRequestId?: number | null;
  disposition?: OpenPageDisposition;
  initialHeight?: number;
  initialWidth?: number;
  instanceId?: string;
  placement?: WorkbenchPlacement;
  position?: AddPanelPositionOptions;
  title?: string;
};

export type WorkbenchPagePanelParams = PageRuntime & {
  isPreview: boolean;
  pageId: PageId;
  persistPreviewPanel: (panelId: string) => void;
};

export type WorkbenchTabParams = {
  isPreview?: boolean;
  persistPreviewPanel?: (panelId: string) => void;
};

export type WorkbenchController = {
  activeWorkbenchPanelId: string | null;
  closeActivePanel: () => void;
  getTabContextMenuItems: (
    params: GetTabContextMenuItemsParams,
  ) => (BuiltInContextMenuItem | ReactContextMenuItemConfig)[];
  handleDockviewReady: (event: DockviewReadyEvent) => void;
  moveActivePanelToPlacement: (placement: WorkbenchPlacement) => void;
  navigateToPage: (
    pageId: PageId,
    disposition?: OpenPageDisposition,
    options?: EnsurePagePanelOptions,
  ) => void;
  openAiConversation: (options: OpenAiConversationOptions) => void;
};
