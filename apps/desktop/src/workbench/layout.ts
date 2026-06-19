import type { DockviewApi, Position } from "dockview-react";

import type {
  WorkbenchPlacement,
  WorkbenchPlacementSize,
} from "@/workbench/workbench.types";

export const WORKBENCH_RIGHT_SPLIT_RATIO = 1 / 3;
export const WORKBENCH_BOTTOM_SPLIT_RATIO = 1 / 4;

export function getPlacementMovePosition(
  placement: WorkbenchPlacement,
): Position {
  return placement === "right" ? "right" : "bottom";
}

export function getPlacementSize(
  api: DockviewApi,
  placement: WorkbenchPlacement,
) {
  const size: WorkbenchPlacementSize =
    placement === "right"
      ? {
          width: Math.max(
            320,
            Math.round(api.width * WORKBENCH_RIGHT_SPLIT_RATIO),
          ),
        }
      : {
          height: Math.max(
            220,
            Math.round(api.height * WORKBENCH_BOTTOM_SPLIT_RATIO),
          ),
        };

  return size;
}
