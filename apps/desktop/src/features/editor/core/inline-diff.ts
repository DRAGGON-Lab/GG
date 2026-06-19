/// Token-level (word-level) diff between the original and new text of a proposed
/// change, so the inline review can show the full line on each side and
/// highlight *only* the characters that actually changed — red on the removed
/// side, green on the added side — instead of washing the whole new span.
///
/// Pure and dependency-free; inputs are small (the agent makes minimal-span
/// edits), so a quadratic token LCS is fine, with a guard for the rare large one.

export type InlineDiffSegment = {
  text: string;
  /// True for the part unique to this side (removed on the original side, added
  /// on the new side); false for text common to both.
  changed: boolean;
};

export type InlineDiffSides = {
  /// Reconstructs the original text; `changed` segments are removals.
  removed: InlineDiffSegment[];
  /// Reconstructs the new text; `changed` segments are additions.
  added: InlineDiffSegment[];
};

type Op = { kind: "common" | "removed" | "added"; text: string };

// Words (incl. unicode letters and digits), whitespace runs, and runs of other
// symbols — each is one diff token.
const TOKEN_RE = /[\p{L}\p{N}_']+|\s+|[^\p{L}\p{N}_'\s]+/gu;

const MAX_LCS_CELLS = 1_000_000;

export function diffInlineSides(
  original: string,
  next: string,
): InlineDiffSides {
  if (original === next) {
    return {
      added: next ? [{ changed: false, text: next }] : [],
      removed: original ? [{ changed: false, text: original }] : [],
    };
  }

  const a = tokenize(original);
  const b = tokenize(next);

  // Pathologically large edit: skip the intra-line diff and mark each side whole.
  if (a.length * b.length > MAX_LCS_CELLS) {
    return {
      added: next ? [{ changed: true, text: next }] : [],
      removed: original ? [{ changed: true, text: original }] : [],
    };
  }

  const ops = diffTokens(a, b);

  return {
    added: coalesce(
      ops
        .filter((op) => op.kind !== "removed")
        .map((op) => ({ changed: op.kind === "added", text: op.text })),
    ),
    removed: coalesce(
      ops
        .filter((op) => op.kind !== "added")
        .map((op) => ({ changed: op.kind === "removed", text: op.text })),
    ),
  };
}

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function diffTokens(a: string[], b: string[]): Op[] {
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ kind: "common", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      ops.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) {
    ops.push({ kind: "removed", text: a[i] });
    i++;
  }
  while (j < n) {
    ops.push({ kind: "added", text: b[j] });
    j++;
  }

  return ops;
}

function coalesce(segments: InlineDiffSegment[]): InlineDiffSegment[] {
  const out: InlineDiffSegment[] = [];

  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.changed === segment.changed) {
      last.text += segment.text;
    } else {
      out.push({ ...segment });
    }
  }

  return out;
}
