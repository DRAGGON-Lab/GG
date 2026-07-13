/// Renders the agent's proposed changes inline in a Monaco editor: a faint wash
/// on the inserted span with the added characters highlighted (a model
/// decoration owned by the applier) plus, per change, a view zone above the hunk
/// showing the full original line(s) with the removed characters highlighted,
/// and Accept / Reject controls. Also registers the keyboard actions. Editor-
/// scoped, so it rebuilds for free on dockview remounts.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { useEffect, useRef } from "react";

import { diffInlineSides } from "@/features/editor/core/inline-diff";
import {
  acceptAllForUri,
  acceptChange,
  getProposedChange,
  getProposedChanges,
  type ProposedChange,
  rejectAllForUri,
  rejectChange,
  useProposedChangesForUri,
} from "@/features/editor/core/proposed-changes-store";

const CONTEXT_KEY = "ggHasProposedChanges";
const HEADER_HEIGHT_PX = 28;
const DELETED_BLOCK_PADDING_PX = 10;

type ZoneRecord = {
  zone: monaco.editor.IViewZone;
  zoneId: string;
};

export function useProposedChangeDecorations(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  documentUri: string | null,
) {
  const changes = useProposedChangesForUri(documentUri);
  const zonesRef = useRef<Map<string, ZoneRecord>>(new Map());
  const contextKeyRef = useRef<monaco.editor.IContextKey<boolean> | null>(null);

  // Setup: context key, keyboard actions, and a content-change subscription that
  // re-anchors zones above their (shifting) hunks. Torn down on file switch.
  useEffect(() => {
    if (!editor) {
      return;
    }

    const zones = zonesRef.current;
    contextKeyRef.current = editor.createContextKey<boolean>(
      CONTEXT_KEY,
      false,
    );

    const actionDisposables = registerProposedChangeActions(editor);

    let relayoutFrame: number | null = null;
    const contentDisposable = editor.onDidChangeModelContent(() => {
      if (relayoutFrame !== null) {
        return;
      }
      relayoutFrame = window.requestAnimationFrame(() => {
        relayoutFrame = null;
        relayoutZones(editor, zones);
      });
    });

    return () => {
      if (relayoutFrame !== null) {
        window.cancelAnimationFrame(relayoutFrame);
      }
      contentDisposable.dispose();
      for (const disposable of actionDisposables) {
        disposable.dispose();
      }
      editor.changeViewZones((accessor) => {
        for (const record of zones.values()) {
          accessor.removeZone(record.zoneId);
        }
      });
      zones.clear();
      contextKeyRef.current = null;
    };
  }, [editor, documentUri]);

  // Sync: add zones for new pending changes, remove zones for resolved ones.
  useEffect(() => {
    if (!editor) {
      return;
    }

    const model = editor.getModel();

    if (!model || model.uri.toString() !== documentUri) {
      return;
    }

    const zones = zonesRef.current;
    const fontInfo = editor.getOption(monaco.editor.EditorOption.fontInfo);
    const lineHeight = fontInfo.lineHeight;
    const desired = new Map(
      changes
        .filter((change) => change.status === "pending" && change.decorationId)
        .map((change) => [change.id, change] as const),
    );

    editor.changeViewZones((accessor) => {
      for (const [id, record] of zones) {
        if (!desired.has(id)) {
          accessor.removeZone(record.zoneId);
          zones.delete(id);
        }
      }

      for (const [id, change] of desired) {
        if (zones.has(id)) {
          continue;
        }

        const range = model.getDecorationRange(change.decorationId as string);
        if (!range) {
          continue;
        }

        // Expand the snippet to the full line(s) it sits on, so the ghost shows
        // the whole "before" line (with only the removed part highlighted),
        // matching the whole-line green wash on the new side.
        const { fullOriginal, fullNew } = expandToFullLines(
          model,
          range,
          change,
        );
        const domNode = buildZoneDom(change, fullOriginal, fullNew, fontInfo);
        const deletedLineCount =
          change.originalText === "" ? 0 : fullOriginal.split("\n").length;
        const zone: monaco.editor.IViewZone = {
          afterLineNumber: Math.max(0, range.startLineNumber - 1),
          domNode,
          heightInPx:
            HEADER_HEIGHT_PX +
            (deletedLineCount > 0
              ? deletedLineCount * lineHeight + DELETED_BLOCK_PADDING_PX
              : 0),
          // Must stay false: when true, Monaco focuses the textarea and
          // preventDefaults the mousedown over the zone, swallowing clicks on
          // our Accept/Reject buttons (see mouseHandler `suppressMouseDown`).
          suppressMouseDown: false,
        };
        const zoneId = accessor.addZone(zone);
        zones.set(id, { zone, zoneId });
      }
    });

    contextKeyRef.current?.set(
      changes.some((change) => change.status === "pending"),
    );
  }, [editor, documentUri, changes]);
}

function relayoutZones(
  editor: monaco.editor.IStandaloneCodeEditor,
  zones: Map<string, ZoneRecord>,
) {
  const model = editor.getModel();

  if (!model || zones.size === 0) {
    return;
  }

  editor.changeViewZones((accessor) => {
    for (const [id, record] of zones) {
      const change = getProposedChange(id);
      if (!change?.decorationId) {
        continue;
      }
      const range = model.getDecorationRange(change.decorationId);
      if (!range) {
        continue;
      }
      const next = Math.max(0, range.startLineNumber - 1);
      if (record.zone.afterLineNumber !== next) {
        record.zone.afterLineNumber = next;
        accessor.layoutZone(record.zoneId);
      }
    }
  });
}

/// Reconstruct the full original line(s) the change sits on. The text outside
/// the edited span (the line prefix/suffix) is identical in the old and new
/// buffer, so we read it from the live model and splice the change's snippet
/// back in; `fullNew` is just those same lines as they are now.
function expandToFullLines(
  model: monaco.editor.ITextModel,
  insertedRange: monaco.Range,
  change: ProposedChange,
): { fullNew: string; fullOriginal: string } {
  const startLine = insertedRange.startLineNumber;
  const endLine = insertedRange.endLineNumber;
  const prefix = model.getValueInRange(
    new monaco.Range(startLine, 1, startLine, insertedRange.startColumn),
  );
  const suffix = model.getValueInRange(
    new monaco.Range(
      endLine,
      insertedRange.endColumn,
      endLine,
      model.getLineMaxColumn(endLine),
    ),
  );
  const fullNew = model.getValueInRange(
    new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
  );

  return { fullNew, fullOriginal: `${prefix}${change.originalText}${suffix}` };
}

function buildZoneDom(
  change: ProposedChange,
  fullOriginal: string,
  fullNew: string,
  fontInfo: monaco.editor.FontInfo,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "app-agent-proposed-zone";

  const header = document.createElement("div");
  header.className = "app-agent-proposed-zone-header";

  const label = document.createElement("span");
  label.className = "app-agent-proposed-zone-label";
  label.textContent = "Proposed change";
  header.append(label);

  const spacer = document.createElement("span");
  spacer.className = "app-agent-proposed-zone-spacer";
  header.append(spacer);

  header.append(
    buildActionButton("Accept", "⌘Y", "app-agent-proposed-zone-accept", () =>
      acceptChange(change.id),
    ),
    buildActionButton("Reject", "⌘N", "app-agent-proposed-zone-reject", () =>
      rejectChange(change.id),
    ),
  );

  container.append(header);

  if (change.originalText !== "") {
    // The full original line(s), with only the removed characters highlighted —
    // so the user can see exactly what's leaving, not just a bare fragment.
    const deleted = document.createElement("div");
    deleted.className = "app-agent-proposed-zone-deleted";
    deleted.style.fontFamily = fontInfo.fontFamily;
    deleted.style.fontSize = `${fontInfo.fontSize}px`;
    deleted.style.lineHeight = `${fontInfo.lineHeight}px`;

    for (const segment of diffInlineSides(fullOriginal, fullNew).removed) {
      const span = document.createElement("span");
      span.textContent = segment.text;
      if (segment.changed) {
        span.className = "app-agent-proposed-removed";
      }
      deleted.append(span);
    }

    container.append(deleted);
  }

  return container;
}

function buildActionButton(
  label: string,
  hint: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `app-agent-proposed-zone-btn ${className}`;

  const text = document.createElement("span");
  text.textContent = label;

  const kbd = document.createElement("kbd");
  kbd.className = "app-agent-proposed-zone-kbd";
  kbd.textContent = hint;

  button.append(text, kbd);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
}

function registerProposedChangeActions(
  editor: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable[] {
  return [
    editor.addAction({
      contextMenuGroupId: "1_modification",
      id: "gg.proposedChanges.accept",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY],
      label: "Accept Proposed Change",
      precondition: CONTEXT_KEY,
      run: () => acceptNearest(editor),
    }),
    editor.addAction({
      contextMenuGroupId: "1_modification",
      id: "gg.proposedChanges.reject",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN],
      label: "Reject Proposed Change",
      precondition: CONTEXT_KEY,
      run: () => rejectNearest(editor),
    }),
    editor.addAction({
      id: "gg.proposedChanges.acceptAll",
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyY,
      ],
      label: "Accept All Proposed Changes",
      precondition: CONTEXT_KEY,
      run: () => {
        const uri = editor.getModel()?.uri.toString();
        if (uri) {
          acceptAllForUri(uri);
        }
      },
    }),
    editor.addAction({
      id: "gg.proposedChanges.rejectAll",
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyN,
      ],
      label: "Reject All Proposed Changes",
      precondition: CONTEXT_KEY,
      run: () => {
        const uri = editor.getModel()?.uri.toString();
        if (uri) {
          rejectAllForUri(uri);
        }
      },
    }),
    editor.addAction({
      id: "gg.proposedChanges.next",
      keybindings: [monaco.KeyCode.F7],
      label: "Next Proposed Change",
      precondition: CONTEXT_KEY,
      run: () => navigateChanges(editor, 1),
    }),
    editor.addAction({
      id: "gg.proposedChanges.previous",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F7],
      label: "Previous Proposed Change",
      precondition: CONTEXT_KEY,
      run: () => navigateChanges(editor, -1),
    }),
  ];
}

function acceptNearest(editor: monaco.editor.IStandaloneCodeEditor) {
  const change = nearestPendingChange(editor);
  if (change) {
    acceptChange(change.id);
  }
}

function rejectNearest(editor: monaco.editor.IStandaloneCodeEditor) {
  const change = nearestPendingChange(editor);
  if (change) {
    rejectChange(change.id);
  }
}

/// The pending change at the cursor, else the nearest one that follows it, else
/// the last one above it.
function nearestPendingChange(
  editor: monaco.editor.IStandaloneCodeEditor,
): ProposedChange | null {
  const located = locatedPendingChanges(editor);
  if (located.length === 0) {
    return null;
  }

  const cursorLine = editor.getPosition()?.lineNumber ?? 1;
  const containing = located.find(
    ({ range }) =>
      range.startLineNumber <= cursorLine && cursorLine <= range.endLineNumber,
  );
  if (containing) {
    return containing.change;
  }

  const following = located.find(
    ({ range }) => range.startLineNumber >= cursorLine,
  );
  return (following ?? located[located.length - 1]).change;
}

function navigateChanges(
  editor: monaco.editor.IStandaloneCodeEditor,
  direction: 1 | -1,
) {
  const located = locatedPendingChanges(editor);
  if (located.length === 0) {
    return;
  }

  const cursorLine = editor.getPosition()?.lineNumber ?? 1;
  const target =
    direction === 1
      ? (located.find(({ range }) => range.startLineNumber > cursorLine) ??
        located[0])
      : ([...located]
          .reverse()
          .find(({ range }) => range.startLineNumber < cursorLine) ??
        located[located.length - 1]);

  editor.setPosition({
    column: target.range.startColumn,
    lineNumber: target.range.startLineNumber,
  });
  editor.revealRangeInCenterIfOutsideViewport(target.range);
}

function locatedPendingChanges(editor: monaco.editor.IStandaloneCodeEditor) {
  const model = editor.getModel();
  if (!model) {
    return [];
  }

  const uri = model.uri.toString();
  return getProposedChanges()
    .filter(
      (change) =>
        change.uri === uri &&
        change.status === "pending" &&
        change.decorationId,
    )
    .map((change) => ({
      change,
      range: model.getDecorationRange(change.decorationId as string),
    }))
    .filter(
      (entry): entry is { change: ProposedChange; range: monaco.Range } =>
        entry.range !== null,
    )
    .sort((a, b) => a.range.startLineNumber - b.range.startLineNumber);
}
