import activityRailDefaults from "./activity-order.json";

export type ActivityRailItemId =
  | "Editor"
  | "Circuit"
  | "Python"
  | "AI"
  | "Data"
  | "Flapjack";

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
  const kept: ActivityRailItemId[] = [];

  if (Array.isArray(value)) {
    for (const itemId of value) {
      if (isActivityRailItemId(itemId) && !kept.includes(itemId)) {
        kept.push(itemId);
      }
    }
  }

  // A new release can add a rail item the saved order predates. Rather than
  // append it — which buries every new feature at the end of the rail — reset
  // to the default order so the newcomer lands in its intended place. A saved
  // order that already holds every default item keeps its custom arrangement.
  const missingDefaultItem = DEFAULT_ACTIVITY_ORDER.some(
    (itemId) => !kept.includes(itemId),
  );
  if (missingDefaultItem) {
    return [...DEFAULT_ACTIVITY_ORDER];
  }

  return kept;
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
