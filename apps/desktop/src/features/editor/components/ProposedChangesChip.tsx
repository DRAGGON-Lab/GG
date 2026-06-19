/// The batch control for the agent's proposed changes: a compact chip in the
/// editor titlebar (beside Unsaved / Read-only) that appears only while the open
/// file has pending changes. The per-hunk inline Accept / Reject widgets are the
/// primary interaction; this is the escape hatch for accept-all / reject-all and
/// hunk navigation, plus a pointer to changes waiting in other files.
///
/// The popover open state is controlled and the action buttons are plain buttons
/// that run their action then close — `Popover.Close` overrides (rather than
/// merges) the click handler, so its `onClick` never fires.
import { useMemo, useState } from "react";

import {
  acceptAllForUri,
  rejectAllForUri,
  revealChange,
  useProposedChanges,
  useProposedChangesForUri,
} from "@/features/editor/core/proposed-changes-store";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Popover,
  X,
} from "@/ui";

type ProposedChangesChipProps = {
  documentUri: string | null;
  onNext: () => void;
  onPrevious: () => void;
};

const chipActionClassName =
  "flex w-full items-center justify-between gap-3 rounded-[6px] px-2 py-1.5 text-[12px] font-semibold text-cg-fg transition-colors hover:bg-cg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cg-focus";

const chipKbdClassName = "font-mono text-[10.5px] font-medium text-cg-muted";

export function ProposedChangesChip({
  documentUri,
  onNext,
  onPrevious,
}: ProposedChangesChipProps) {
  const [open, setOpen] = useState(false);
  const all = useProposedChanges();
  const forFile = useProposedChangesForUri(documentUri);

  const pendingHere = useMemo(
    () => forFile.filter((change) => change.status === "pending"),
    [forFile],
  );
  const pendingElsewhere = useMemo(
    () =>
      all.filter(
        (change) => change.status === "pending" && change.uri !== documentUri,
      ),
    [all, documentUri],
  );

  if (pendingHere.length === 0 || !documentUri) {
    return null;
  }

  const count = pendingHere.length;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <button
            className="flex flex-none items-center gap-1 rounded-[6px] border border-[color-mix(in_srgb,var(--cg-accent),var(--cg-border)_55%)] bg-[color-mix(in_srgb,var(--cg-accent),transparent_90%)] px-1.5 py-0.5 text-[10.5px] font-semibold text-cg-accent transition-colors hover:bg-[color-mix(in_srgb,var(--cg-accent),transparent_82%)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cg-focus"
            title="Review the agent's proposed changes"
            type="button"
          >
            <span>
              {count} proposed change{count === 1 ? "" : "s"}
            </span>
            <ChevronDown aria-hidden="true" size={12} strokeWidth={1.9} />
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          collisionPadding={10}
          side="bottom"
          sideOffset={7}
        >
          <Popover.Popup
            className="z-[2000] grid w-[min(280px,calc(100vw_-_24px))] gap-0.5 rounded-[7px] border border-cg-border bg-[color-mix(in_srgb,var(--cg-surface),var(--cg-editor-bg)_22%)] p-1.5 text-cg-fg shadow-[0_18px_50px_rgb(0_0_0_/_16%)] focus-visible:outline-none dark:shadow-[0_18px_50px_rgb(0_0_0_/_36%)]"
            initialFocus={false}
          >
            <button
              className={chipActionClassName}
              onClick={() => {
                acceptAllForUri(documentUri);
                setOpen(false);
              }}
              type="button"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2
                  aria-hidden="true"
                  className="text-cg-success"
                  size={14}
                  strokeWidth={2}
                />
                Accept all
              </span>
              <kbd className={chipKbdClassName}>⌘⇧Y</kbd>
            </button>
            <button
              className={chipActionClassName}
              onClick={() => {
                rejectAllForUri(documentUri);
                setOpen(false);
              }}
              type="button"
            >
              <span className="flex items-center gap-2">
                <X
                  aria-hidden="true"
                  className="text-cg-danger"
                  size={14}
                  strokeWidth={2}
                />
                Reject all
              </span>
              <kbd className={chipKbdClassName}>⌘⇧N</kbd>
            </button>
            <div className="my-0.5 h-px bg-cg-border" />
            <button
              className={chipActionClassName}
              onClick={onNext}
              type="button"
            >
              <span className="flex items-center gap-2">
                <ArrowDown aria-hidden="true" size={14} strokeWidth={1.9} />
                Next change
              </span>
              <kbd className={chipKbdClassName}>F7</kbd>
            </button>
            <button
              className={chipActionClassName}
              onClick={onPrevious}
              type="button"
            >
              <span className="flex items-center gap-2">
                <ArrowUp aria-hidden="true" size={14} strokeWidth={1.9} />
                Previous change
              </span>
              <kbd className={chipKbdClassName}>⇧F7</kbd>
            </button>
            {pendingElsewhere.length > 0 ? (
              <>
                <div className="my-0.5 h-px bg-cg-border" />
                <button
                  className={`${chipActionClassName} text-cg-muted`}
                  onClick={() => {
                    revealChange(pendingElsewhere[0].id);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <span>
                    {pendingElsewhere.length} in other file
                    {pendingElsewhere.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-[10.5px]">Open</span>
                </button>
              </>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
