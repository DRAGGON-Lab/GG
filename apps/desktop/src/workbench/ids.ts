import { pageById } from "@/pages/page-registry";
import type { PageId } from "@/pages/page.types";

export const WORKBENCH_PAGE_PANEL_PREFIX = "workbench:page:";
const WORKBENCH_PAGE_PANEL_INSTANCE_SEPARATOR = "::";

export function getWorkbenchPagePanelId(pageId: PageId, instanceId?: string) {
  return `${WORKBENCH_PAGE_PANEL_PREFIX}${pageId}${
    instanceId
      ? `${WORKBENCH_PAGE_PANEL_INSTANCE_SEPARATOR}${encodeURIComponent(instanceId)}`
      : ""
  }`;
}

export function getPageIdFromWorkbenchPanelId(
  panelId: string | null | undefined,
) {
  if (!panelId?.startsWith(WORKBENCH_PAGE_PANEL_PREFIX)) {
    return null;
  }

  const panelSuffix = panelId.slice(WORKBENCH_PAGE_PANEL_PREFIX.length);
  if (panelSuffix in pageById) {
    return panelSuffix as PageId;
  }

  const pageId = Object.keys(pageById).find((candidatePageId) =>
    panelSuffix.startsWith(
      `${candidatePageId}${WORKBENCH_PAGE_PANEL_INSTANCE_SEPARATOR}`,
    ),
  );

  return pageId ? (pageId as PageId) : null;
}

export function isPageId(value: string | null | undefined): value is PageId {
  return Boolean(value && value in pageById);
}
