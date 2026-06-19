import activityRailDefaults from "./activity-order.json";

export type ActivityRailItemId = "Editor" | "Python" | "AI";

// Order + hidden-by-default items are the single source of truth in
// activity-order.json, shared verbatim with the Rust backend (which embeds the
// same file via include_str!) so the default can never drift between the two.
export const DEFAULT_ACTIVITY_ORDER =
  activityRailDefaults.order as readonly ActivityRailItemId[];

export const DEFAULT_HIDDEN_ACTIVITY_ITEMS =
  activityRailDefaults.hidden as readonly ActivityRailItemId[];

export function isActivityRailItemId(
  value: unknown,
): value is ActivityRailItemId {
  return DEFAULT_ACTIVITY_ORDER.some((itemId) => itemId === value);
}

export function normalizeActivityOrder(value: unknown): ActivityRailItemId[] {
  const activityOrder: ActivityRailItemId[] = [];

  if (Array.isArray(value)) {
    for (const itemId of value) {
      if (isActivityRailItemId(itemId) && !activityOrder.includes(itemId)) {
        activityOrder.push(itemId);
      }
    }
  }

  for (const itemId of DEFAULT_ACTIVITY_ORDER) {
    if (!activityOrder.includes(itemId)) {
      activityOrder.push(itemId);
    }
  }

  return activityOrder;
}

export function normalizeHiddenActivityItems(
  value: unknown,
): ActivityRailItemId[] {
  const hiddenActivityItems: ActivityRailItemId[] = [];

  const source = Array.isArray(value) ? value : DEFAULT_HIDDEN_ACTIVITY_ITEMS;

  for (const itemId of source) {
    if (isActivityRailItemId(itemId) && !hiddenActivityItems.includes(itemId)) {
      hiddenActivityItems.push(itemId);
    }
  }

  return hiddenActivityItems;
}

export function includeDefaultHiddenActivityItems(
  activityItems: readonly ActivityRailItemId[],
): ActivityRailItemId[] {
  const normalized = normalizeHiddenActivityItems(activityItems);

  for (const itemId of DEFAULT_HIDDEN_ACTIVITY_ITEMS) {
    if (!normalized.includes(itemId)) {
      normalized.push(itemId);
    }
  }

  return normalized;
}
