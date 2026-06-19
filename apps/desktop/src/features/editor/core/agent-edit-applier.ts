/// The Monaco-aware half of the proposed-changes feature: it listens for the
/// agent's `agent-editor-edit` events, locates each edit's `oldText` in the
/// document's Monaco model (the live buffer is the source of truth — the agent
/// copied the snippet from the same text), applies the replacement immediately
/// (Cursor-style apply-then-review), and registers a controller with the
/// (Monaco-free) store so accept/reject/reveal can mutate the buffer.
import type { UnlistenFn } from "@tauri-apps/api/event";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import { agentEditInProgress } from "@/features/editor/core/agent-edit-flags";
import { diffInlineSides } from "@/features/editor/core/inline-diff";
import {
  addProposedChange,
  dropProposedChangesForUri,
  getProposedChanges,
  type ProposedChange,
  recordEditFailureNote,
  resolveChangeByUndo,
  setProposedChangeController,
} from "@/features/editor/core/proposed-changes-store";
import {
  type AgentEditorEdit,
  onAgentEditorEdit,
} from "@/features/editor/core/python-service";
import type { EditorDocument } from "@/features/editor/editor-page-context";

type RevealPosition = { column: number; lineNumber: number };

/// The workspace operations the applier needs, supplied by EditorPage so this
/// module stays decoupled from the page's dock/document plumbing. Null when no
/// editor page is mounted — edits then have nowhere to go.
export type EditorWorkspaceDelegates = {
  openEditorPath: (pathOrUri: string) => Promise<EditorDocument | null>;
  updateDocumentText: (path: string, text: string) => void;
  getOpenDocument: (pathOrUri: string) => EditorDocument | null;
  openLocation: (
    uri: string,
    position?: RevealPosition,
  ) => Promise<boolean> | boolean;
  saveDocument: (path: string, text: string) => Promise<void> | void;
};

let delegates: EditorWorkspaceDelegates | null = null;
let bridgeInitialized = false;
let unlistenAgentEdit: Promise<UnlistenFn> | null = null;

const reconcilerModels = new WeakSet<monaco.editor.ITextModel>();

export function setEditorWorkspaceDelegates(
  next: EditorWorkspaceDelegates | null,
) {
  delegates = next;
}

/// Idempotent: wire the store controller and the agent-edit listener once. Safe
/// under StrictMode double-mount and dockview remounts (module-scope guard).
export function initProposedChangesBridge() {
  if (bridgeInitialized) {
    return;
  }
  bridgeInitialized = true;

  setProposedChangeController(controller);
  unlistenAgentEdit = onAgentEditorEdit((edit) => {
    void applyAgentEdit(edit);
  });
}

const controller = {
  accept(changes: ProposedChange[]) {
    const uris = new Set<string>();
    for (const change of changes) {
      removeDecoration(change);
      uris.add(change.uri);
    }
    // Accepting commits the change — persist it to disk (once per file).
    for (const uri of uris) {
      saveModel(uri);
    }
  },
  dropDecoration(change: ProposedChange) {
    removeDecoration(change);
  },
  reject(changes: ProposedChange[]) {
    // Bottom-up so restoring an earlier hunk doesn't invalidate a later one's
    // tracked range.
    const ordered = [...changes].sort(byLiveStartDescending);
    for (const change of ordered) {
      restoreOriginal(change);
    }
  },
  reveal(change: ProposedChange) {
    const model = modelFor(change.uri);
    const range =
      model && change.decorationId
        ? model.getDecorationRange(change.decorationId)
        : null;
    const position = range
      ? { column: range.startColumn, lineNumber: range.startLineNumber }
      : undefined;
    void delegates?.openLocation(change.uri, position);
  },
};

async function applyAgentEdit(edit: AgentEditorEdit) {
  let model = modelFor(edit.uri);
  let document: EditorDocument | null =
    delegates?.getOpenDocument(edit.uri) ?? null;

  if (!model) {
    // The edit targets a file that isn't open in any editor. Open it (so the
    // user sees what the agent is changing) and wait for its model. Without an
    // editor page mounted there are no delegates and nowhere to apply it.
    if (!delegates) {
      return;
    }

    document = await delegates.openEditorPath(edit.uri);
    if (!document) {
      recordEditFailureNote(edit.uri, null, "the file could not be opened.");
      return;
    }

    model = await waitForModel(edit.uri, 5000);
    if (!model) {
      return;
    }
  }

  if (model.isDisposed()) {
    return;
  }

  const path = (delegates?.getOpenDocument(edit.uri) ?? document)?.path ?? null;

  // Match by content: the agent copied `oldText` from the same buffer, so it
  // should occur exactly once. Surface ambiguity/absence back to the agent
  // rather than guessing.
  const matches = model.findMatches(
    edit.oldText,
    false,
    false,
    true,
    null,
    false,
  );
  if (matches.length === 0) {
    recordEditFailureNote(edit.uri, path, "`oldText` was not found.");
    return;
  }
  if (matches.length > 1) {
    recordEditFailureNote(
      edit.uri,
      path,
      `\`oldText\` appears ${matches.length} times.`,
    );
    return;
  }
  const range = matches[0].range;
  const originalText = model.getValueInRange(range);

  withAgentEdit(() => {
    model.pushEditOperations(
      [],
      [{ forceMoveMarkers: true, range, text: edit.newText }],
      () => null,
    );
  });

  if (path) {
    delegates?.updateDocumentText(path, model.getValue());
  }

  const startOffset = model.getOffsetAt(range.getStartPosition());
  const insertedEnd = model.getPositionAt(startOffset + edit.newText.length);
  const insertedRange = monaco.Range.fromPositions(
    range.getStartPosition(),
    insertedEnd,
  );

  // Anchor: a faint whole-line wash over the new span (tracks the range). Then
  // a stronger inline highlight on just the *added* characters, from the
  // word-level diff, so the user sees exactly what's new.
  const decorations: monaco.editor.IModelDeltaDecoration[] = [
    {
      options: {
        className: "app-agent-proposed-insert",
        isWholeLine: true,
        linesDecorationsClassName: "app-agent-proposed-insert-margin",
        stickiness:
          monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
      range: insertedRange,
    },
  ];

  if (edit.newText.length > 0) {
    let offset = 0;
    for (const segment of diffInlineSides(originalText, edit.newText).added) {
      if (segment.changed && segment.text.length > 0) {
        decorations.push({
          options: {
            inlineClassName: "app-agent-proposed-added",
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
          range: monaco.Range.fromPositions(
            model.getPositionAt(startOffset + offset),
            model.getPositionAt(startOffset + offset + segment.text.length),
          ),
        });
      }
      offset += segment.text.length;
    }
  }

  const createdIds = model.deltaDecorations([], decorations);

  addProposedChange({
    appliedAt: Date.now(),
    decorationId: createdIds[0] ?? null,
    highlightDecorationIds: createdIds.slice(1),
    id: crypto.randomUUID(),
    newText: edit.newText,
    originalText,
    path,
    status: "pending",
    toolUseId: edit.toolUseId ?? null,
    uri: edit.uri,
  });

  attachUndoReconciler(model);
}

function modelFor(uri: string): monaco.editor.ITextModel | null {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  return model && !model.isDisposed() ? model : null;
}

function withAgentEdit(run: () => void) {
  agentEditInProgress.current = true;
  try {
    run();
  } finally {
    agentEditInProgress.current = false;
  }
}

function syncModel(model: monaco.editor.ITextModel) {
  const document = delegates?.getOpenDocument(model.uri.toString());
  if (document?.path) {
    delegates?.updateDocumentText(document.path, model.getValue());
  }
}

function saveModel(uri: string) {
  const model = modelFor(uri);
  const document = delegates?.getOpenDocument(uri);
  if (model && document?.path) {
    void delegates?.saveDocument(document.path, model.getValue());
  }
}

function restoreOriginal(change: ProposedChange) {
  const model = modelFor(change.uri);
  if (!model || !change.decorationId) {
    return;
  }

  const range = model.getDecorationRange(change.decorationId);
  if (range) {
    withAgentEdit(() => {
      model.pushEditOperations(
        [],
        [{ range, text: change.originalText }],
        () => null,
      );
    });
    syncModel(model);
  }

  model.deltaDecorations(decorationIdsOf(change), []);
}

function decorationIdsOf(change: ProposedChange): string[] {
  return [change.decorationId, ...change.highlightDecorationIds].filter(
    (id): id is string => Boolean(id),
  );
}

function removeDecoration(change: ProposedChange) {
  const model = modelFor(change.uri);
  const ids = decorationIdsOf(change);
  if (model && ids.length > 0) {
    model.deltaDecorations(ids, []);
  }
}

function byLiveStartDescending(a: ProposedChange, b: ProposedChange): number {
  const rangeA = liveRange(a);
  const rangeB = liveRange(b);
  const lineA = rangeA?.startLineNumber ?? 0;
  const lineB = rangeB?.startLineNumber ?? 0;

  if (lineA !== lineB) {
    return lineB - lineA;
  }

  return (rangeB?.startColumn ?? 0) - (rangeA?.startColumn ?? 0);
}

function liveRange(change: ProposedChange): monaco.Range | null {
  const model = modelFor(change.uri);
  if (!model || !change.decorationId) {
    return null;
  }
  return model.getDecorationRange(change.decorationId);
}

function waitForModel(
  uri: string,
  timeoutMs: number,
): Promise<monaco.editor.ITextModel | null> {
  const existing = modelFor(uri);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const target = monaco.Uri.parse(uri).toString();
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      disposable.dispose();
      window.clearTimeout(timer);
      resolve(modelFor(uri));
    };

    const disposable = monaco.editor.onDidCreateModel((model) => {
      if (model.uri.toString() === target) {
        // The model's text is set synchronously at creation; defer a tick so the
        // editor's attach effect has finished before we read/edit it.
        queueMicrotask(finish);
      }
    });
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

/// Watch a model for user edits that revert an agent change by hand (undo): when
/// a pending change's tracked span collapses to empty, mark it rejected.
function attachUndoReconciler(model: monaco.editor.ITextModel) {
  if (reconcilerModels.has(model)) {
    return;
  }
  reconcilerModels.add(model);

  let timer: number | null = null;

  const changeDisposable = model.onDidChangeContent(() => {
    if (agentEditInProgress.current) {
      return;
    }
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = null;
      reconcileModel(model);
    }, 120);
  });

  model.onWillDispose(() => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    changeDisposable.dispose();
    reconcilerModels.delete(model);
    // The model's pending edits were never saved — they can't be reviewed once
    // its editor is gone, so drop them.
    dropProposedChangesForUri(model.uri.toString());
  });
}

function reconcileModel(model: monaco.editor.ITextModel) {
  if (model.isDisposed()) {
    return;
  }

  const uri = model.uri.toString();
  for (const change of getProposedChanges()) {
    if (
      change.uri !== uri ||
      change.status !== "pending" ||
      !change.decorationId
    ) {
      continue;
    }

    const range = model.getDecorationRange(change.decorationId);
    const reverted = !range || (range.isEmpty() && change.newText.length > 0);

    if (reverted) {
      resolveChangeByUndo(change.id);
    }
  }
}

/// Stop the agent-edit listener (used by tests and HMR teardown).
export function disposeProposedChangesBridge() {
  void unlistenAgentEdit?.then((dispose) => dispose());
  unlistenAgentEdit = null;
  bridgeInitialized = false;
  setProposedChangeController(null);
}

// This module owns a singleton Tauri `agent-editor-edit` listener plus the
// workspace delegates — neither transfers cleanly across a hot swap. Left to
// normal HMR, each reload leaves the old listener registered while a new one is
// added, so a single agent edit fans out into N duplicate proposed changes.
// Self-accept and force a full reload so an edit to this file lands clean, and
// tear the listener down on dispose as a safety net.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
  import.meta.hot.dispose(() => {
    disposeProposedChangesBridge();
  });
}
