import { useEffect, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  ResultTable,
  SectionHeader,
} from "@/features/flapjack/components/shared";
import {
  ANALYSIS_TYPES,
  type AnalysisTypeName,
  runAnalysis,
} from "@/features/flapjack/core/analysis-run";
import {
  loadCharacterization,
  saveCharacterization,
} from "@/features/flapjack/core/flapjack-service";
import type {
  CharacterizationDetail,
  Study,
} from "@/features/flapjack/core/flapjack-types";
import { Button, LoaderCircle, Play } from "@/ui";

const selectClass =
  "cursor-default rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 text-[12px] text-cg-fg";

type CharacterizationsViewProps = {
  studies: Study[];
  selectedRunId: number | null;
  onRunSaved: (id: number) => void;
};

export function CharacterizationsView({
  studies,
  selectedRunId,
  onRunSaved,
}: CharacterizationsViewProps) {
  const [detail, setDetail] = useState<CharacterizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [runStudyId, setRunStudyId] = useState<number | null>(null);
  const [runType, setRunType] = useState<AnalysisTypeName>(ANALYSIS_TYPES[0]);
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  // Keep the analysis form pointed at a valid study without an extra effect:
  // fall back to the first study whenever the picked one isn't in the list yet.
  const effectiveStudyId =
    runStudyId !== null && studies.some((study) => study.id === runStudyId)
      ? runStudyId
      : (studies[0]?.id ?? null);

  useEffect(() => {
    if (selectedRunId === null) return;
    let cancelled = false;
    loadCharacterization(selectedRunId).then(
      (loaded) => !cancelled && setDetail(loaded),
      (caught) =>
        !cancelled &&
        setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  // Only show detail once it matches the current selection (avoids a stale
  // flash while the next run loads).
  const currentDetail =
    detail && detail.characterization.id === selectedRunId ? detail : null;

  const runAndSave = async () => {
    if (effectiveStudyId === null || running) return;
    setRunning(true);
    setRunError(null);
    setRunLog([]);
    try {
      const payload = await runAnalysis(effectiveStudyId, runType, (line) =>
        setRunLog((current) => [...current.slice(-100), line]),
      );
      const saved = await saveCharacterization(payload);
      onRunSaved(saved.id);
    } catch (caught) {
      setRunError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <SectionHeader
        subtitle="Run a characterization on a study, then browse the persisted result rows."
        title="Characterizations"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-cg-border bg-cg-surface p-2.5">
        <select
          aria-label="Study to analyze"
          className={selectClass}
          disabled={running || studies.length === 0}
          onChange={(e) => setRunStudyId(Number(e.target.value))}
          value={effectiveStudyId ?? ""}
        >
          {studies.length === 0 ? <option value="">No studies</option> : null}
          {studies.map((study) => (
            <option key={study.id} value={study.id}>
              {study.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Analysis type"
          className={selectClass}
          disabled={running}
          onChange={(e) => setRunType(e.target.value as AnalysisTypeName)}
          value={runType}
        >
          {ANALYSIS_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Button
          disabled={running || effectiveStudyId === null}
          onClick={() => void runAndSave()}
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
            <Play aria-hidden="true" size={14} />
          )}
          {running ? "Running…" : "Run analysis"}
        </Button>
        {running && runLog.length > 0 ? (
          <span className="min-w-0 truncate text-[11px] text-cg-muted">
            {runLog[runLog.length - 1]}
          </span>
        ) : null}
      </div>

      {runError ? <ErrorState message={runError} /> : null}
      {error ? <ErrorState message={error} /> : null}

      {selectedRunId === null ? (
        <EmptyState message="No characterization selected. Pick a study and analysis type above, then Run." />
      ) : currentDetail ? (
        <CharacterizationDetailView detail={currentDetail} />
      ) : (
        <LoadingState />
      )}
    </div>
  );
}

function CharacterizationDetailView({
  detail,
}: {
  detail: CharacterizationDetail;
}) {
  const { data } = detail;
  if (data.length === 0) {
    return <EmptyState message="This run produced no rows." />;
  }
  const isDoseResponse = data.some((d) => d.concentration !== null);
  const columns = isDoseResponse
    ? ["sample", "signal", "metric", "value", "concentration"]
    : ["sample", "signal", "metric", "value", "time"];
  const rows = data
    .slice(0, 500)
    .map((d) => [
      String(d.sampleId),
      String(d.signalId),
      d.metric,
      d.value.toPrecision(4),
      isDoseResponse
        ? d.concentration === null
          ? ""
          : String(d.concentration)
        : d.time === null
          ? ""
          : d.time.toFixed(2),
    ]);
  return (
    <div className="grid gap-2">
      <div className="text-[11px] text-cg-muted">
        {data.length.toLocaleString()} rows
        {data.length > 500 ? " · showing first 500" : ""}
      </div>
      <ResultTable columns={columns} rows={rows} />
    </div>
  );
}
