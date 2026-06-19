import { useState } from "react";

import { ConfirmDialog } from "@/features/database/components/ConfirmDialog";
import { DiffSurface } from "@/features/editor/components/DiffView";
import {
  type CheckpointFileDiff,
  type CheckpointSummary,
  workspaceHistoryFileDiff,
} from "@/features/editor/core/history-service";
import type { TextEditorSettings } from "@/features/settings";
import { useAsyncResource } from "@/lib/use-async-resource";
import { Button, CheckCircle2, type ResolvedTheme, RotateCcw } from "@/ui";

type CheckpointDiffTabProps = {
  root: string;
  checkpoint: CheckpointSummary;
  path: string;
  resolvedTheme: ResolvedTheme;
  settings: TextEditorSettings;
  /// Restore just this file to this checkpoint, overwriting the working copy;
  /// refreshes history and reloads the editor. (Confirmed before calling.)
  onRestoreFile: () => Promise<void>;
};

/// A read-only diff tab for one file's change within a past checkpoint (vs. its
/// parent) — the "open a file in a PR" view. The checkpoint message and who
/// recorded it sit at the top (like a PR title + author); restoring this one
/// file lives here too, where you can see exactly what it'll become.
export function CheckpointDiffTab({
  root,
  checkpoint,
  path,
  resolvedTheme,
  settings,
  onRestoreFile,
}: CheckpointDiffTabProps) {
  const [sideBySide, setSideBySide] = useState(true);
  const [restoreState, setRestoreState] = useState<
    "idle" | "restoring" | "done"
  >("idle");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const diffResource = useAsyncResource<CheckpointFileDiff>(
    `${root}::${checkpoint.id}::${path}`,
    () => workspaceHistoryFileDiff(root, checkpoint.id, path),
  );
  const committer = committerLabel(checkpoint);

  const restore = async () => {
    setRestoreState("restoring");
    setRestoreError(null);
    try {
      await onRestoreFile();
      setRestoreState("done");
    } catch (cause) {
      setRestoreState("idle");
      setRestoreError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-cg-editor">
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-cg-border px-3.5 py-3">
        <div className="grid min-w-0 gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-cg-muted">
            Checkpoint
          </span>
          <p className="m-0 min-w-0 text-[12.5px] leading-snug text-cg-fg">
            {checkpoint.message}
          </p>
          <p
            className="m-0 min-w-0 truncate text-[11px] leading-none text-cg-muted"
            title={committer}
          >
            {committer}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {restoreError ? (
            <span className="max-w-[180px] truncate text-[11px] text-cg-danger">
              {restoreError}
            </span>
          ) : restoreState === "done" ? (
            <span className="flex items-center gap-1 text-[11px] text-cg-success">
              <CheckCircle2 aria-hidden="true" size={12} strokeWidth={2} />
              Restored
            </span>
          ) : null}
          <Button
            disabled={restoreState === "restoring"}
            onClick={() => setConfirmOpen(true)}
            size="sm"
            title="Restore just this file to its contents at this checkpoint. Your current edits to it will be replaced."
            variant="subtle"
          >
            <RotateCcw aria-hidden="true" size={11} strokeWidth={1.8} />
            Restore this file
          </Button>
        </div>
      </header>
      <DiffSurface
        diff={diffResource.data}
        error={diffResource.error}
        loading={diffResource.loading}
        onSideBySideChange={setSideBySide}
        path={path}
        resolvedTheme={resolvedTheme}
        settings={settings}
        sideBySide={sideBySide}
      />
      <ConfirmDialog
        confirmLabel="Restore this file"
        description={`Restore "${diffTabFileName(path)}" to its contents at this checkpoint. Your current, uncommitted edits to this file will be replaced.`}
        onConfirm={() => {
          setConfirmOpen(false);
          void restore();
        }}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title="Restore this file?"
      />
    </section>
  );
}

function diffTabFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/// "Name · email", or just the name when no email is recorded.
function committerLabel(checkpoint: CheckpointSummary) {
  return checkpoint.committerEmail
    ? `${checkpoint.committerName} · ${checkpoint.committerEmail}`
    : checkpoint.committerName;
}
