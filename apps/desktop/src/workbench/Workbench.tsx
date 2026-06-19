import { DockviewReact } from "dockview-react";

import type { ResolvedTheme } from "@/ui";
import { dockviewThemeByMode } from "@/workbench/theme";
import type { WorkbenchController } from "@/workbench/workbench.types";
import { WorkbenchPagePanel } from "@/workbench/WorkbenchPagePanel";
import { WorkbenchTab } from "@/workbench/WorkbenchTab";

import "dockview/dist/styles/dockview.css";

const dockviewComponents = {
  page: WorkbenchPagePanel,
};

type WorkbenchProps = {
  controller: WorkbenchController;
  resolvedTheme: ResolvedTheme;
};

export function Workbench({ controller, resolvedTheme }: WorkbenchProps) {
  return (
    <section
      aria-label="Workbench"
      className="min-h-0 min-w-0 overflow-hidden bg-cg-editor"
    >
      <div className="h-full w-full bg-cg-editor">
        <DockviewReact
          components={dockviewComponents}
          defaultTabComponent={WorkbenchTab}
          dndStrategy="pointer"
          getTabContextMenuItems={controller.getTabContextMenuItems}
          noPanelsOverlay="emptyGroup"
          onReady={controller.handleDockviewReady}
          theme={dockviewThemeByMode[resolvedTheme]}
        />
      </div>
    </section>
  );
}
