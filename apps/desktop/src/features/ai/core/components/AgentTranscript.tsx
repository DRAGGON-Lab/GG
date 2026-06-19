import { useEffect, useState } from "react";

import type { AiBlock, TranscriptEntry } from "@/features/ai/core/ai-types";
import { AiMarkdown } from "@/features/ai/core/components/AiMarkdown";
import { ToolCallCard } from "@/features/ai/core/components/ToolCallCard";

// Per frame, reveal this fraction of the not-yet-shown backlog. Higher = snappier
// (closer to raw, more jump); lower = smoother (more trailing lag). Exponential
// catch-up self-regulates: a fresh chunk speeds the reveal, so it never falls far
// behind, and it always finishes (min 1 char/frame).
const REVEAL_FRACTION = 0.18;

export function AgentTranscript({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <div className="grid gap-4">
      {entries.map((entry, index) =>
        entry.role === "user" ? (
          <UserBubble key={entry.id} text={entry.text} />
        ) : (
          <AiTurn
            key={entry.id}
            active={index === entries.length - 1 && !entry.done}
            entry={entry}
          />
        ),
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="min-w-0 max-w-[86%] justify-self-end rounded-[7px] rounded-br-[3px] border border-cg-border bg-cg-surface px-2.5 py-1.5 text-cg-fg">
      <AiMarkdown text={text} />
    </div>
  );
}

function AiTurn({
  active,
  entry,
}: {
  active: boolean;
  entry: Extract<TranscriptEntry, { role: "assistant" }>;
}) {
  const results = new Map(
    entry.blocks
      .filter(
        (block): block is Extract<AiBlock, { type: "toolResult" }> =>
          block.type === "toolResult",
      )
      .map((block) => [block.id, block]),
  );
  const lastIndex = entry.blocks.length - 1;

  // The quote-style left rule marks the assistant's working (thinking + tool
  // calls); the actual response text renders bare. Group consecutive working
  // blocks so each run shares one rule.
  const segments: Array<{
    blocks: Array<{ block: AiBlock; index: number }>;
    working: boolean;
  }> = [];
  entry.blocks.forEach((block, index) => {
    if (block.type === "toolResult") {
      return;
    }
    const working = block.type === "thinking" || block.type === "toolUse";
    const last = segments[segments.length - 1];
    if (last && last.working === working) {
      last.blocks.push({ block, index });
    } else {
      segments.push({ blocks: [{ block, index }], working });
    }
  });

  const renderBlock = (block: AiBlock, index: number) => {
    // Only the trailing block of the in-progress turn is still streaming.
    const live = active && index === lastIndex;
    switch (block.type) {
      case "text":
        return <StreamingBlock key={index} live={live} text={block.text} />;
      case "thinking":
        return (
          <StreamingBlock key={index} live={live} text={block.text} thinking />
        );
      case "toolUse":
        return (
          <ToolCallCard
            key={index}
            result={results.get(block.id)}
            toolUse={block}
          />
        );
      case "toolResult":
        return null;
    }
  };

  return (
    <div className="grid min-w-0 gap-2">
      {segments.map((segment, segmentIndex) =>
        segment.working ? (
          <div
            className="grid min-w-0 gap-2 border-l border-cg-border pl-2.5"
            key={`working-${segmentIndex}`}
          >
            {segment.blocks.map(({ block, index }) =>
              renderBlock(block, index),
            )}
          </div>
        ) : (
          segment.blocks.map(({ block, index }) => renderBlock(block, index))
        ),
      )}
      {!entry.blocks.length && !entry.done ? (
        <span className="text-[11.5px] text-cg-muted">...</span>
      ) : null}
    </div>
  );
}

function StreamingBlock({
  live,
  text,
  thinking,
}: {
  live: boolean;
  text: string;
  thinking?: boolean;
}) {
  const shown = useSmoothText(text, live);
  if (thinking) {
    return (
      <div className="text-[11.5px] italic text-cg-muted">
        <AiMarkdown muted text={shown} />
      </div>
    );
  }
  return <AiMarkdown text={shown} />;
}

/// Reveal `text` smoothly while `live`; show it whole once settled. Paces only the
/// reveal of already-received characters — nothing is held back from arriving.
function useSmoothText(text: string, live: boolean): string {
  const [shownLength, setShownLength] = useState(text.length);
  const [prev, setPrev] = useState({ live, text });

  if (prev.live !== live || prev.text !== text) {
    setPrev({ live, text });
    if (!live) {
      setShownLength(text.length);
    }
  }

  useEffect(() => {
    if (!live || shownLength >= text.length) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      setShownLength((current) =>
        current >= text.length
          ? current
          : Math.min(
              text.length,
              current +
                Math.max(
                  1,
                  Math.ceil((text.length - current) * REVEAL_FRACTION),
                ),
            ),
      );
    });

    return () => cancelAnimationFrame(frame);
  }, [live, shownLength, text]);

  return text.slice(0, live ? Math.min(shownLength, text.length) : text.length);
}
