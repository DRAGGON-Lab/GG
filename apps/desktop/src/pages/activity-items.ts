import {
  type ActivityRailItemId,
  DEFAULT_ACTIVITY_ORDER,
  normalizeActivityOrder,
} from "@/features/settings/activity-order";
import type { ActivityItem, ActivityMode } from "@/pages/page.types";
import {
  Code2,
  Database,
  Dna,
  type LucideIcon,
  MessageSquare,
  Settings,
  SquareTerminal,
  Waypoints,
} from "@/ui";

export const activityIconByMode = {
  AI: MessageSquare,
  Python: SquareTerminal,
  Circuit: Waypoints,
  Data: Dna,
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
  Circuit: {
    Icon: activityIconByMode.Circuit,
    label: "Circuit",
    pageId: "circuit",
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
  Data: {
    Icon: activityIconByMode.Data,
    label: "Data",
    pageId: "data",
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
