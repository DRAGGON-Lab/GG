import {
  type ActivityRailItemId,
  DEFAULT_ACTIVITY_ORDER,
  normalizeActivityOrder,
} from "@/features/settings/activity-order";
import type { ActivityItem, ActivityMode } from "@/pages/page.types";
import {
  Code2,
  Database,
  type LucideIcon,
  MessageSquare,
  Settings,
  SquareTerminal,
} from "@/ui";

export const activityIconByMode = {
  AI: MessageSquare,
  Python: SquareTerminal,
  Database,
  Editor: Code2,
  Settings,
} as const satisfies Record<ActivityMode, LucideIcon>;

export const activityItemByMode = {
  Editor: {
    Icon: activityIconByMode.Editor,
    label: "Editor",
    pageId: "editor",
  },
  Python: {
    Icon: activityIconByMode.Python,
    label: "Python",
    pageId: "python",
  },
  AI: {
    Icon: activityIconByMode.AI,
    label: "AI",
    pageId: "ai",
  },
} as const satisfies Record<ActivityRailItemId, ActivityItem>;

export const activityItems = DEFAULT_ACTIVITY_ORDER.map(
  (activityMode) => activityItemByMode[activityMode],
);

export function orderActivityItems(
  activityOrder: readonly ActivityRailItemId[],
  hiddenActivityItems: readonly ActivityRailItemId[] = [],
) {
  return normalizeActivityOrder(activityOrder)
    .filter((activityMode) => !hiddenActivityItems.includes(activityMode))
    .map((activityMode) => activityItemByMode[activityMode]);
}
