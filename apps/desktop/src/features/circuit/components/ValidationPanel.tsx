import { type ReactNode, useEffect, useMemo, useState } from "react";

import { isTauriRuntime } from "@/features/circuit/core/circuit-run";
import { toGrnWire } from "@/features/circuit/core/grn-wire";
import type { CircuitDocument } from "@/features/circuit/core/loica-model";
import {
  getGrnAnalyzerStatus,
  type GrnAnalyzerStatus,
  runGrnLeanValidation,
} from "@/features/circuit/core/validation-run";
import type {
  StructuralValidationResult,
  ValidationState,
} from "@/features/circuit/core/validation-types";
import {
  AlertCircle,
  Binary,
  Button,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  LoaderCircle,
} from "@/ui";
import { cx } from "@/ui/class-name";

export function ValidationPanel({ document }: { document: CircuitDocument }) {
  const desktop = isTauriRuntime();
  const [runtime, setRuntime] = useState<GrnAnalyzerStatus | null>(null);
  const [state, setState] = useState<ValidationState>("idle");
  const [result, setResult] = useState<StructuralValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runSignature, setRunSignature] = useState<string | null>(null);
  const designSignature = useMemo(
    () => JSON.stringify(toGrnWire(document)),
    [document],
  );

  useEffect(() => {
    let cancelled = false;
    void getGrnAnalyzerStatus()
      .then((status) => {
        if (!cancelled) {
          setRuntime(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntime({ available: false, source: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleState =
    runSignature === designSignature ? state : ("idle" as const);
  const visibleResult = runSignature === designSignature ? result : null;
  const visibleError = runSignature === designSignature ? error : null;

  const run = async () => {
    if (visibleState === "running" || !desktop || runtime?.available !== true) {
      return;
    }
    setRunSignature(designSignature);
    setState("running");
    setResult(null);
    setError(null);
    try {
      const next = await runGrnLeanValidation(document);
      setResult(next);
      setState("complete");
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Structural analysis failed.",
      );
      setState("error");
    }
  };

  const actualUnavailable = !desktop || runtime?.available === false;
  const actualChecking = desktop && runtime === null;

  return (
    <div className="flex min-h-full flex-col gap-4 p-3">
      <header className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-cg-border bg-cg-surface text-cg-accent">
          <Binary aria-hidden="true" size={14} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-cg-fg">
            Structural validation hints
          </h2>
          <p className="mt-0.5 text-[10.5px] leading-[1.45] text-cg-muted">
            Check necessary topology gates with grn-lean before spending time on
            simulation and characterization.
          </p>
        </div>
      </header>

      {actualUnavailable ? (
        <HintBanner>
          {desktop
            ? "The grn-lean analyzer is missing. Development discovers a sibling build; packaged apps load runtime/grn-lean/analyze."
            : "Structural validation runs through grn-lean in the GG desktop app. This browser build cannot produce validation evidence."}
        </HintBanner>
      ) : (
        <p className="text-[10.5px] leading-[1.45] text-cg-muted">
          grn-lean reads the lossless GRN wire object. Canvas layout and
          simulation settings are outside its claim.
        </p>
      )}

      <Button
        className="h-8 justify-center"
        disabled={
          visibleState === "running" || actualUnavailable || actualChecking
        }
        onClick={() => void run()}
        size="md"
      >
        {visibleState === "running" || actualChecking ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
        ) : (
          <Binary aria-hidden="true" size={14} />
        )}
        {visibleState === "running"
          ? "Checking structure…"
          : actualChecking
            ? "Checking analyzer…"
            : actualUnavailable
              ? desktop
                ? "Analyzer unavailable"
                : "Desktop app required"
              : "Analyze current circuit"}
      </Button>

      {visibleError ? <ErrorBanner message={visibleError} /> : null}
      {visibleResult ? <ValidationResults result={visibleResult} /> : null}

      <div className="mt-auto border-t border-cg-border pt-3 text-[10px] leading-[1.5] text-cg-muted">
        Structural gates are hints, not behavior proofs. Dynamical theorems also
        require assumptions such as well-posed positive degradation, acyclicity
        where applicable, and regularity; this report does not discharge all of
        them.
      </div>
    </div>
  );
}

function ValidationResults({ result }: { result: StructuralValidationResult }) {
  const { report } = result;
  return (
    <section className="grid gap-2.5 border-t border-cg-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold text-cg-fg">
            Structural gates
          </h3>
          <p className="mt-0.5 text-[10px] text-cg-muted">
            {result.engine} · kernel-checked predicates · {result.source}
          </p>
        </div>
        {result.elapsedMs !== null ? (
          <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-cg-muted">
            {result.elapsedMs} ms
          </span>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <GateCard
          absentText="Sign conflict blocks the monotonicity gate"
          label="Sensor"
          passed={report.certifies.sensor}
          passedText="Monotonicity gate present"
        />
        <GateCard
          absentText="No positive feedback loop"
          label="Switch"
          passed={report.certifies.switch}
          passedText="Positive feedback loop present"
        />
        <GateCard
          absentText="No negative feedback loop"
          label="Oscillator"
          passed={report.certifies.oscillator}
          passedText="Negative feedback loop present"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-[7px] border border-cg-border bg-cg-surface/50 p-2.5">
        <EvidenceCell
          label="Signed edges"
          value={String(report.signedInteractionGraph.length)}
        />
        <EvidenceCell
          label="Grounded"
          value={report.fullyGrounded ? "yes" : "no"}
        />
        <EvidenceCell label="Parts" value={String(report.billOfParts.length)} />
      </div>

      <details className="group rounded-[7px] border border-cg-border bg-cg-surface/40">
        <summary className="flex cursor-default list-none items-center justify-between px-2.5 py-2 text-[10.5px] font-medium text-cg-muted [&::-webkit-details-marker]:hidden">
          Signed interaction graph
          <ChevronDown
            aria-hidden="true"
            className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            size={13}
          />
        </summary>
        <div className="grid gap-1 border-t border-cg-border p-2.5 font-mono text-[10px] text-cg-fg">
          {report.signedInteractionGraph.length > 0 ? (
            report.signedInteractionGraph.map(
              ([source, target, sign], index) => (
                <div
                  className="flex items-center gap-1.5"
                  key={`${source}-${target}-${index}`}
                >
                  <span className="truncate">{source}</span>
                  <span
                    className={sign < 0 ? "text-cg-danger" : "text-cg-success"}
                  >
                    {sign < 0 ? "−|" : "→"}
                  </span>
                  <span className="truncate">{target}</span>
                </div>
              ),
            )
          ) : (
            <span className="font-sans text-cg-muted">
              No signed species interactions.
            </span>
          )}
        </div>
      </details>
    </section>
  );
}

function GateCard({
  absentText,
  label,
  passed,
  passedText,
}: {
  absentText: string;
  label: string;
  passed: boolean;
  passedText: string;
}) {
  return (
    <div className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-2 rounded-[7px] border border-cg-border bg-cg-surface p-2.5">
      <div
        className={cx(
          "flex size-[26px] items-center justify-center rounded-[6px]",
          passed
            ? "bg-[color-mix(in_srgb,var(--cg-success),transparent_88%)] text-cg-success"
            : "bg-cg-editor text-cg-muted",
        )}
      >
        {passed ? (
          <CheckCircle2 aria-hidden="true" size={14} />
        ) : (
          <CircleDashed aria-hidden="true" size={14} />
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-cg-fg">{label}</span>
          <span className="text-[9px] font-medium uppercase tracking-wide text-cg-muted">
            {passed ? "present" : "absent"}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-cg-muted">
          {passed ? passedText : absentText}
        </p>
      </div>
    </div>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-medium uppercase tracking-wide text-cg-muted">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[10.5px] text-cg-fg">{value}</div>
    </div>
  );
}

function HintBanner({ children }: { children: ReactNode }) {
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
