import { type ReactNode, useCallback, useState } from "react";

import { ConfirmDialog } from "@/features/database/components/ConfirmDialog";
import {
  type CheckpointChange,
  type CheckpointSummary,
  type HistoryStatus,
  workspaceHistoryChanges,
  workspaceHistoryDiscardWorkingChanges,
  workspaceHistoryList,
  workspaceHistoryRestoreWorkspace,
  workspaceHistoryStatus,
  workspaceHistoryWorkingChanges,
} from "@/features/editor/core/history-service";
import {
  type HistoryManager,
  useEditorPageContext,
} from "@/features/editor/editor-page-context";
import { useAsyncResource } from "@/lib/use-async-resource";
import {
  ArrowUpRight,
  Button,
  ChevronRight,
  FileText,
  History,
  Menu,
  MoreHorizontal,
  RotateCcw,
  SquareSplitHorizontal,
  Trash2,
} from "@/ui";

/// Flat-until-hover panel action: hollow (matches the editor surface), compact,
/// icon + short label; the accent border only appears on hover. `data-active`
/// (the review tab is open) gives a faint accent tint so it reads as the live
/// link back.
const historyReviewButtonClassName =
  "inline-flex h-8 w-fit cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-cg-border bg-cg-editor px-3 text-[11.5px] font-bold leading-none text-cg-fg transition-colors duration-150 ease-out hover:border-cg-accent hover:bg-cg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus disabled:pointer-events-none disabled:opacity-45 data-[active=true]:border-[color-mix(in_srgb,var(--cg-accent),var(--cg-border)_45%)] data-[active=true]:text-cg-accent motion-reduce:transition-none";

/// A git manager for the active workspace. Never says "git" in the timeline:
/// the user sees a calm list of checkpoints (commits) they made, with a
/// "Review & save" entry into the full diff-and-stage surface. Works the same
/// for any repo.
export function HistoryPanel() {
  const { history } = useEditorPageContext();

  if (!history) {
    return <Centered>Open a folder to see its history.</Centered>;
  }

  return <HistoryBody history={history} />;
}

function HistoryBody({ history }: { history: HistoryManager }) {
  // The panel is driven by live repo status (re-read whenever `epoch` bumps),
  // not a persisted flag: a repo shows its real timeline; a plain folder offers
  // to initialize one.
  const statusResource = useAsyncResource<HistoryStatus>(
    `status:${history.root}:${history.epoch}`,
    () => workspaceHistoryStatus(history.root),
  );

  if (statusResource.error) {
    return <Centered tone="danger">{statusResource.error}</Centered>;
  }
  if (!statusResource.data) {
    return <Centered>Checking…</Centered>;
  }
  if (statusResource.data.isRepo) {
    return <Timeline history={history} />;
  }
  return <InitPrompt history={history} />;
}

/// A folder with no git repository yet. Offer to initialize one — after which
/// the full history experience is identical to any other repo.
function InitPrompt({ history }: { history: HistoryManager }) {
  const folder = history.root.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const [busy, setBusy] = useState(false);

  const init = async () => {
    setBusy(true);
    try {
      // On success `epoch` bumps and this prompt is replaced by the timeline.
      await history.onInitRepo();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-cg-editor px-6">
      <div className="grid max-w-[300px] justify-items-center gap-2 text-center">
        <History
          aria-hidden="true"
          className="text-cg-muted opacity-60"
          size={28}
          strokeWidth={1.6}
        />
        <h3 className="m-0 text-[13px] font-bold text-cg-fg">
          {folder || "This folder"} isn&rsquo;t a git repository yet
        </h3>
        <p className="m-0 text-[11.5px] leading-snug text-cg-muted">
          Initialize git here to track your work, review changes, and restore
          earlier versions — all from this panel.
        </p>
        <Button
          className="mt-1"
          disabled={busy}
          onClick={() => void init()}
          size="sm"
          variant="default"
        >
          Initialize git
        </Button>
      </div>
    </div>
  );
}

function Timeline({ history }: { history: HistoryManager }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const { epoch, root } = history;

  // Re-read the timeline and the uncommitted-change count whenever something
  // changes them: a save from the review tab or a restore bumps `epoch`, which
  // re-keys both resources.
  const listResource = useAsyncResource<CheckpointSummary[]>(
    `list:${root}:${epoch}`,
    () => workspaceHistoryList(root, 100),
  );
  const workingResource = useAsyncResource<CheckpointChange[]>(
    `working:${root}:${epoch}`,
    () => workspaceHistoryWorkingChanges(root),
  );
  const checkpoints = listResource.data;
  const workingCount = workingResource.data?.length ?? null;

  const restoreWorkspace = useCallback(
    async (checkpointId: string) => {
      setBusy(true);
      setNotice(null);
      try {
        await workspaceHistoryRestoreWorkspace(root, checkpointId);
        await history.onAfterRestore(true);
        history.refresh();
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [history, root],
  );

  // Discard everything uncommitted, returning the worktree to the last
  // checkpoint. Same after-effects as a full restore, since both rewrite the
  // working tree.
  const discardWorkingChanges = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      await workspaceHistoryDiscardWorkingChanges(root);
      await history.onAfterRestore(true);
      history.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [history, root]);

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-cg-editor">
      <header className="grid flex-none gap-2.5 border-b border-cg-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold leading-none text-cg-fg">
            History
          </span>
          <div className="flex items-center gap-1">
            <button
              className={historyReviewButtonClassName}
              data-active={history.reviewOpen ? "true" : "false"}
              disabled={!history.reviewOpen && !workingCount}
              onClick={() => history.openReview()}
              type="button"
            >
              {history.reviewOpen ? (
                <>
                  <ArrowUpRight
                    aria-hidden="true"
                    size={13}
                    strokeWidth={1.8}
                  />
                  Reviewing
                </>
              ) : (
                <>
                  <SquareSplitHorizontal
                    aria-hidden="true"
                    size={13}
                    strokeWidth={1.8}
                  />
                  Review &amp; save
                </>
              )}
            </button>
            <HistoryHeaderMenu
              disabled={busy || !workingCount}
              onDiscard={() => setConfirmDiscard(true)}
            />
          </div>
        </div>
        <p className="m-0 text-[11px] leading-snug text-cg-muted">
          {notice ?? reviewStatusLine(history.reviewOpen, workingCount)}
        </p>
      </header>

      <ConfirmDialog
        confirmLabel="Discard changes"
        description="Revert every edited file to its state at the last checkpoint. New files you've added since aren't touched. This can't be undone."
        onConfirm={() => {
          setConfirmDiscard(false);
          void discardWorkingChanges();
        }}
        onOpenChange={setConfirmDiscard}
        open={confirmDiscard}
        title="Discard all changes?"
      />

      <div className="min-h-0 min-w-0 overflow-y-auto px-1.5 py-1.5">
        {listResource.error ? (
          <Centered tone="danger">{listResource.error}</Centered>
        ) : !checkpoints ? (
          <Centered>Loading history…</Centered>
        ) : checkpoints.length === 0 ? (
          <Centered>
            No checkpoints yet. Make changes, then save one you can return to.
          </Centered>
        ) : (
          checkpoints.map((checkpoint, index) => {
            const day = dayLabel(checkpoint.createdAtUnix);
            const showDay =
              index === 0 ||
              dayLabel(checkpoints[index - 1].createdAtUnix) !== day;
            return (
              <div key={checkpoint.id}>
                {showDay ? (
                  <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-cg-muted">
                    {day}
                  </div>
                ) : null}
                <CheckpointRow
                  busy={busy}
                  checkpoint={checkpoint}
                  history={history}
                  onRestoreWorkspace={restoreWorkspace}
                />
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function CheckpointRow({
  busy,
  checkpoint,
  history,
  onRestoreWorkspace,
}: {
  busy: boolean;
  checkpoint: CheckpointSummary;
  history: HistoryManager;
  onRestoreWorkspace: (checkpointId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [changes, setChanges] = useState<CheckpointChange[] | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((open) => !open);
    if (!changes) {
      void workspaceHistoryChanges(history.root, checkpoint.id)
        .then(setChanges)
        .catch(() => setChanges([]));
    }
  }, [changes, checkpoint.id, history.root]);

  return (
    <div className={`rounded-[8px] ${expanded ? "bg-cg-surface" : ""}`}>
      <div
        className={`group flex items-stretch transition-colors duration-150 ease-out hover:bg-cg-surface-hover motion-reduce:transition-none ${
          expanded ? "rounded-t-[8px]" : "rounded-[8px]"
        }`}
      >
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-[8px] border-none bg-transparent py-2.5 pl-2.5 pr-1 text-left font-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cg-focus"
          onClick={toggle}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={`mt-[3px] flex-none text-cg-muted transition-transform duration-150 ease-out motion-reduce:transition-none ${
              expanded ? "rotate-90" : ""
            }`}
            size={12}
            strokeWidth={2}
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span
              className="truncate text-[12px] leading-snug text-cg-fg"
              title={checkpoint.message}
            >
              {checkpoint.message}
            </span>
            <span
              className="truncate text-[10.5px] leading-none text-cg-muted"
              title={`${checkpoint.committerName} · ${checkpoint.committerEmail}`}
            >
              {checkpoint.committerName}
            </span>
          </span>
        </button>
        <div className="flex flex-none flex-col items-end justify-between py-2 pr-1.5">
          <span className="text-[10.5px] tabular-nums leading-none text-cg-muted">
            {timeLabel(checkpoint.createdAtUnix)}
          </span>
          <CheckpointMenu
            busy={busy}
            onRestore={() => setConfirmRestore(true)}
          />
        </div>
      </div>

      <ConfirmDialog
        confirmLabel="Restore"
        description="Restore the whole project to this checkpoint — changed files are overwritten and files added since are removed. Your current, uncommitted changes will be replaced."
        onConfirm={() => {
          setConfirmRestore(false);
          onRestoreWorkspace(checkpoint.id);
        }}
        onOpenChange={setConfirmRestore}
        open={confirmRestore}
        title="Restore to this checkpoint?"
      />

      {expanded ? (
        <div className="grid animate-[app-surface-in_140ms_ease-out] gap-1.5 pb-2.5 pl-[30px] pr-2.5 pt-0.5 motion-reduce:animate-none">
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {(changes ?? []).map((change) => (
              <li
                key={change.path}
                className="flex items-center gap-2 text-[11.5px] leading-snug text-cg-muted"
              >
                <FileText
                  aria-hidden="true"
                  className="flex-none opacity-70"
                  size={12}
                  strokeWidth={1.7}
                />
                <span className="min-w-0 flex-1 truncate" title={change.path}>
                  {change.path}
                </span>
                <button
                  className="flex-none cursor-pointer rounded-[4px] border-none bg-transparent px-1 py-0.5 text-[11px] text-cg-accent hover:underline"
                  onClick={() => history.openDiff(checkpoint, change.path)}
                  type="button"
                >
                  View changes
                </button>
              </li>
            ))}
            {changes && changes.length === 0 ? (
              <li className="text-[11px] text-cg-muted">No file changes.</li>
            ) : null}
            {!changes ? (
              <li className="text-[11px] text-cg-muted">Loading changes…</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/// Per-checkpoint overflow menu. Portals out of the scrolling list (so it never
/// clips) and is the home for checkpoint-level actions.
function CheckpointMenu({
  busy,
  onRestore,
}: {
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label="Checkpoint actions"
        className="grid size-7 cursor-pointer place-items-center rounded-[6px] border-transparent bg-transparent p-0 text-cg-muted outline-0 transition-colors duration-150 ease-out hover:bg-cg-surface-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus data-[popup-open]:bg-cg-surface-hover data-[popup-open]:text-cg-fg motion-reduce:transition-none"
        title="Checkpoint actions"
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          collisionPadding={8}
          side="bottom"
          sideOffset={5}
        >
          <Menu.Popup className="z-[2000] grid min-w-[200px] gap-0.5 rounded-[7px] border border-cg-border bg-cg-surface p-1.5 text-cg-fg shadow-[0_14px_38px_rgb(0_0_0_/_18%)] outline-none dark:shadow-[0_16px_44px_rgb(0_0_0_/_42%)]">
            <Menu.Item
              className="grid min-h-8 cursor-default grid-cols-[14px_minmax(0,1fr)] items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[12px] text-cg-fg outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-cg-surface-hover"
              disabled={busy}
              onClick={onRestore}
            >
              <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
              <span>Restore to this checkpoint</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/// Panel-level overflow menu, beside "Review & save". Home for actions on the
/// working tree as a whole — discarding all uncommitted changes today. Disabled
/// when there is nothing to act on.
function HistoryHeaderMenu({
  disabled,
  onDiscard,
}: {
  disabled: boolean;
  onDiscard: () => void;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label="History actions"
        className="grid size-8 cursor-pointer place-items-center rounded-[6px] border-transparent bg-transparent p-0 text-cg-muted outline-0 transition-colors duration-150 ease-out hover:bg-cg-surface-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus disabled:pointer-events-none disabled:opacity-45 data-[popup-open]:bg-cg-surface-hover data-[popup-open]:text-cg-fg motion-reduce:transition-none"
        disabled={disabled}
        title="History actions"
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          collisionPadding={8}
          side="bottom"
          sideOffset={5}
        >
          <Menu.Popup className="z-[2000] grid min-w-[200px] gap-0.5 rounded-[7px] border border-cg-border bg-cg-surface p-1.5 text-cg-fg shadow-[0_14px_38px_rgb(0_0_0_/_18%)] outline-none dark:shadow-[0_16px_44px_rgb(0_0_0_/_42%)]">
            <Menu.Item
              className="grid min-h-8 cursor-default grid-cols-[14px_minmax(0,1fr)] items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[12px] text-cg-danger outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-cg-surface-hover"
              onClick={onDiscard}
            >
              <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
              <span>Discard all changes…</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Centered({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="grid h-full place-items-center bg-cg-editor px-6">
      <p
        className={`m-0 max-w-[280px] text-center text-[12px] leading-snug ${
          tone === "danger" ? "text-cg-danger" : "text-cg-muted"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function reviewStatusLine(reviewOpen: boolean, count: number | null) {
  if (reviewOpen) {
    return "Reviewing your changes in the editor.";
  }
  if (count === null) {
    return "Checking for changes…";
  }
  if (count === 0) {
    return "Up to date — nothing to review.";
  }
  return `${count} ${count === 1 ? "file" : "files"} changed since the last checkpoint.`;
}

function checkpointDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000);
}

function dayLabel(unixSeconds: number) {
  const date = checkpointDate(unixSeconds);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) {
    return "Today";
  }
  if (isSameDay(date, yesterday)) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timeLabel(unixSeconds: number) {
  return checkpointDate(unixSeconds).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
