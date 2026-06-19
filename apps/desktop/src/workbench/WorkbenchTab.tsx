import {
  DockviewDefaultTab,
  type IDockviewPanelHeaderProps,
} from "dockview-react";

import type { WorkbenchTabParams } from "@/workbench/workbench.types";

function paramsIsPreview(params: WorkbenchTabParams | undefined) {
  return params?.isPreview;
}

export function WorkbenchTab(
  props: IDockviewPanelHeaderProps<WorkbenchTabParams>,
) {
  const isPreview = Boolean(paramsIsPreview(props.params));

  return (
    <DockviewDefaultTab
      {...props}
      data-preview={isPreview ? "" : undefined}
      onDoubleClick={() => props.params.persistPreviewPanel?.(props.api.id)}
      style={isPreview ? { fontStyle: "italic" } : undefined}
    />
  );
}
