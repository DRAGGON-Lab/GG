import { aiPage } from "@/features/ai/page";
import { circuitPage } from "@/features/circuit/page";
import { dataPage } from "@/features/data/page";
import { databasePage } from "@/features/database/page";
import { editorPage } from "@/features/editor/page";
import { pythonPage } from "@/features/python/page";
import { settingsPage } from "@/features/settings/page";
import type {
  PageDefinition,
  PageId,
  TopLevelActivityMode,
} from "@/pages/page.types";

export {
  activityIconByMode,
  activityItemByMode,
  activityItems,
  orderActivityItems,
} from "@/pages/activity-items";

export const pageRegistry = [
  aiPage,
  editorPage,
  circuitPage,
  pythonPage,
  dataPage,
  databasePage,
  settingsPage,
] as const satisfies readonly PageDefinition[];

export const pageById = Object.fromEntries(
  pageRegistry.map((page) => [page.id, page]),
) as unknown as Record<PageId, PageDefinition>;

export const pageByActivity = {
  AI: "ai",
  Editor: "editor",
  Circuit: "circuit",
  Python: "python",
  Data: "data",
} as const satisfies Record<TopLevelActivityMode, PageId>;
