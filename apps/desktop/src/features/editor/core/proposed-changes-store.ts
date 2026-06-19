/// Module-scope store for the agent's *proposed changes* — the Cursor-style
/// pending edits that land in the buffer immediately and wait for the user to
/// accept or reject them. Lives at module scope (not React context) because it
/// must survive StrictMode double-mounts and dockview panel remounts, and
/// separate trees subscribe to it (the editor's inline diff and the titlebar
/// chip).
///
/// This module is deliberately **Monaco-free** so consumers that may render
/// without Monaco loaded can import it cheaply. All buffer side effects
/// (applying a reject, dropping a tracking decoration, revealing a hunk) are
/// delegated to a controller that the Monaco-aware applier registers via
/// `setProposedChangeController`.
import { useMemo, useSyncExternalStore } from "react";

export type ProposedChangeStatus = "pending" | "accepted" | "rejected";

export type ProposedChange = {
  /// Stable id for this change, independent of the model/decoration lifecycle.
  id: string;
  /// The `edit` tool-use id, so a chat card could correlate to its hunk.
  toolUseId: string | null;
  uri: string;
  /// Workspace path for the document-sync delegate (uri-keyed Monaco, path-keyed
  /// workspace). Null only if the document couldn't be resolved.
  path: string | null;
  /// Model decoration that tracks the inserted span as nearby text shifts. The
  /// live range is always read back via `model.getDecorationRange`.
  decorationId: string | null;
  /// Inline decorations highlighting just the added characters within the span
  /// (the word-level diff). Cleared together with the anchor on resolve.
  highlightDecorationIds: string[];
  originalText: string;
  newText: string;
  appliedAt: number;
  status: ProposedChangeStatus;
};

/// The Monaco-aware side of accept/reject/reveal. Registered by the applier.
export type ProposedChangeController = {
  /// Restore the original text over each change's tracked range and drop its
  /// decoration. Implementations apply bottom-up so earlier ranges stay valid.
  reject: (changes: ProposedChange[]) => void;
  /// Keep the buffer as-is (the edit is already live) and drop each decoration.
  accept: (changes: ProposedChange[]) => void;
  /// Drop a change's decoration without touching text — for changes the user
  /// already reverted by hand (undo).
  dropDecoration: (change: ProposedChange) => void;
  /// Scroll the editor to a change's current location.
  reveal: (change: ProposedChange) => void;
};

type Snapshot = {
  changes: ProposedChange[];
  byId: Record<string, ProposedChange>;
  byToolUseId: Record<string, ProposedChange>;
};

const EMPTY_CHANGES: ProposedChange[] = [];
const RESOLVED_RETENTION = 200;

let snapshot: Snapshot = {
  byId: {},
  byToolUseId: {},
  changes: EMPTY_CHANGES,
};
let controller: ProposedChangeController | null = null;
let pendingAgentNotes: string[] = [];

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Rebuild the immutable snapshot from a changes list, preserving the object
/// identity of untouched changes so per-change subscribers don't re-render.
function commit(changes: ProposedChange[]) {
  const byId: Record<string, ProposedChange> = {};
  const byToolUseId: Record<string, ProposedChange> = {};

  for (const change of changes) {
    byId[change.id] = change;
    if (change.toolUseId) {
      byToolUseId[change.toolUseId] = change;
    }
  }

  snapshot = { byId, byToolUseId, changes };
  emit();
}

function getSnapshot() {
  return snapshot.changes;
}

function getServerSnapshot() {
  return EMPTY_CHANGES;
}

export function setProposedChangeController(
  next: ProposedChangeController | null,
) {
  controller = next;
}

export function getProposedChanges(): ProposedChange[] {
  return snapshot.changes;
}

export function getProposedChange(id: string): ProposedChange | null {
  return snapshot.byId[id] ?? null;
}

export function addProposedChange(change: ProposedChange) {
  const next = [...snapshot.changes, change];
  commit(pruneResolved(next));
}

function resolve(
  ids: Set<string>,
  status: Exclude<ProposedChangeStatus, "pending">,
) {
  if (ids.size === 0) {
    return;
  }

  commit(
    snapshot.changes.map((entry) =>
      ids.has(entry.id)
        ? {
            ...entry,
            decorationId: null,
            highlightDecorationIds: [],
            status,
          }
        : entry,
    ),
  );
}

export function acceptChange(id: string) {
  const change = snapshot.byId[id];

  if (!change || change.status !== "pending") {
    return;
  }

  controller?.accept([change]);
  resolve(new Set([id]), "accepted");
}

export function rejectChange(id: string) {
  const change = snapshot.byId[id];

  if (!change || change.status !== "pending") {
    return;
  }

  controller?.reject([change]);
  recordRejectionNote(change);
  resolve(new Set([id]), "rejected");
}

export function acceptAllForUri(uri: string) {
  const pending = pendingForUri(uri);

  if (pending.length === 0) {
    return;
  }

  controller?.accept(pending);
  resolve(new Set(pending.map((change) => change.id)), "accepted");
}

export function rejectAllForUri(uri: string) {
  const pending = pendingForUri(uri);

  if (pending.length === 0) {
    return;
  }

  controller?.reject(pending);
  for (const change of pending) {
    recordRejectionNote(change);
  }
  resolve(new Set(pending.map((change) => change.id)), "rejected");
}

/// The user undid an agent edit by hand — the buffer is already restored, so
/// just clear the decoration and mark it rejected (no buffer write, no note).
export function resolveChangeByUndo(id: string) {
  const change = snapshot.byId[id];

  if (!change || change.status !== "pending") {
    return;
  }

  controller?.dropDecoration(change);
  resolve(new Set([id]), "rejected");
}

export function revealChange(id: string) {
  const change = snapshot.byId[id];

  if (change) {
    controller?.reveal(change);
  }
}

/// A model was disposed (its editor panel closed) — its pending edits can no
/// longer be reviewed (they were never saved), so drop them entirely.
export function dropProposedChangesForUri(uri: string) {
  if (!snapshot.changes.some((change) => change.uri === uri)) {
    return;
  }

  commit(snapshot.changes.filter((change) => change.uri !== uri));
}

export function clearAllProposedChanges() {
  if (snapshot.changes.length === 0) {
    return;
  }

  commit([]);
  pendingAgentNotes = [];
}

/// Drain the notes accumulated since the last call, for folding into the next
/// agent message so the model knows what happened to its edits (a rejection, or
/// a snippet that couldn't be located) and doesn't blindly repeat them.
export function takeAgentEditNotesSinceLastSend(): string[] {
  const notes = pendingAgentNotes;
  pendingAgentNotes = [];
  return notes;
}

function recordRejectionNote(change: ProposedChange) {
  const where = change.path ? fileLabel(change.path) : change.uri;
  pendingAgentNotes.push(
    `The user rejected your proposed edit to ${where}. Do not re-apply it; take a different approach.`,
  );
}

/// The applier couldn't apply an edit (its `oldText` wasn't found, or matched in
/// more than one place). Tell the agent so it can re-read and retry precisely.
export function recordEditFailureNote(
  uri: string,
  path: string | null,
  reason: string,
) {
  const where = path ? fileLabel(path) : uri;
  pendingAgentNotes.push(
    `Your proposed edit to ${where} could not be applied: ${reason} Re-read the file and copy the exact snippet (verbatim, occurring exactly once) before trying again.`,
  );
}

function fileLabel(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function pendingForUri(uri: string): ProposedChange[] {
  return snapshot.changes.filter(
    (change) => change.uri === uri && change.status === "pending",
  );
}

/// Keep the list bounded: resolved (accepted/rejected) changes linger so any
/// chat card could show their final state, but only up to a cap.
function pruneResolved(changes: ProposedChange[]): ProposedChange[] {
  const resolvedCount = changes.reduce(
    (count, change) => (change.status === "pending" ? count : count + 1),
    0,
  );

  if (resolvedCount <= RESOLVED_RETENTION) {
    return changes;
  }

  let toDrop = resolvedCount - RESOLVED_RETENTION;

  return changes.filter((change) => {
    if (change.status !== "pending" && toDrop > 0) {
      toDrop -= 1;
      return false;
    }
    return true;
  });
}

export function useProposedChanges(): ProposedChange[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useProposedChangesForUri(
  uri: string | null | undefined,
): ProposedChange[] {
  const all = useProposedChanges();

  return useMemo(
    () => (uri ? all.filter((change) => change.uri === uri) : EMPTY_CHANGES),
    [all, uri],
  );
}

export function useProposedChangeForToolUse(
  toolUseId: string | null | undefined,
): ProposedChange | null {
  const all = useProposedChanges();

  return useMemo(
    () =>
      toolUseId
        ? (all.find((change) => change.toolUseId === toolUseId) ?? null)
        : null,
    [all, toolUseId],
  );
}
