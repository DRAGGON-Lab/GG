import type { IDockviewPanelProps } from "dockview-react";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";

import { getCachedPageComponent, loadPageComponent } from "@/pages/page-loader";
import { pageById } from "@/pages/page-registry";
import type { PageDefinition, PageId, PageRuntime } from "@/pages/page.types";
import { LoadingBlock, LoadingLine } from "@/ui";
import { cx } from "@/ui/class-name";
import type { WorkbenchPagePanelParams } from "@/workbench/workbench.types";

type LoadedPageComponent = {
  Component: ComponentType<PageRuntime>;
  pageId: PageId;
};

type WorkspacePageProps = PageRuntime & {
  isPreview: boolean;
  onPreviewInteraction: () => void;
  page: PageDefinition;
};

function getLoadedPageComponent(
  page: PageDefinition,
): LoadedPageComponent | null {
  const Component = getCachedPageComponent(page);
  return Component ? { Component, pageId: page.id } : null;
}

function WorkspacePage({
  isPreview,
  onPreviewInteraction,
  page,
  ...pageRuntime
}: WorkspacePageProps) {
  const [loadedPage, setLoadedPage] = useState<LoadedPageComponent | null>(
    () => (page.deferInitialRender ? null : getLoadedPageComponent(page)),
  );
  const [loadFailure, setLoadFailure] = useState<{
    message: string;
    pageId: PageId;
  } | null>(null);
  const PageComponent =
    loadedPage?.pageId === page.id ? loadedPage.Component : null;
  const loadError =
    loadFailure?.pageId === page.id ? loadFailure.message : null;
  const showHeader = !page.hideHeader;

  useEffect(() => {
    if (loadedPage?.pageId === page.id) {
      return;
    }

    let cancelled = false;
    let frameId: number | null = null;
    const cachedComponent = getLoadedPageComponent(page);

    if (cachedComponent) {
      // Already loaded (deferred initial render or a panel reuse): reveal on
      // the next frame so the skeleton paints first.
      frameId = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setLoadedPage(cachedComponent);
          setLoadFailure(null);
        }
      });
    } else {
      void loadPageComponent(page)
        .then((Component) => {
          if (!cancelled) {
            setLoadedPage({ Component, pageId: page.id });
            setLoadFailure(null);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setLoadFailure({
              message: error instanceof Error ? error.message : String(error),
              pageId: page.id,
            });
          }
        });
    }

    return () => {
      cancelled = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [loadedPage, page]);

  return (
    <div
      className={cx(
        "[container-type:inline-size] grid h-full min-h-0 min-w-0",
        showHeader
          ? "grid-rows-[auto_minmax(0,1fr)]"
          : "grid-rows-[minmax(0,1fr)]",
      )}
      data-page-chrome={showHeader ? undefined : "none"}
      data-preview={isPreview ? "" : undefined}
      onKeyDownCapture={isPreview ? onPreviewInteraction : undefined}
      onPointerDownCapture={isPreview ? onPreviewInteraction : undefined}
    >
      {showHeader ? (
        <header className="grid min-w-0 gap-[5px] border-b border-cg-border px-[22px] pb-[15px] pt-[17px]">
          <div className="text-[11px] font-[650] leading-none text-cg-muted">
            {page.activity}
          </div>
          <h1
            className="m-0 text-xl font-[690] leading-[1.1] tracking-normal text-cg-fg"
            id="app-workspace-title"
          >
            {page.title}
          </h1>
        </header>
      ) : null}
      {loadError ? (
        <WorkspacePageLoadError error={loadError} page={page} />
      ) : PageComponent ? (
        <div className="grid h-full min-h-0 min-w-0 animate-[app-surface-in_140ms_ease-out] motion-reduce:animate-none">
          <PageComponent {...pageRuntime} />
        </div>
      ) : (
        <WorkspacePageLoading page={page} />
      )}
    </div>
  );
}

function WorkspacePageLoadError({
  error,
  page,
}: {
  error: string;
  page: PageDefinition;
}) {
  return (
    <div className="grid h-full min-h-0 min-w-0 place-items-center bg-cg-editor px-6 text-center">
      <div className="grid max-w-[420px] gap-2">
        <div className="text-sm font-[650] text-cg-fg">
          Could not load {page.label}
        </div>
        <div className="text-xs leading-5 text-cg-muted">{error}</div>
      </div>
    </div>
  );
}

function WorkspacePageLoading({ page }: { page: PageDefinition }) {
  return (
    <div
      aria-label={`Loading ${page.label}`}
      aria-busy="true"
      className="h-full min-h-0 min-w-0 overflow-hidden bg-cg-editor"
    >
      <span className="sr-only">Loading {page.label}</span>
      <WorkspacePageLoadingSkeleton page={page} />
    </div>
  );
}

function WorkspacePageLoadingSkeleton({ page }: { page: PageDefinition }) {
  switch (page.activity) {
    case "AI":
      return <AiLoadingSkeleton />;
    case "Python":
      return <PythonLoadingSkeleton />;
    case "Database":
      return <DatabaseLoadingSkeleton />;
    case "Editor":
      return <EditorLoadingSkeleton />;
    case "Settings":
      return <SettingsLoadingSkeleton />;
  }
}

function EditorLoadingSkeleton() {
  return (
    <WorkbenchLoadingFrame
      sidebar={<FeatureSidebarLoading rows={12} titleWidth="64px" />}
      sidebarWidth="248px"
    >
      <DockGroup titleWidth="64px">
        <LoadingEditorSkeleton />
      </DockGroup>
    </WorkbenchLoadingFrame>
  );
}

function AiLoadingSkeleton() {
  return (
    <LoadingShell className="mx-auto max-w-[920px] grid-rows-[auto_minmax(0,1fr)_auto] px-3 py-3">
      <div className="grid gap-2 border-b border-cg-border px-1 pb-3">
        <LoadingLine className="h-2.5 w-24" />
        <LoadingLine className="h-4 w-48" emphasis="medium" />
      </div>
      <div className="grid min-h-0 content-start gap-3 overflow-hidden px-1 pt-4">
        <LoadingMessage width="70%" />
        <LoadingMessage align="end" width="56%" />
        <LoadingMessage width="64%" />
      </div>
      <div className="grid h-12 grid-cols-[minmax(0,1fr)_34px] items-center gap-2 border-t border-cg-border bg-cg-titlebar px-2">
        <LoadingLine className="h-3 w-full" />
        <LoadingBlock className="size-[30px] rounded-[6px]" />
      </div>
    </LoadingShell>
  );
}

function DatabaseLoadingSkeleton() {
  return (
    <WorkbenchLoadingFrame
      sidebar={<FeatureSidebarLoading rows={12} titleWidth="64px" />}
      sidebarWidth="248px"
    >
      <DockGroup titleWidth="64px">
        <LoadingEditorSkeleton />
      </DockGroup>
    </WorkbenchLoadingFrame>
  );
}

function PythonLoadingSkeleton() {
  return (
    <LoadingShell className="grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid min-h-0 min-w-0 place-items-center px-[18px]">
        <div className="inline-flex items-center gap-2">
          <LoadingBlock className="size-5 rounded-[5px]" />
          <LoadingLine className="h-3 w-36" />
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_34px] items-center gap-2 border-t border-cg-border bg-cg-titlebar px-3 py-[11px]">
        <div className="grid h-[34px] min-w-0 grid-cols-[50px_minmax(0,1fr)] items-center gap-2 rounded-[7px] border border-cg-border bg-cg-editor px-2.5">
          <LoadingLine className="h-2.5 w-9" />
          <LoadingLine className="h-3 w-[min(320px,70%)]" />
        </div>
        <LoadingBlock className="size-[34px] rounded-[7px]" />
      </div>
    </LoadingShell>
  );
}

function SettingsLoadingSkeleton() {
  return (
    <LoadingShell className="overflow-auto px-[22px] py-[18px]">
      <div className="grid max-w-[1040px] gap-6">
        {Array.from({ length: 4 }).map((_item, index) => (
          <section className="grid gap-3" key={index}>
            <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5">
              <LoadingLine className="h-3.5 w-44" emphasis="medium" />
              <LoadingLine className="h-6 w-20" />
            </header>
            <div className="grid gap-1.5">
              <LoadingLine className="h-9 w-full" />
              <LoadingLine className="h-9 w-[88%]" />
              {index === 2 ? <LoadingEditorSkeleton compact /> : null}
            </div>
          </section>
        ))}
      </div>
    </LoadingShell>
  );
}

function WorkbenchLoadingFrame({
  children,
  sidebar,
  sidebarWidth,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  sidebarWidth: string;
}) {
  return (
    <div
      aria-hidden="true"
      className="grid h-full min-h-0 min-w-0 overflow-hidden bg-cg-editor"
      style={{ gridTemplateColumns: `${sidebarWidth} 6px minmax(0,1fr)` }}
    >
      {sidebar}
      <div className="flex items-center justify-center overflow-hidden border-r border-cg-border bg-cg-titlebar">
        <span className="h-10 w-px bg-cg-border-strong opacity-45" />
      </div>
      <div className="h-full min-h-0 min-w-0 bg-cg-editor">{children}</div>
    </div>
  );
}

function FeatureSidebarLoading({
  indentEvery = 0,
  rowHeight = "26px",
  rows,
  titleWidth,
}: {
  indentEvery?: number;
  rowHeight?: string;
  rows: number;
  titleWidth: string;
}) {
  return (
    <aside
      aria-hidden="true"
      className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-cg-sidebar"
    >
      <div className="grid gap-2 border-b border-cg-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <LoadingLine
            className="h-3"
            emphasis="medium"
            style={{ width: titleWidth }}
          />
          <LoadingBlock className="size-6 rounded-[5px]" />
        </div>
        <LoadingLine className="h-7 w-full" />
      </div>
      <div className="grid content-start gap-1 overflow-hidden px-2 py-2">
        {Array.from({ length: rows }).map((_item, index) => (
          <LoadingLine
            className="rounded-[5px]"
            key={index}
            style={{
              height: rowHeight,
              marginLeft:
                indentEvery > 0 && index % indentEvery !== 0 ? "12px" : "0",
              width:
                indentEvery > 0 && index % indentEvery !== 0 ? "82%" : "100%",
            }}
          />
        ))}
      </div>
    </aside>
  );
}

function DockGroup({
  children,
  className,
  titleWidth,
}: {
  children: ReactNode;
  className?: string;
  titleWidth: string;
}) {
  return (
    <section
      className={cx(
        "grid min-h-0 min-w-0 grid-rows-[32px_minmax(0,1fr)] overflow-hidden bg-cg-editor",
        className,
      )}
    >
      <div className="flex min-w-0 items-end border-b border-cg-border bg-cg-titlebar px-2">
        <div className="grid h-[25px] min-w-0 items-center border-x border-t border-cg-border bg-cg-editor px-2.5">
          <LoadingLine className="h-2.5" style={{ width: titleWidth }} />
        </div>
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
    </section>
  );
}

function LoadingEditorSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cx(
        "grid min-h-0 content-start gap-2 overflow-hidden bg-cg-editor px-3 py-3",
        compact ? "h-[280px]" : "",
      )}
    >
      {Array.from({ length: compact ? 11 : 18 }).map((_item, index) => (
        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3" key={index}>
          <LoadingLine className="h-3 w-5" />
          <LoadingLine
            className="h-3"
            emphasis={index % 5 === 0 ? "medium" : "low"}
            style={{ width: `${44 + ((index * 17) % 52)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function LoadingShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "grid h-full min-h-0 min-w-0 overflow-hidden bg-cg-editor",
        className,
      )}
    >
      {children}
    </div>
  );
}

function LoadingMessage({
  align = "start",
  width,
}: {
  align?: "end" | "start";
  width: string;
}) {
  return (
    <div
      className={cx(
        "grid max-w-[620px] gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-3 py-2.5",
        align === "end" ? "justify-self-end" : "justify-self-start",
      )}
      style={{ width }}
    >
      <LoadingLine className="h-2.5 w-20" emphasis="medium" />
      <LoadingLine className="h-2.5 w-full" />
      <LoadingLine className="h-2.5 w-[72%]" />
    </div>
  );
}

export function WorkbenchPagePanel({
  api,
  params,
}: IDockviewPanelProps<WorkbenchPagePanelParams>) {
  const page = pageById[params.pageId];

  return (
    <WorkspacePage
      aiConversationId={params.aiConversationId}
      aiInitialContextAttachments={params.aiInitialContextAttachments}
      aiOpenRequestId={params.aiOpenRequestId}
      isPreview={params.isPreview}
      onPreviewInteraction={() => params.persistPreviewPanel(api.id)}
      openAiConversation={params.openAiConversation}
      openPageInNewTab={params.openPageInNewTab}
      page={page}
    />
  );
}
