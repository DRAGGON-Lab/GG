import {
  DockviewDefaultTab,
  type DockviewPanelApi,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { type ReactNode, useEffect, useState } from "react";

import { useEditorPageContext } from "@/features/editor/editor-page-context";
import { GGCircuitWordmark } from "@/ui";

export type EditorDockPanelKind =
  | "assistant"
  | "diagnostics"
  | "diff"
  | "editor"
  | "environment"
  | "history"
  | "output"
  | "review";

export type EditorDockPanelRender = (
  panelApi: DockviewPanelApi,
  panelEpoch: number,
  params: EditorDockPanelParams,
) => ReactNode;

export type EditorDockPanelParams = {
  closePanel?: (panelId: string) => void;
  documentPath?: string | null;
  isPlaceholder?: boolean;
  isPreview?: boolean;
  kind: EditorDockPanelKind;
  persistPreviewPanel?: (panelId: string) => void;
  render: EditorDockPanelRender;
};

export type EditorDockPanelRenderMap = {
  assistant: EditorDockPanelRender;
  diagnostics: EditorDockPanelRender;
  environment: EditorDockPanelRender;
  history: EditorDockPanelRender;
  output: EditorDockPanelRender;
};

/// The single registered dockview component. A `panelEpoch` bumped on group
/// moves forces hosted Monaco surfaces to re-measure after a dock change.
export function EditorDockPanel({
  api,
  params,
}: IDockviewPanelProps<EditorDockPanelParams>) {
  const [panelEpoch, setPanelEpoch] = useState(0);

  useEffect(() => {
    const disposable = api.onDidGroupChange(() => {
      setPanelEpoch((current) => current + 1);
    });

    return () => {
      disposable.dispose();
    };
  }, [api]);

  return (
    <div className="h-full min-h-0 min-w-0 animate-[app-surface-in_140ms_ease-out] overflow-hidden motion-reduce:animate-none">
      {params.render(api, panelEpoch, params)}
    </div>
  );
}

export function EditorEmptySurface() {
  return (
    <section
      aria-label="Editor empty state"
      className="grid h-full min-h-0 min-w-0 animate-[app-surface-in_140ms_ease-out] place-items-center bg-cg-editor motion-reduce:animate-none"
    >
      <GGCircuitWordmark className="text-cg-muted opacity-65" size={360} />
    </section>
  );
}

/// Tab renderer that wires preview semantics: an italic preview tab promotes to
/// a persistent one on double-click, and the close button routes through the
/// page's panel bookkeeping.
export function EditorDockTab(
  props: IDockviewPanelHeaderProps<EditorDockPanelParams>,
) {
  const { dirtyByKey } = useEditorPageContext();
  const isPreview = Boolean(props.params?.isPreview);
  // The wordmark placeholder is the editor group's permanent floor: it carries
  // no close button, so the center panel can never be closed all the way.
  const isPlaceholder = Boolean(props.params?.isPlaceholder);

  // A buffer with unsaved edits is dirty; the dot rides the close-button slot
  // (turns into ✕ on hover) via CSS.
  const documentPath = props.params?.documentPath ?? null;
  const dirty = documentPath ? Boolean(dirtyByKey[documentPath]) : false;

  return (
    <DockviewDefaultTab
      {...props}
      closeActionOverride={
        props.params?.closePanel
          ? () => props.params?.closePanel?.(props.api.id)
          : undefined
      }
      data-dirty={dirty ? "" : undefined}
      data-preview={isPreview ? "" : undefined}
      hideClose={isPlaceholder}
      onDoubleClick={() => props.params?.persistPreviewPanel?.(props.api.id)}
      style={isPreview ? { fontStyle: "italic" } : undefined}
    />
  );
}
