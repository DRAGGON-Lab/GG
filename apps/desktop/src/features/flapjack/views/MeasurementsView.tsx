import { useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/features/flapjack/components/shared";
import {
  loadAssays,
  loadMeasurements,
  loadSignals,
  loadStudies,
} from "@/features/flapjack/core/flapjack-service";
import type {
  Assay,
  Measurement,
  Signal,
  Study,
} from "@/features/flapjack/core/flapjack-types";

const LINE_COLORS = [
  "#4ade80",
  "#38bdf8",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
  "#34d399",
  "#60a5fa",
];

const selectClass =
  "cursor-default rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 text-[12px] text-cg-fg";

export function MeasurementsView() {
  const [studies, setStudies] = useState<Study[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [assays, setAssays] = useState<{
    studyId: number;
    list: Assay[];
  } | null>(null);
  const [studyId, setStudyId] = useState<number | null>(null);
  const [assayId, setAssayId] = useState<number | null>(null);
  const [signalId, setSignalId] = useState<number | null>(null);
  const [measurements, setMeasurements] = useState<{
    key: string;
    list: Measurement[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadStudies(), loadSignals()]).then(
      ([loadedStudies, loadedSignals]) => {
        if (cancelled) return;
        setStudies(loadedStudies);
        setSignals(loadedSignals);
        if (loadedStudies.length > 0) setStudyId(loadedStudies[0].id);
      },
      (caught) =>
        !cancelled &&
        setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (studyId === null) return;
    let cancelled = false;
    loadAssays(studyId).then(
      (list) => !cancelled && setAssays({ studyId, list }),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  const currentAssays = assays && assays.studyId === studyId ? assays.list : [];
  // Reset the assay filter to "all" when it doesn't belong to the active study.
  const effectiveAssayId =
    assayId !== null && currentAssays.some((assay) => assay.id === assayId)
      ? assayId
      : null;
  const measKey = `${studyId}:${effectiveAssayId}:${signalId}`;

  useEffect(() => {
    if (studyId === null) return;
    let cancelled = false;
    const key = `${studyId}:${effectiveAssayId}:${signalId}`;
    loadMeasurements({ studyId, assayId: effectiveAssayId, signalId }).then(
      (list) => !cancelled && setMeasurements({ key, list }),
      (caught) =>
        !cancelled &&
        setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, [studyId, effectiveAssayId, signalId]);

  const currentMeasurements =
    measurements && measurements.key === measKey ? measurements.list : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <SectionHeader
        subtitle="Time-series readings, one line per sample."
        title="Measurements"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Study"
          className={selectClass}
          onChange={(e) => setStudyId(Number(e.target.value))}
          value={studyId ?? ""}
        >
          {studies.map((study) => (
            <option key={study.id} value={study.id}>
              {study.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Assay"
          className={selectClass}
          onChange={(e) =>
            setAssayId(e.target.value ? Number(e.target.value) : null)
          }
          value={effectiveAssayId ?? ""}
        >
          <option value="">All assays</option>
          {currentAssays.map((assay) => (
            <option key={assay.id} value={assay.id}>
              {assay.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Signal"
          className={selectClass}
          onChange={(e) =>
            setSignalId(e.target.value ? Number(e.target.value) : null)
          }
          value={signalId ?? ""}
        >
          <option value="">All signals</option>
          {signals.map((signal) => (
            <option key={signal.id} value={signal.id}>
              {signal.name}
            </option>
          ))}
        </select>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {studies.length === 0 && !error ? (
        <EmptyState message="No studies yet." />
      ) : null}
      {studyId !== null && !currentMeasurements && !error ? (
        <LoadingState />
      ) : null}
      {currentMeasurements ? (
        <TimeSeriesChart measurements={currentMeasurements} />
      ) : null}
    </div>
  );
}

function TimeSeriesChart({ measurements }: { measurements: Measurement[] }) {
  const series = useMemo(
    () => groupBySampleAndSignal(measurements),
    [measurements],
  );

  if (measurements.length === 0) {
    return <EmptyState message="No measurements match this selection." />;
  }

  const width = 640;
  const height = 320;
  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const times = measurements.map((m) => m.time);
  const values = measurements.map((m) => m.value);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const vMin = Math.min(...values, 0);
  const vMax = Math.max(...values);
  const xScale = (t: number) =>
    pad.left +
    ((t - tMin) / (tMax - tMin || 1)) * (width - pad.left - pad.right);
  const yScale = (v: number) =>
    height -
    pad.bottom -
    ((v - vMin) / (vMax - vMin || 1)) * (height - pad.top - pad.bottom);

  return (
    <div className="grid gap-2">
      <div className="overflow-auto rounded-[8px] border border-cg-border bg-cg-editor p-2">
        <svg
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="currentColor"
            strokeOpacity={0.2}
            x1={pad.left}
            x2={width - pad.right}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
          />
          <line
            stroke="currentColor"
            strokeOpacity={0.2}
            x1={pad.left}
            x2={pad.left}
            y1={pad.top}
            y2={height - pad.bottom}
          />
          <text
            className="fill-cg-muted text-[10px]"
            x={pad.left}
            y={height - 8}
          >
            {tMin.toFixed(1)}
          </text>
          <text
            className="fill-cg-muted text-[10px]"
            textAnchor="end"
            x={width - pad.right}
            y={height - 8}
          >
            {tMax.toFixed(1)} h
          </text>
          <text className="fill-cg-muted text-[10px]" x={2} y={pad.top + 8}>
            {vMax.toPrecision(3)}
          </text>
          {series.map((line, index) => (
            <polyline
              fill="none"
              key={line.key}
              points={line.points
                .map((p) => `${xScale(p.time)},${yScale(p.value)}`)
                .join(" ")}
              stroke={LINE_COLORS[index % LINE_COLORS.length]}
              strokeWidth={1.3}
            />
          ))}
        </svg>
      </div>
      <div className="text-[11px] text-cg-muted">
        {measurements.length.toLocaleString()} readings · {series.length} series
      </div>
    </div>
  );
}

function groupBySampleAndSignal(measurements: Measurement[]) {
  const map = new Map<string, { time: number; value: number }[]>();
  for (const m of measurements) {
    const key = `${m.sampleId}:${m.signalId}`;
    const points = map.get(key) ?? [];
    points.push({ time: m.time, value: m.value });
    map.set(key, points);
  }
  return Array.from(map.entries()).map(([key, points]) => ({
    key,
    points: points.sort((a, b) => a.time - b.time),
  }));
}
