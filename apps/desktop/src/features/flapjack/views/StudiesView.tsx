import { useEffect, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/features/flapjack/components/shared";
import {
  loadSamples,
  loadStudy,
} from "@/features/flapjack/core/flapjack-service";
import type {
  Assay,
  Sample,
  StudyDetail,
} from "@/features/flapjack/core/flapjack-types";
import { cx } from "@/ui/class-name";

export function StudiesView({
  selectedStudyId,
}: {
  selectedStudyId: number | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [selectedAssay, setSelectedAssay] = useState<number | null>(null);
  const [samples, setSamples] = useState<{
    assayId: number;
    list: Sample[];
  } | null>(null);

  useEffect(() => {
    if (selectedStudyId === null) return;
    let cancelled = false;
    loadStudy(selectedStudyId).then(
      (loaded) => !cancelled && setDetail(loaded),
      (caught) =>
        !cancelled &&
        setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, [selectedStudyId]);

  // Guard against a stale flash: only trust loaded data that matches the
  // current selection, and fall back to the first assay of the active study.
  const currentDetail =
    detail && detail.study.id === selectedStudyId ? detail : null;
  const activeAssayId =
    selectedAssay !== null &&
    currentDetail?.assays.some((assay) => assay.id === selectedAssay)
      ? selectedAssay
      : (currentDetail?.assays[0]?.id ?? null);

  useEffect(() => {
    if (activeAssayId === null) return;
    let cancelled = false;
    loadSamples(activeAssayId).then(
      (loaded) =>
        !cancelled && setSamples({ assayId: activeAssayId, list: loaded }),
      (caught) =>
        !cancelled &&
        setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, [activeAssayId]);

  const currentSamples =
    samples && samples.assayId === activeAssayId ? samples.list : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <SectionHeader
        subtitle="Browse a study's assays and the samples on each plate."
        title="Studies"
      />
      {error ? <ErrorState message={error} /> : null}

      {selectedStudyId === null ? (
        <EmptyState message="No study selected. Pick one from the sidebar." />
      ) : currentDetail ? (
        <AssaysAndSamples
          assays={currentDetail.assays}
          onSelectAssay={setSelectedAssay}
          samples={currentSamples}
          selectedAssay={activeAssayId}
        />
      ) : (
        <LoadingState />
      )}
    </div>
  );
}

function AssaysAndSamples({
  assays,
  onSelectAssay,
  samples,
  selectedAssay,
}: {
  assays: Assay[];
  onSelectAssay: (id: number) => void;
  samples: Sample[] | null;
  selectedAssay: number | null;
}) {
  if (assays.length === 0) {
    return <EmptyState message="This study has no assays." />;
  }
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap gap-1.5">
        {assays.map((assay) => (
          <button
            className={cx(
              "cursor-default rounded-[6px] border border-cg-border bg-cg-surface px-2.5 py-1 text-[12px] text-cg-muted hover:text-cg-fg",
              selectedAssay === assay.id && "bg-cg-sidebar-hover text-cg-fg",
            )}
            key={assay.id}
            onClick={() => onSelectAssay(assay.id)}
            type="button"
          >
            {assay.name}
            <span className="ml-1.5 text-cg-muted">({assay.sampleCount})</span>
          </button>
        ))}
      </div>
      {samples ? <PlateGrid samples={samples} /> : <LoadingState />}
    </div>
  );
}

/// Format a concentration compactly for a tooltip (dose sweeps are log-spaced,
/// so values span many orders of magnitude).
function formatConcentration(value: number): string {
  if (value === 0) return "0";
  if (value >= 0.01 && value < 1e6) {
    return String(Number(value.toPrecision(4)));
  }
  return value.toExponential(2);
}

/// Map a sample's first-supplement concentration to a 0–1 fill intensity on a
/// log scale across the plate. `null` for a well with no supplement (drawn at a
/// flat fill); zero dose maps to the lowest intensity.
function makeIntensity(samples: Sample[]): (sample: Sample) => number | null {
  const positives = samples
    .map((s) => s.supplements[0]?.concentration)
    .filter((c): c is number => c !== undefined && c > 0);
  const logMin = positives.length ? Math.log10(Math.min(...positives)) : 0;
  const logMax = positives.length ? Math.log10(Math.max(...positives)) : 1;
  const span = logMax - logMin || 1;
  return (sample) => {
    const concentration = sample.supplements[0]?.concentration;
    if (concentration === undefined) return null;
    if (concentration <= 0) return 0;
    return (Math.log10(concentration) - logMin) / span;
  };
}

function PlateGrid({ samples }: { samples: Sample[] }) {
  if (samples.length === 0) {
    return <EmptyState message="This assay has no samples." />;
  }
  const maxRow = Math.max(...samples.map((s) => s.row));
  const maxCol = Math.max(...samples.map((s) => s.col));
  const byCell = new Map<string, Sample>();
  for (const sample of samples)
    byCell.set(`${sample.row}:${sample.col}`, sample);

  const rows = Array.from({ length: maxRow + 1 }, (_, r) => r);
  const cols = Array.from({ length: maxCol + 1 }, (_, c) => c);
  const intensityFor = makeIntensity(samples);

  return (
    <div className="grid gap-2">
      <div className="overflow-auto">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `20px repeat(${cols.length}, minmax(22px, 1fr))`,
          }}
        >
          <div />
          {cols.map((c) => (
            <div
              className="text-center text-[10px] text-cg-muted"
              key={`col-${c}`}
            >
              {c + 1}
            </div>
          ))}
          {rows.map((r) => (
            <FragmentRow
              byCell={byCell}
              cols={cols}
              intensityFor={intensityFor}
              key={`row-${r}`}
              row={r}
            />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-cg-muted">
        Well shade encodes dose (log scale); hover a well for its exact
        concentration.
      </p>
    </div>
  );
}

function FragmentRow({
  byCell,
  cols,
  intensityFor,
  row,
}: {
  byCell: Map<string, Sample>;
  cols: number[];
  intensityFor: (sample: Sample) => number | null;
  row: number;
}) {
  return (
    <>
      <div className="flex items-center text-[10px] text-cg-muted">
        {String.fromCharCode(65 + row)}
      </div>
      {cols.map((c) => {
        const sample = byCell.get(`${row}:${c}`);
        if (!sample) {
          return (
            <div
              className="aspect-square rounded-full border border-dashed border-cg-border"
              key={`cell-${row}-${c}`}
            />
          );
        }
        const supplement = sample.supplements[0];
        const intensity = intensityFor(sample);
        // A dose ramp from ~15% to ~85% accent; wells without a supplement get
        // a flat mid fill so they still read as populated.
        const pct = intensity === null ? 30 : Math.round(15 + intensity * 70);
        const title = [
          sample.vector ?? "—",
          sample.media ?? "—",
          supplement
            ? `${supplement.chemical} ${formatConcentration(supplement.concentration)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            className="aspect-square rounded-full border border-cg-accent/40"
            key={`cell-${row}-${c}`}
            style={{
              backgroundColor: `color-mix(in srgb, var(--cg-accent) ${pct}%, transparent)`,
            }}
            title={title}
          />
        );
      })}
    </>
  );
}
