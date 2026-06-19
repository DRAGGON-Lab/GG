import {
  type DockviewApi,
  DockviewDefaultTab,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  agentInterrupt,
  aiConversationDelete,
  aiConversationsList,
} from "@/features/ai/core/agent-client";
import type {
  AiContextAttachment,
  AiContextAttachmentInput,
  AiConversation,
  AiConversationSummary,
} from "@/features/ai/core/ai-types";
import { AiSurface } from "@/features/ai/core/components/AiSurface";
import type { PageRuntime } from "@/pages/page.types";
import {
  Button,
  ChevronRight,
  LoaderCircle,
  type LucideIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from "@/ui";
import { cx } from "@/ui/class-name";
import { useTheme } from "@/ui/theme";
import { dockviewThemeByMode } from "@/workbench/theme";

type ThreadCategoryId = "general";

type ThreadCategory = {
  id: ThreadCategoryId;
  Icon: LucideIcon;
  label: string;
};

type ThreadGroup = ThreadCategory & {
  expanded: boolean;
  hiddenCount: number;
  threads: AiConversationSummary[];
  totalCount: number;
};

type AiDockPanelParams = {
  conversationId?: string | null;
  kind: "chat";
  render: () => ReactNode;
};

type AiChatPanelRecord = {
  conversationId: string | null;
  panelId: string;
};

const THREAD_CATEGORY_LIMIT = 3;

const THREAD_CATEGORY_ORDER: ThreadCategoryId[] = ["general"];

const THREAD_CATEGORIES: Record<ThreadCategoryId, ThreadCategory> = {
  general: { id: "general", Icon: MessageSquare, label: "General" },
};

const AI_DOCK_PANEL_COMPONENTS = {
  aiPanel: AiDockPanel,
};

const AI_DOCK_TAB_COMPONENTS = {
  aiTab: AiDockTab,
};

const aiSidebarIconButtonClassName =
  "size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg";

const aiSidebarTabRowButtonClassName =
  "size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-transparent hover:text-cg-fg [&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-out hover:[&>svg]:scale-110";

function AiDockPanel({ params }: IDockviewPanelProps<AiDockPanelParams>) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      {params.render()}
    </div>
  );
}

function AiDockTab(props: IDockviewPanelHeaderProps<AiDockPanelParams>) {
  return <DockviewDefaultTab {...props} />;
}

export function AiPage({
  aiConversationId,
  aiInitialContextAttachments = [],
  aiOpenRequestId,
  openPageInNewTab,
}: PageRuntime) {
  const { resolvedTheme } = useTheme();
  const [summaries, setSummaries] = useState<AiConversationSummary[]>([]);
  const [expandedThreadGroupIds, setExpandedThreadGroupIds] = useState<
    Set<ThreadCategoryId>
  >(new Set());
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [aiDockReady, setAiDockReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(286);
  const aiDockApiRef = useRef<DockviewApi | null>(null);
  const aiDockDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const aiChatPanelRecordsRef = useRef<Map<string, AiChatPanelRecord>>(
    new Map(),
  );
  const aiNewChatSequenceRef = useRef(0);
  const initialChatOpenedRef = useRef(false);
  const lastExternalChatRequestRef = useRef<string | null>(null);
  const threadGroups = useMemo(
    () => groupThreads(summaries, expandedThreadGroupIds),
    [expandedThreadGroupIds, summaries],
  );
  const pageGridStyle: CSSProperties = {
    gridTemplateColumns: sidebarCollapsed
      ? "0px 0px minmax(0,1fr)"
      : `${sidebarWidth}px 6px minmax(0,1fr)`,
  };
  const externalChatRequestKey = useMemo(() => {
    if (!aiConversationId && !aiInitialContextAttachments.length) {
      return null;
    }

    return JSON.stringify({
      context: aiInitialContextAttachments,
      conversationId: aiConversationId ?? null,
      requestId: aiOpenRequestId ?? null,
    });
  }, [aiConversationId, aiInitialContextAttachments, aiOpenRequestId]);

  const refreshHistory = useCallback(() => {
    void aiConversationsList()
      .then(setSummaries)
      .catch(() => setSummaries([]));
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const updateChatPanelConversation = useCallback(
    (panelId: string, conversation: AiConversation) => {
      const record = aiChatPanelRecordsRef.current.get(panelId);
      if (record) {
        record.conversationId = conversation.id;
      } else {
        aiChatPanelRecordsRef.current.set(panelId, {
          conversationId: conversation.id,
          panelId,
        });
      }

      const title = conversation.title || "AI";
      const api = aiDockApiRef.current;
      api?.getPanel(panelId)?.api.setTitle(title);

      if (api?.activePanel?.id === panelId) {
        setActiveConversationId(conversation.id);
      }

      refreshHistory();
    },
    [refreshHistory],
  );

  const openChatPanel = useCallback(
    ({
      contextAttachments = [],
      conversationId = null,
      title = "AI",
    }: {
      contextAttachments?: AiContextAttachmentInput[];
      conversationId?: string | null;
      title?: string;
    } = {}) => {
      const api = aiDockApiRef.current;
      if (!api) {
        return;
      }

      if (conversationId) {
        const existingRecord = getChatPanelRecordForConversation(
          aiChatPanelRecordsRef.current,
          conversationId,
        );
        const existingPanel = existingRecord
          ? api.getPanel(existingRecord.panelId)
          : null;

        if (existingPanel) {
          existingPanel.api.setActive();
          setActiveConversationId(conversationId);
          return;
        }
      }

      const panelId = conversationId
        ? getAiConversationPanelId(conversationId)
        : getAiNewChatPanelId(aiNewChatSequenceRef.current++);
      const render = () => (
        <AiSurface
          conversationId={conversationId}
          initialContextAttachments={contextAttachments}
          initialTitle={title}
          onConversationReady={(conversation) =>
            updateChatPanelConversation(panelId, conversation)
          }
          onConversationUpdated={(conversation) =>
            updateChatPanelConversation(panelId, conversation)
          }
          onOpenSettings={() => openPageInNewTab?.("settings")}
          showHeader={false}
        />
      );
      const referencePanel = api.activePanel;
      const panel = api.addPanel<AiDockPanelParams>({
        component: "aiPanel",
        id: panelId,
        minimumHeight: 260,
        minimumWidth: 360,
        params: { conversationId, kind: "chat", render },
        position: referencePanel
          ? { direction: "within", referencePanel }
          : undefined,
        title,
      });

      aiChatPanelRecordsRef.current.set(panelId, {
        conversationId,
        panelId,
      });
      panel.api.setActive();
      setActiveConversationId(conversationId);
    },
    [openPageInNewTab, updateChatPanelConversation],
  );

  const startNewChat = useCallback(() => {
    openChatPanel({ title: "AI" });
  }, [openChatPanel]);

  const openThread = useCallback(
    (summary: AiConversationSummary) => {
      openChatPanel({
        conversationId: summary.id,
        title: summary.title,
      });
    },
    [openChatPanel],
  );

  const toggleThreadGroup = useCallback((groupId: ThreadCategoryId) => {
    setExpandedThreadGroupIds((currentGroupIds) => {
      const nextGroupIds = new Set(currentGroupIds);

      if (nextGroupIds.has(groupId)) {
        nextGroupIds.delete(groupId);
      } else {
        nextGroupIds.add(groupId);
      }

      return nextGroupIds;
    });
  }, []);

  const deleteThread = useCallback(
    async (conversationId: string) => {
      setDeletingThreadId(conversationId);

      try {
        await agentInterrupt(conversationId).catch(() => {});
        const deleted = await aiConversationDelete(conversationId);

        if (deleted) {
          removeChatPanelsForConversation(
            aiDockApiRef.current,
            aiChatPanelRecordsRef.current,
            conversationId,
          );
          setSummaries((currentSummaries) =>
            currentSummaries.filter((summary) => summary.id !== conversationId),
          );
          setActiveConversationId((current) =>
            current === conversationId ? null : current,
          );
        }
      } finally {
        setDeletingThreadId((currentId) =>
          currentId === conversationId ? null : currentId,
        );
        refreshHistory();
      }
    },
    [refreshHistory],
  );

  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = event.currentTarget.parentElement;

      if (!container) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const resize = (clientX: number) => {
        const rect = container.getBoundingClientRect();
        const minSidebarWidth = 232;
        const maxSidebarWidth = Math.max(
          minSidebarWidth,
          Math.min(520, rect.width - 420),
        );
        const nextWidth = clientX - rect.left;

        setSidebarWidth(
          Math.max(
            minSidebarWidth,
            Math.min(maxSidebarWidth, Math.round(nextWidth)),
          ),
        );
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        resize(moveEvent.clientX);
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      resize(event.clientX);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [],
  );

  const handleAiDockReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event;
    aiDockApiRef.current = api;
    aiDockDisposablesRef.current.forEach((disposable) => disposable.dispose());
    aiDockDisposablesRef.current = [
      api.onDidRemovePanel((panel) => {
        const removedRecord = aiChatPanelRecordsRef.current.get(panel.id);
        aiChatPanelRecordsRef.current.delete(panel.id);

        if (aiChatPanelRecordsRef.current.size === 0) {
          setSidebarCollapsed(false);
        }

        if (removedRecord?.conversationId) {
          setActiveConversationId((current) =>
            current === removedRecord.conversationId ? null : current,
          );
        }
      }),
      api.onDidActivePanelChange((panel) => {
        const record = panel
          ? aiChatPanelRecordsRef.current.get(panel.id)
          : null;
        setActiveConversationId(record?.conversationId ?? null);
      }),
    ];
    setAiDockReady(true);
  }, []);

  useEffect(
    () => () => {
      aiDockDisposablesRef.current.forEach((disposable) =>
        disposable.dispose(),
      );
      aiDockDisposablesRef.current = [];
      aiDockApiRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!aiDockReady) {
      return;
    }

    if (!initialChatOpenedRef.current) {
      initialChatOpenedRef.current = true;
      lastExternalChatRequestRef.current = externalChatRequestKey;
      openChatPanel({
        contextAttachments: aiInitialContextAttachments,
        conversationId: aiConversationId ?? null,
        title: "AI",
      });
      return;
    }

    if (
      externalChatRequestKey &&
      lastExternalChatRequestRef.current !== externalChatRequestKey
    ) {
      lastExternalChatRequestRef.current = externalChatRequestKey;
      openChatPanel({
        contextAttachments: aiInitialContextAttachments,
        conversationId: aiConversationId ?? null,
        title: "AI",
      });
    }
  }, [
    aiConversationId,
    aiDockReady,
    aiInitialContextAttachments,
    externalChatRequestKey,
    openChatPanel,
  ]);

  const AiDockPrefixActions = useMemo(
    () =>
      function AiDockPrefixActions(_props: IDockviewHeaderActionsProps) {
        if (!sidebarCollapsed) {
          return null;
        }

        return (
          <Button
            aria-label="Show recent threads"
            className={`${aiSidebarTabRowButtonClassName} mx-1`}
            onClick={() => setSidebarCollapsed(false)}
            size="none"
            title="Show recent threads"
            variant="bare"
          >
            <PanelLeftOpen aria-hidden="true" size={14} strokeWidth={1.8} />
          </Button>
        );
      },
    [sidebarCollapsed],
  );

  return (
    <div
      className="grid h-full min-h-0 min-w-0 overflow-hidden bg-cg-editor transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none [container-type:inline-size]"
      style={pageGridStyle}
    >
      <aside
        aria-hidden={sidebarCollapsed ? true : undefined}
        aria-label="Recent threads"
        className={`grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-cg-sidebar transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
          sidebarCollapsed
            ? "pointer-events-none -translate-x-2 opacity-0"
            : "translate-x-0 opacity-100"
        }`}
        inert={sidebarCollapsed ? true : undefined}
      >
        <div className="border-b border-cg-border bg-cg-titlebar px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-none text-cg-fg">
              Recent Threads
            </span>
            <Button
              className="size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-cg-sidebar-hover hover:text-cg-fg"
              onClick={startNewChat}
              size="none"
              title="New chat"
              variant="bare"
            >
              <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
            </Button>
            <Button
              aria-label="Hide recent threads"
              className={aiSidebarIconButtonClassName}
              onClick={() => setSidebarCollapsed(true)}
              size="none"
              title="Hide recent threads"
              variant="bare"
            >
              <PanelLeftClose aria-hidden="true" size={14} strokeWidth={1.8} />
            </Button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto px-2 py-2.5">
          {threadGroups.length ? (
            <div className="grid gap-4">
              {threadGroups.map((group) => (
                <ThreadGroupSection
                  group={group}
                  key={group.id}
                  onDelete={deleteThread}
                  onOpen={openThread}
                  onToggleExpanded={toggleThreadGroup}
                  deletingThreadId={deletingThreadId}
                  selectedId={activeConversationId}
                />
              ))}
            </div>
          ) : (
            <div className="h-full" aria-hidden="true" />
          )}
        </div>
      </aside>

      <div
        aria-hidden={sidebarCollapsed ? true : undefined}
        aria-label={sidebarCollapsed ? undefined : "Resize AI chat threads"}
        aria-orientation={sidebarCollapsed ? undefined : "vertical"}
        aria-valuemax={sidebarCollapsed ? undefined : 520}
        aria-valuemin={sidebarCollapsed ? undefined : 232}
        aria-valuenow={sidebarCollapsed ? undefined : sidebarWidth}
        className={`group flex items-center justify-center overflow-hidden bg-cg-titlebar transition-opacity duration-150 ease-out motion-reduce:transition-none ${
          sidebarCollapsed
            ? "pointer-events-none cursor-default border-r-0 opacity-0"
            : "cursor-col-resize border-r border-cg-border opacity-100"
        }`}
        onPointerDown={
          sidebarCollapsed ? undefined : handleSidebarResizePointerDown
        }
        role={sidebarCollapsed ? undefined : "separator"}
        title={sidebarCollapsed ? undefined : "Resize AI chat threads"}
      >
        <span className="h-10 w-px bg-cg-border-strong group-hover:bg-cg-accent" />
      </div>

      <div className="h-full min-h-0 min-w-0 bg-cg-editor">
        <DockviewReact
          components={AI_DOCK_PANEL_COMPONENTS}
          dndStrategy="pointer"
          noPanelsOverlay="emptyGroup"
          onReady={handleAiDockReady}
          prefixHeaderActionsComponent={AiDockPrefixActions}
          tabComponents={AI_DOCK_TAB_COMPONENTS}
          theme={dockviewThemeByMode[resolvedTheme]}
        />
      </div>
    </div>
  );
}

function getAiConversationPanelId(conversationId: string) {
  return `ai-conversation:${encodeURIComponent(conversationId)}`;
}

function getAiNewChatPanelId(sequence: number) {
  return `ai-new:${sequence}`;
}

function getChatPanelRecordForConversation(
  records: Map<string, AiChatPanelRecord>,
  conversationId: string,
) {
  for (const record of records.values()) {
    if (record.conversationId === conversationId) {
      return record;
    }
  }

  return null;
}

function removeChatPanelsForConversation(
  api: DockviewApi | null,
  records: Map<string, AiChatPanelRecord>,
  conversationId: string,
) {
  if (!api) {
    return;
  }

  for (const record of Array.from(records.values())) {
    if (record.conversationId !== conversationId) {
      continue;
    }

    const panel = api.getPanel(record.panelId);
    if (panel) {
      api.removePanel(panel);
    }
    records.delete(record.panelId);
  }
}

function ThreadGroupSection({
  deletingThreadId,
  group,
  onDelete,
  onOpen,
  onToggleExpanded,
  selectedId,
}: {
  deletingThreadId: string | null;
  group: ThreadGroup;
  onDelete: (id: string) => void;
  onOpen: (summary: AiConversationSummary) => void;
  onToggleExpanded: (id: ThreadCategoryId) => void;
  selectedId: string | null;
}) {
  const { Icon } = group;
  const canToggleExpanded = group.totalCount > THREAD_CATEGORY_LIMIT;
  return (
    <section className="grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center gap-1.5 px-2 text-[10.5px] font-semibold uppercase leading-none tracking-wide text-cg-muted">
        <Icon aria-hidden="true" size={12} strokeWidth={1.85} />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        <span className="font-mono text-[10px] font-medium tracking-normal">
          {group.hiddenCount > 0
            ? `${group.threads.length}/${group.totalCount}`
            : group.totalCount}
        </span>
      </div>
      <div className="grid">
        {group.threads.map((summary) => (
          <ThreadRow
            deleting={summary.id === deletingThreadId}
            key={summary.id}
            onDelete={onDelete}
            onOpen={onOpen}
            selected={summary.id === selectedId}
            summary={summary}
          />
        ))}
        {canToggleExpanded ? (
          <button
            aria-expanded={group.expanded}
            className="ml-[9px] mt-1 inline-flex w-fit appearance-none items-center gap-1 border-0 bg-transparent px-0 py-1 font-[inherit] text-[10.5px] font-semibold leading-none text-cg-muted outline-none transition-colors hover:text-cg-fg focus-visible:text-cg-fg focus-visible:underline focus-visible:decoration-cg-focus focus-visible:underline-offset-2"
            onClick={() => onToggleExpanded(group.id)}
            type="button"
          >
            {group.expanded ? "Show less" : `Show ${group.hiddenCount} more`}
            <ChevronRight
              aria-hidden="true"
              className={cx(
                "transition-transform",
                group.expanded ? "-rotate-90" : "rotate-90",
              )}
              size={12}
              strokeWidth={1.8}
            />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ThreadRow({
  deleting,
  onDelete,
  onOpen,
  selected,
  summary,
}: {
  deleting: boolean;
  onDelete: (id: string) => void;
  onOpen: (summary: AiConversationSummary) => void;
  selected: boolean;
  summary: AiConversationSummary;
}) {
  const source = threadSourceLabel(summary);
  const relativeTime = formatRelativeTime(summary.updatedAt);
  const exactTime = formatExactTime(summary.updatedAt);
  const detailClassName = cx(
    "text-cg-muted transition-colors group-hover/thread:text-cg-sidebar-fg",
  );

  return (
    <div
      className={cx(
        "group/thread relative grid min-w-0 grid-cols-[5px_minmax(0,1fr)] gap-2.5 bg-transparent py-3 pl-1 pr-1 transition-opacity before:absolute before:left-[18px] before:right-1 before:top-0 before:h-px before:bg-[linear-gradient(90deg,color-mix(in_srgb,var(--cg-border),transparent_66%),color-mix(in_srgb,var(--cg-border),transparent_90%))] first:before:hidden",
        deleting && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "my-0.5 min-h-8 w-[2px] justify-self-center self-stretch rounded-full transition-colors",
          selected
            ? "bg-cg-accent"
            : "bg-[color-mix(in_srgb,var(--cg-border-strong),transparent_88%)] group-hover/thread:bg-[color-mix(in_srgb,var(--cg-border-strong),transparent_64%)]",
        )}
      />
      <button
        aria-current={selected ? "page" : undefined}
        className="grid min-w-0 cursor-default appearance-none gap-1 border-0 bg-transparent p-0 text-left font-[inherit] text-cg-sidebar-fg outline-none transition-colors hover:text-cg-fg active:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cg-focus"
        disabled={deleting}
        onClick={() => onOpen(summary)}
        title={`${summary.title}${source ? ` - ${source}` : ""}${exactTime ? ` - ${exactTime}` : ""}`}
        type="button"
      >
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <span
            className={cx(
              "min-w-0 truncate text-[12px] font-medium leading-tight transition-colors",
              selected && "text-cg-fg",
            )}
          >
            {summary.title}
          </span>
          {relativeTime ? (
            <span
              className={cx(
                "text-[10px] font-medium leading-none transition-opacity group-focus-within/thread:opacity-0 group-hover/thread:opacity-0",
                detailClassName,
              )}
            >
              {relativeTime}
            </span>
          ) : null}
        </span>
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <span
            className={cx(
              "min-w-0 truncate text-[10.5px] font-medium leading-tight",
              detailClassName,
            )}
          >
            {source}
          </span>
          <span className="text-[10px] font-medium leading-none text-cg-muted transition-opacity group-focus-within/thread:opacity-0 group-hover/thread:opacity-0">
            {formatMessageCount(summary.messageCount)}
          </span>
        </span>
      </button>
      <button
        aria-label={`Delete thread: ${summary.title}`}
        className={cx(
          "absolute bottom-1 right-0 top-1 inline-flex w-8 appearance-none items-start justify-end rounded-[5px] border-0 bg-cg-sidebar p-0 pr-0.5 pt-1 text-cg-muted opacity-0 outline-none transition-[color,opacity] duration-150 ease-out hover:text-cg-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus group-focus-within/thread:opacity-100 group-hover/thread:opacity-100",
          deleting && "text-cg-danger opacity-100",
        )}
        disabled={deleting}
        onClick={() => onDelete(summary.id)}
        title={`Delete thread: ${summary.title}`}
        type="button"
      >
        {deleting ? (
          <LoaderCircle
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
            size={12}
            strokeWidth={1.8}
          />
        ) : (
          <Trash2 aria-hidden="true" size={12} strokeWidth={1.8} />
        )}
      </button>
    </div>
  );
}

function groupThreads(
  summaries: AiConversationSummary[],
  expandedGroupIds: Set<ThreadCategoryId>,
): ThreadGroup[] {
  const buckets = new Map<ThreadCategoryId, AiConversationSummary[]>(
    THREAD_CATEGORY_ORDER.map((id) => [id, []]),
  );

  summaries.forEach((summary) => {
    buckets.get(threadCategoryId(summary))?.push(summary);
  });

  return THREAD_CATEGORY_ORDER.flatMap((id) => {
    const threads = buckets.get(id) ?? [];
    if (!threads.length) {
      return [];
    }
    const category = THREAD_CATEGORIES[id];
    const expanded = expandedGroupIds.has(id);
    const visibleThreads = expanded
      ? threads
      : threads.slice(0, THREAD_CATEGORY_LIMIT);
    return [
      {
        ...category,
        expanded,
        hiddenCount: Math.max(0, threads.length - visibleThreads.length),
        threads: visibleThreads,
        totalCount: threads.length,
      },
    ];
  });
}

function threadCategoryId(_summary: AiConversationSummary): ThreadCategoryId {
  return "general";
}

function threadSourceLabel(summary: AiConversationSummary) {
  const primaryAttachment = summary.contextAttachments[0];
  if (primaryAttachment) {
    return compactSourceLabel(primaryAttachment);
  }

  return summary.agentId === "workspace-ai" ? "General chat" : summary.agentId;
}

function compactSourceLabel(attachment: AiContextAttachment) {
  return attachment.label.replace(/^file:\/\//, "");
}

function formatRelativeTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (elapsedSeconds < 45) {
    return "now";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays}d`;
  }

  const date = new Date(time);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatExactTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
}

function formatMessageCount(count: number) {
  return count === 1 ? "1 msg" : `${count} msgs`;
}
