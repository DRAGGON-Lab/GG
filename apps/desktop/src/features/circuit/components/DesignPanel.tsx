import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type {
  DesignCandidate,
  DesignDirection,
  DesignPortfolio,
  DesignRequest,
  DesignRunState,
} from "@/features/circuit/core/design-types";
import { NODE_SPECS } from "@/features/circuit/core/loica-model";
import {
  AlertCircle,
  Button,
  CheckCircle2,
  ChevronDown,
  Dna,
  LoaderCircle,
  LoadingBlock,
  RotateCcw,
  Sparkles,
  WandSparkles,
  Waypoints,
} from "@/ui";
import { cx } from "@/ui/class-name";

type DesignPanelProps = {
  adoptedCandidateId: string | null;
  canUndoAdoption: boolean;
  desktopAvailable: boolean;
  error: string | null;
  onAdopt: (candidate: DesignCandidate) => void;
  onRequestChange: (patch: Partial<DesignRequest>) => void;
  onRun: () => void;
  onUndoAdoption: () => void;
  portfolio: DesignPortfolio | null;
  progress: string[];
  request: DesignRequest;
  state: DesignRunState;
};

const INPUT_CLASS =
  "w-full min-w-0 rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1.5 text-[12px] text-cg-fg outline-none transition-colors focus:border-cg-accent motion-reduce:transition-none";

export function DesignPanel({
  adoptedCandidateId,
  canUndoAdoption,
  desktopAvailable,
  error,
  onAdopt,
  onRequestChange,
  onRun,
  onUndoAdoption,
  portfolio,
  progress,
  request,
  state,
}: DesignPanelProps) {
  const busy = state === "preparing" || state === "running";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (portfolio) {
      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ block: "start" });
      });
    }
  }, [portfolio]);

  const selected =
    portfolio?.candidates.find((candidate) => candidate.id === selectedId) ??
    portfolio?.candidates[0] ??
    null;

  return (
    <div className="flex min-h-full flex-col gap-4 p-3">
      <header className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-cg-border bg-cg-surface text-cg-accent">
          <Sparkles aria-hidden="true" size={14} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-cg-fg">
            Design a sensor circuit
          </h2>
          <p className="mt-0.5 text-[10.5px] leading-[1.45] text-cg-muted">
            Describe the transfer function. Compare distinct topologies before
            placing one on the canvas.
          </p>
        </div>
      </header>

      <fieldset className="contents" disabled={busy}>
        <section className="grid grid-cols-2 gap-2.5">
          <Field label="Output signal">
            <input
              className={INPUT_CLASS}
              onChange={(event) =>
                onRequestChange({ signal: event.target.value })
              }
              spellCheck={false}
              value={request.signal}
            />
          </Field>
          <Field label="Direction">
            <select
              className={INPUT_CLASS}
              onChange={(event) =>
                onRequestChange({
                  direction: event.target.value as DesignDirection,
                })
              }
              value={request.direction}
            >
              <option value="up">Rises with dose</option>
              <option value="down">Falls with dose</option>
              <option value="any">Either direction</option>
            </select>
          </Field>
          <Field help="concentration" label="Target EC50">
            <NumberInput
              min={Number.MIN_VALUE}
              onChange={(ec50) => onRequestChange({ ec50 })}
              value={request.ec50}
            />
          </Field>
          <Field help="fold change" label="Dynamic range">
            <NumberInput
              min={1}
              onChange={(dynamicRange) => onRequestChange({ dynamicRange })}
              value={request.dynamicRange}
            />
          </Field>
        </section>

        <details className="group rounded-[7px] border border-cg-border bg-cg-surface/40">
          <summary className="flex cursor-default list-none items-center justify-between px-2.5 py-2 text-[11px] font-medium text-cg-muted [&::-webkit-details-marker]:hidden">
            Search settings
            <ChevronDown
              aria-hidden="true"
              className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
              size={13}
            />
          </summary>
          <div className="grid grid-cols-2 gap-2.5 border-t border-cg-border p-2.5">
            <Field label="Inducer">
              <input
                className={INPUT_CLASS}
                onChange={(event) =>
                  onRequestChange({ inducer: event.target.value })
                }
                spellCheck={false}
                value={request.inducer}
              />
            </Field>
            <Field label="Candidate budget">
              <NumberInput
                max={500}
                min={8}
                onChange={(budget) => onRequestChange({ budget })}
                step={1}
                value={request.budget}
              />
            </Field>
            <Field label="Pass threshold">
              <NumberInput
                max={1}
                min={0}
                onChange={(threshold) => onRequestChange({ threshold })}
                step={0.05}
                value={request.threshold}
              />
            </Field>
            <Field label="Random seed">
              <NumberInput
                onChange={(seed) => onRequestChange({ seed })}
                step={1}
                value={request.seed}
              />
            </Field>
          </div>
        </details>
      </fieldset>

      {desktopAvailable ? (
        <p className="text-[10.5px] leading-[1.45] text-cg-muted">
          Every operator is assigned a Component from GG Data. Reported kinetics
          are used when available; missing values use an explicit Cello-derived
          population prior under robust uncertainty scoring.
        </p>
      ) : (
        <RuntimeBanner>
          Automated design runs through Quiver in the GG desktop app. This
          browser build cannot compute candidate circuits.
        </RuntimeBanner>
      )}

      <Button
        className="h-8 justify-center"
        disabled={busy || !desktopAvailable}
        onClick={onRun}
        size="md"
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
        ) : (
          <WandSparkles aria-hidden="true" size={14} />
        )}
        {busy
          ? state === "preparing"
            ? "Preparing runtime…"
            : "Designing portfolio…"
          : desktopAvailable
            ? "Run Quiver"
            : "Desktop app required"}
      </Button>

      {error ? <ErrorBanner message={error} /> : null}
      {busy ? <PortfolioLoading progress={progress} /> : null}
      {!busy && portfolio ? (
        <div ref={resultsRef}>
          <PortfolioResults
            adoptedCandidateId={adoptedCandidateId}
            canUndoAdoption={canUndoAdoption}
            onAdopt={onAdopt}
            onSelect={setSelectedId}
            onUndoAdoption={onUndoAdoption}
            portfolio={portfolio}
            selected={selected}
          />
        </div>
      ) : null}
    </div>
  );
}

function PortfolioResults({
  adoptedCandidateId,
  canUndoAdoption,
  onAdopt,
  onSelect,
  onUndoAdoption,
  portfolio,
  selected,
}: {
  adoptedCandidateId: string | null;
  canUndoAdoption: boolean;
  onAdopt: (candidate: DesignCandidate) => void;
  onSelect: (id: string) => void;
  onUndoAdoption: () => void;
  portfolio: DesignPortfolio;
  selected: DesignCandidate | null;
}) {
  const adoptedRank = portfolio.candidates.find(
    (candidate) => candidate.id === adoptedCandidateId,
  )?.rank;
  const selectedComponents = selected?.assignments ?? [];
  return (
    <section className="grid gap-2.5 border-t border-cg-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold text-cg-fg">
            {portfolio.candidates.length} distinct{" "}
            {portfolio.candidates.length === 1 ? "topology" : "topologies"}
          </h3>
          <p className="mt-0.5 text-[10px] text-cg-muted">
            {portfolio.engine.name} {portfolio.engine.version} ·{" "}
            {portfolio.library.eligiblePartCount} eligible SBOL parts
          </p>
        </div>
        {portfolio.elapsedMs !== null ? (
          <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-cg-muted">
            {formatDuration(portfolio.elapsedMs)}
          </span>
        ) : null}
      </div>

      {adoptedCandidateId && canUndoAdoption ? (
        <div className="flex items-center justify-between gap-2 rounded-[7px] border border-[color-mix(in_srgb,var(--cg-success),transparent_50%)] bg-[color-mix(in_srgb,var(--cg-success),transparent_90%)] px-2.5 py-2 text-[10.5px] text-cg-fg">
          <span className="flex items-center gap-1.5">
            <CheckCircle2
              aria-hidden="true"
              className="text-cg-success"
              size={13}
            />
            Candidate {adoptedRank ?? adoptedCandidateId} is on the canvas.
          </span>
          <button
            className="flex items-center gap-1 font-medium text-cg-muted hover:text-cg-fg"
            onClick={onUndoAdoption}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={11} />
            Undo
          </button>
        </div>
      ) : null}

      {portfolio.candidates.length === 0 ? (
        <div className="rounded-[7px] border border-cg-border bg-cg-surface p-3 text-[11px] leading-[1.5] text-cg-muted">
          {portfolio.rejectedUngrounded > 0
            ? "Quiver could not produce a candidate fully assigned to the available SBOL parts. Add compatible sensors or regulatory gates to Data."
            : `No fully grounded candidate cleared the ${portfolio.target.threshold.toFixed(2)} pass threshold. Lower it or increase the search budget.`}
        </div>
      ) : (
        <div className="grid gap-1.5">
          {portfolio.candidates.map((candidate) => (
            <CandidateCard
              active={selected?.id === candidate.id}
              candidate={candidate}
              key={candidate.id}
              onClick={() => onSelect(candidate.id)}
            />
          ))}
        </div>
      )}

      {selected ? (
        <div className="grid gap-2 rounded-[8px] border border-cg-border bg-cg-surface/55 p-2.5">
          <div className="grid grid-cols-3 gap-2">
            <EvidenceCell
              label="Topology"
              value={selected.topologyId.slice(0, 8)}
            />
            <EvidenceCell
              label="SBOL parts"
              value={String(selected.assignments.length)}
            />
            <EvidenceCell
              label="Kinetics"
              value={`${selected.reportedOperators}/${selected.assignments.length} reported`}
            />
          </div>
          <p className="text-[10px] leading-[1.45] text-cg-muted">
            Score measures robust target-objective match using reported kinetics
            and explicit population priors. It is not an experimental validation
            certificate.
          </p>
          {selectedComponents.length > 0 ? (
            <details className="group rounded-[6px] border border-cg-border bg-cg-editor/45">
              <summary className="flex cursor-default list-none items-center justify-between px-2 py-1.5 text-[9.5px] font-medium text-cg-muted [&::-webkit-details-marker]:hidden">
                {selectedComponents.length} SBOL component assignment
                {selectedComponents.length === 1 ? "" : "s"}
                <ChevronDown
                  aria-hidden="true"
                  className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                  size={11}
                />
              </summary>
              <div className="grid gap-1 border-t border-cg-border px-2 py-1.5 text-[9.5px]">
                {selectedComponents.map((assignment) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
                    key={assignment.nodeId}
                  >
                    <span
                      className="truncate text-cg-fg"
                      title={assignment.part.iri}
                    >
                      {assignment.part.displayId ??
                        assignment.part.name ??
                        assignment.part.iri}
                    </span>
                    <span className="font-mono text-cg-muted">
                      {assignment.role} · {assignment.kineticsEvidence}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <Button
            className="justify-center"
            onClick={() => onAdopt(selected)}
            size="sm"
            variant="subtle"
          >
            <Waypoints aria-hidden="true" size={13} />
            Use candidate {selected.rank} on canvas
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function CandidateCard({
  active,
  candidate,
  onClick,
}: {
  active: boolean;
  candidate: DesignCandidate;
  onClick: () => void;
}) {
  const operatorCount = candidate.design.nodes.filter(
    (node) => NODE_SPECS[node.kind].category === "operator",
  ).length;
  return (
    <button
      aria-pressed={active}
      className={cx(
        "grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border bg-cg-surface px-2 py-2 text-left transition-colors duration-150 motion-reduce:transition-none",
        active
          ? "border-cg-accent bg-[color-mix(in_srgb,var(--cg-accent),transparent_92%)]"
          : "border-cg-border hover:border-cg-border-strong hover:bg-cg-surface-hover",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="grid text-center">
        <span className="text-[9px] font-medium uppercase tracking-wide text-cg-muted">
          #{candidate.rank}
        </span>
        <span className="font-mono text-[13px] font-semibold tabular-nums text-cg-fg">
          {candidate.score.toFixed(2)}
        </span>
      </span>
      <span className="min-w-0">
        <TopologyPreview candidate={candidate} />
        <span className="mt-1 flex items-center gap-2 text-[9.5px] text-cg-muted">
          <span className="flex items-center gap-1">
            <Waypoints aria-hidden="true" size={10} />
            {operatorCount} {operatorCount === 1 ? "stage" : "stages"}
          </span>
          <span className="flex items-center gap-1">
            <Dna aria-hidden="true" size={10} />
            {candidate.assignments.length} SBOL parts
          </span>
          <span>
            {candidate.priorOperators === 0
              ? "reported kinetics"
              : `${candidate.priorOperators} prior`}
          </span>
        </span>
      </span>
      <span
        className="size-1.5 rounded-full bg-cg-success"
        title="Quiver-computed, fully SBOL-assigned candidate"
      />
    </button>
  );
}

function TopologyPreview({ candidate }: { candidate: DesignCandidate }) {
  const layout = useMemo(() => miniLayout(candidate), [candidate]);
  return (
    <svg
      aria-label={`Candidate ${candidate.rank} topology`}
      className="h-[36px] w-full overflow-visible"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox="0 0 250 40"
    >
      {candidate.design.edges.map((edge, index) => {
        const source = layout.get(edge.source);
        const target = layout.get(edge.target);
        return source && target ? (
          <line
            key={`${edge.source}-${edge.target}-${index}`}
            stroke="var(--cg-border-strong)"
            strokeWidth="1.2"
            x1={source.x}
            x2={target.x}
            y1={source.y}
            y2={target.y}
          />
        ) : null;
      })}
      {candidate.design.nodes.map((node) => {
        const point = layout.get(node.id) ?? { x: 0, y: 0 };
        return (
          <g key={node.id}>
            <title>{node.name}</title>
            <circle
              cx={point.x}
              cy={point.y}
              fill={NODE_SPECS[node.kind].accent}
              r={NODE_SPECS[node.kind].category === "species" ? 4.5 : 5.5}
              stroke="var(--cg-editor-bg)"
              strokeWidth="1.5"
            />
          </g>
        );
      })}
    </svg>
  );
}

function miniLayout(candidate: DesignCandidate) {
  const nodes = candidate.design.nodes;
  const result = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const fraction = nodes.length <= 1 ? 0.5 : index / (nodes.length - 1);
    const category = NODE_SPECS[node.kind].category;
    result.set(node.id, {
      x: 8 + fraction * 234,
      y: category === "species" ? 25 : 13,
    });
  });
  return result;
}

function PortfolioLoading({ progress }: { progress: string[] }) {
  return (
    <section
      aria-live="polite"
      className="grid gap-2.5 border-t border-cg-border pt-3"
    >
      <div className="flex items-center gap-2 text-[10.5px] text-cg-muted">
        <LoaderCircle aria-hidden="true" className="animate-spin" size={13} />
        {progress[progress.length - 1] ?? "Preparing design search…"}
      </div>
      {[0, 1, 2].map((index) => (
        <div
          className="flex h-[58px] items-center gap-3 rounded-[8px] border border-cg-border p-2"
          key={index}
        >
          <LoadingBlock className="size-8 rounded-[6px]" />
          <div className="grid flex-1 gap-2">
            <LoadingBlock className="h-2.5 w-[82%] rounded-full" />
            <LoadingBlock className="h-2 w-[55%] rounded-full" />
          </div>
        </div>
      ))}
    </section>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-medium uppercase tracking-wide text-cg-muted">
        {label}
      </div>
      <div className="truncate font-mono text-[10.5px] text-cg-fg">{value}</div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-[7px] border border-cg-danger/45 bg-cg-danger/10 px-2.5 py-2 text-[10.5px] leading-[1.45] text-cg-danger"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-px shrink-0" size={13} />
      {message}
    </div>
  );
}

function RuntimeBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[7px] border border-cg-warning/45 bg-cg-warning/10 px-2.5 py-2 text-[10.5px] leading-[1.45] text-cg-muted">
      <AlertCircle
        aria-hidden="true"
        className="mt-px shrink-0 text-cg-warning"
        size={13}
      />
      {children}
    </div>
  );
}

function Field({
  children,
  help,
  label,
}: {
  children: ReactNode;
  help?: string;
  label: string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[10.5px] text-cg-muted">
      <span className="flex items-center justify-between gap-2">
        {label}
        {help ? <span className="text-[9px] opacity-75">{help}</span> : null}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  max,
  min,
  onChange,
  step = "any",
  value,
}: {
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number | "any";
  value: number;
}) {
  return (
    <input
      className={`${INPUT_CLASS} font-mono tabular-nums`}
      max={max}
      min={min}
      onChange={(event) => onChange(Number(event.target.value))}
      step={step}
      type="number"
      value={value}
    />
  );
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  if (milliseconds < 60_000) {
    return `${(milliseconds / 1000).toFixed(1)} s`;
  }
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}
