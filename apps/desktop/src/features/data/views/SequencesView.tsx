import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  SectionHeader,
} from "@/features/data/components/shared";
import {
  searchSequence,
  searchSequenceBatch,
} from "@/features/data/core/data-service";
import type {
  BatchSequenceMatch,
  SequenceMatch,
} from "@/features/data/core/data-types";
import { formatInt, monoClass, shortIri } from "@/features/data/core/format";
import { Button, LoaderCircle, Search } from "@/ui";
import { cx } from "@/ui/class-name";

type Mode = "single" | "batch";

export function SequencesView() {
  const [mode, setMode] = useState<Mode>("single");
  const [pattern, setPattern] = useState("");
  const [forwardOnly, setForwardOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [single, setSingle] = useState<SequenceMatch[] | null>(null);
  const [batch, setBatch] = useState<BatchSequenceMatch[] | null>(null);

  const run = async () => {
    setError(null);
    setRunning(true);
    try {
      if (mode === "single") {
        const matches = await searchSequence({
          forwardOnly,
          pattern: pattern.trim(),
        });
        setSingle(matches);
        setBatch(null);
      } else {
        const patterns = pattern
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const results = await searchSequenceBatch({ forwardOnly, patterns });
        setBatch(results);
        setSingle(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-w-0">
      <SectionHeader
        subtitle="Find nucleotide motifs across stored sequences. Reverse-complement aware unless restricted to the forward strand."
        title="Sequence Search"
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-none items-center gap-0.5 rounded-[6px] border border-cg-border bg-cg-editor p-0.5">
          {(
            [
              ["Single", "single"],
              ["Batch", "batch"],
            ] as const
          ).map(([label, option]) => (
            <button
              className="cursor-pointer rounded-[4px] border-none bg-transparent px-2 py-0.5 font-[inherit] text-[11px] font-semibold text-cg-muted transition-colors duration-150 ease-out hover:text-cg-fg data-[active=true]:bg-cg-surface-hover data-[active=true]:text-cg-fg motion-reduce:transition-none"
              data-active={mode === option}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12px] text-cg-fg">
          <input
            checked={forwardOnly}
            onChange={(event) => setForwardOnly(event.target.checked)}
            type="checkbox"
          />
          Forward strand only
        </label>
      </div>

      <textarea
        className="min-h-[96px] w-full rounded-[7px] border border-cg-border bg-cg-editor p-3 font-mono text-[12.5px] uppercase text-cg-fg outline-none focus:border-cg-focus"
        onChange={(event) => setPattern(event.target.value)}
        placeholder={
          mode === "single"
            ? "GAATTC"
            : "One pattern per line (up to 256)\nGAATTC\nTTTACA"
        }
        spellCheck={false}
        value={pattern}
      />

      <div className="mt-2 flex justify-end">
        <Button
          disabled={running || pattern.trim().length === 0}
          onClick={run}
          size="sm"
          variant="default"
        >
          {running ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin"
              size={14}
            />
          ) : (
            <Search aria-hidden="true" size={14} />
          )}
          Search
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      ) : null}

      {single ? (
        <div className="mt-4">
          {single.length === 0 ? (
            <EmptyState message="No matches found." />
          ) : (
            <MatchTable matches={single} />
          )}
        </div>
      ) : null}

      {batch ? (
        <div className="mt-4 grid gap-4">
          {batch.length === 0 ? (
            <EmptyState message="No matches found." />
          ) : (
            batch.map((entry) => (
              <div key={entry.pattern}>
                <div
                  className={cx(monoClass, "mb-1.5 font-semibold text-cg-fg")}
                >
                  {entry.pattern}{" "}
                  <span className="font-normal text-cg-muted">
                    ({formatInt(entry.matches.length)} matches)
                  </span>
                </div>
                {entry.matches.length === 0 ? (
                  <EmptyState message="No matches." />
                ) : (
                  <MatchTable matches={entry.matches} />
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function MatchTable({ matches }: { matches: SequenceMatch[] }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-cg-border">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-cg-border bg-cg-surface text-left text-[11px] uppercase tracking-[0.03em] text-cg-muted">
            <th className="px-3 py-2 font-semibold">Sequence</th>
            <th className="px-3 py-2 text-right font-semibold">Start</th>
            <th className="px-3 py-2 text-right font-semibold">Length</th>
            <th className="px-3 py-2 text-center font-semibold">Strand</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match, index) => (
            <tr
              className="border-b border-cg-border last:border-0"
              key={`${match.sequenceIri}:${match.start}:${match.strand}:${index}`}
            >
              <td
                className={cx(monoClass, "px-3 py-1.5 text-cg-accent")}
                title={match.sequenceIri}
              >
                {shortIri(match.sequenceIri)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-cg-fg">
                {formatInt(match.start)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-cg-fg">
                {formatInt(match.length)}
              </td>
              <td className="px-3 py-1.5 text-center font-mono text-cg-fg">
                {match.strand}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
