import { type ReactNode, useCallback, useState } from "react";

import { DiffSurface } from "@/features/editor/components/DiffView";
import {
  type CheckpointChange,
  type CheckpointFileDiff,
  workspaceHistoryCheckpointSelective,
  workspaceHistoryWorkingChanges,
  workspaceHistoryWorkingFileDiff,
} from "@/features/editor/core/history-service";
import type { TextEditorSettings } from "@/features/settings";
import { useAsyncResource } from "@/lib/use-async-resource";
import { Plus, type ResolvedTheme } from "@/ui";

/// The commit action, as a desktop "primary outline": accent border + text, no
/// fill, with only a faint accent wash on hover.
const commitButtonClassName =
  "inline-flex h-8 w-fit cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-cg-accent bg-transparent px-3 font-[inherit] text-[12px] font-bold leading-none text-cg-accent transition-colors duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--cg-accent),transparent_88%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none";

type CheckpointReviewProps = {
  root: string;
  resolvedTheme: ResolvedTheme;
  settings: TextEditorSettings;
  /// Bump the History list (a new checkpoint was recorded).
  onSaved: () => void;
  /// Close this review tab.
  onClose: () => void;
};

/// "git add + open a PR": review the working changes since the last checkpoint,
/// tick which files to include, see each file's diff, and save a checkpoint
/// containing only the chosen files. Everything left unticked stays as ordinary
/// uncommitted work.
export function CheckpointReview({
  root,
  resolvedTheme,
  settings,
  onSaved,
  onClose,
}: CheckpointReviewProps) {
  // Selection is modeled as the set the user explicitly *unticked*, so the
  // default (all selected) needs no initialization from the async load — which
  // keeps loading effect-free (no synchronous setState).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const changesResource = useAsyncResource<CheckpointChange[]>(root, () =>
    workspaceHistoryWorkingChanges(root),
  );
  const changes = changesResource.data;

  const focused = focusedPath ?? changes?.[0]?.path ?? null;
  const diffResource = useAsyncResource<CheckpointFileDiff>(focused, (path) =>
    workspaceHistoryWorkingFileDiff(root, path),
  );

  const toggle = useCallback((path: string) => {
    setDeselected((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const selectedPaths = (changes ?? [])
    .map((change) => change.path)
    .filter((path) => !deselected.has(path));

  const create = useCallback(async () => {
    if (selectedPaths.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const message = label.trim() || autoCheckpointMessage();
      const created = await workspaceHistoryCheckpointSelective(
        root,
        message,
        selectedPaths,
      );
      if (!created) {
        setNotice("Those files match the last checkpoint — nothing to save.");
        setBusy(false);
        return;
      }
      onSaved();
      onClose();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }, [busy, label, onClose, onSaved, root, selectedPaths]);

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-cg-editor">
      <header className="grid min-w-0 gap-3 border-b border-cg-border px-3.5 py-3">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <h2 className="m-0 text-[13px] font-bold leading-none text-cg-fg">
            Review &amp; save changes
          </h2>
          <span className="flex-none text-[11px] leading-none text-cg-muted">
            {changes === null
              ? "Looking for changes…"
              : changes.length === 0
                ? "Up to date"
                : `${changes.length} ${
                    changes.length === 1 ? "file" : "files"
                  } changed`}
          </span>
        </div>

        {changes && changes.length > 0 ? (
          <div className="grid gap-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <input
                aria-label="Checkpoint name (optional)"
                className="h-8 min-w-0 flex-1 rounded-[7px] border border-cg-border bg-cg-editor px-3 font-[inherit] text-[12px] leading-none text-cg-fg outline-none placeholder:text-cg-muted focus-visible:border-cg-focus"
                disabled={busy}
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void create();
                  }
                }}
                placeholder="Name this checkpoint (optional)"
                value={label}
              />
              <button
                className={commitButtonClassName}
                disabled={busy || selectedPaths.length === 0}
                onClick={() => void create()}
                type="button"
              >
                <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
                Create checkpoint
              </button>
            </div>
            <p className="m-0 text-[11px] leading-snug text-cg-muted">
              {notice ??
                (selectedPaths.length === 0
                  ? "Select at least one file to save."
                  : `Saving ${selectedPaths.length} of ${changes.length} changed ${
                      changes.length === 1 ? "file" : "files"
                    }. The rest stay as unsaved work.`)}
            </p>
          </div>
        ) : null}
      </header>

      {changesResource.error ? (
        <Centered tone="danger">{changesResource.error}</Centered>
      ) : !changes ? (
        <Centered>Looking for changes…</Centered>
      ) : changes.length === 0 ? (
        <Centered>
          Nothing to save — your work matches the last checkpoint.
        </Centered>
      ) : (
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
          <aside className="min-h-0 min-w-0 overflow-y-auto border-r border-cg-border p-2">
            <ul className="m-0 grid list-none content-start gap-1">
              {changes.map((change) => (
                <li key={change.path}>
                  <div
                    className="flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 hover:bg-cg-surface-hover data-[focused=true]:bg-cg-surface-hover"
                    data-focused={focused === change.path}
                  >
                    <input
                      aria-label={`Include ${change.path}`}
                      checked={!deselected.has(change.path)}
                      className="size-3.5 flex-none cursor-pointer accent-[var(--cg-accent)]"
                      onChange={() => toggle(change.path)}
                      type="checkbox"
                    />
                    <button
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left font-[inherit]"
                      onClick={() => setFocusedPath(change.path)}
                      type="button"
                    >
                      <StatusLetter status={change.status} />
                      <span
                        className="min-w-0 flex-1 truncate text-[12px] text-cg-fg"
                        title={change.path}
                      >
                        {change.path}
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          {focused ? (
            <DiffSurface
              diff={diffResource.data}
              error={diffResource.error}
              loading={diffResource.loading}
              onSideBySideChange={setSideBySide}
              path={focused}
              resolvedTheme={resolvedTheme}
              settings={settings}
              sideBySide={sideBySide}
            />
          ) : (
            <Centered>Select a file to see what changed.</Centered>
          )}
        </div>
      )}
    </section>
  );
}

function StatusLetter({ status }: { status: string }) {
  const letter =
    status === "added"
      ? "A"
      : status === "deleted"
        ? "D"
        : status === "renamed"
          ? "R"
          : "M";
  const tone =
    status === "added"
      ? "text-cg-success"
      : status === "deleted"
        ? "text-cg-danger"
        : "text-cg-warning";
  return (
    <span
      aria-hidden="true"
      className={`flex-none font-mono text-[11px] font-bold ${tone}`}
    >
      {letter}
    </span>
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
        className={`m-0 max-w-[320px] text-center text-[12px] leading-snug ${
          tone === "danger" ? "text-cg-danger" : "text-cg-muted"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

/// Prose fallback for an unnamed checkpoint — durable enough to read well in
/// `git log` rather than a terse stamp.
function autoCheckpointMessage() {
  const date = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `Checkpoint saved from the editor on ${date}.`;
}
