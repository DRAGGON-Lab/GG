import {
  DockviewDefaultTab,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import type { ReactNode } from "react";

export type CircuitDockPanelKind =
  | "canvas"
  | "palette"
  | "node"
  | "code"
  | "simulate"
  | "output";

export type CircuitDockPanelParams = {
  kind: CircuitDockPanelKind;
  render: () => ReactNode;
  /// Whether the tab shows a close button. Only the on-demand Output panel is
  /// closeable; the core panels stay put so the layout can't be dismantled.
  closeable?: boolean;
};

/// The single registered dockview component: it renders its panel's `render`
/// closure, which reads live page state from `CircuitPageContext`.
export function CircuitDockPanel({
  params,
}: IDockviewPanelProps<CircuitDockPanelParams>) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden bg-cg-editor">
      {params.render()}
    </div>
  );
}

export function CircuitDockTab(
  props: IDockviewPanelHeaderProps<CircuitDockPanelParams>,
) {
  return <DockviewDefaultTab {...props} hideClose={!props.params?.closeable} />;
}
