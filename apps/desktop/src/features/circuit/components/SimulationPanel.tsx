import type { SimulationConfig } from "@/features/circuit/core/loica-model";
import { Button, LoaderCircle, Play, Save } from "@/ui";

/// The managed-environment lifecycle as the panel sees it. `unavailable` is the
/// non-desktop case; the rest mirror `ensureCircuitEnv`'s phases plus `error`.
export type EnvState =
  | "unavailable"
  | "idle"
  | "checking"
  | "creating"
  | "installing"
  | "ready"
  | "error";

export function SimulationPanel({
  canSaveResults,
  config,
  envError,
  envLog,
  envState,
  onChange,
  onRetry,
  onRun,
  onSaveResults,
  running,
  saveError,
  savedStudyId,
  saveState,
}: {
  canSaveResults: boolean;
  config: SimulationConfig;
  envError: string | null;
  envLog: string[];
  envState: EnvState;
  onChange: (patch: Partial<SimulationConfig>) => void;
  onRetry: () => void;
  onRun: () => void;
  onSaveResults: () => void;
  running: boolean;
  saveError: string | null;
  savedStudyId: number | null;
  saveState: "idle" | "saving" | "saved" | "error";
}) {
  const canRun = envState === "ready" && !running;
  return (
    <div className="flex min-h-0 flex-col gap-3 p-3">
      <EnvBanner
        error={envError}
        log={envLog}
        onRetry={onRetry}
        state={envState}
      />

      <Field
        help={config.method === "ssa" ? "SSA" : "ODE"}
        label="Simulation method"
      >
        <select
          className="w-full min-w-0 rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 text-[12px] text-cg-fg outline-none focus:border-cg-accent"
          onChange={(event) =>
            onChange({
              method: event.target.value === "ssa" ? "ssa" : "ode",
            })
          }
          value={config.method}
        >
          <option value="ode">Ordinary differential equations</option>
          <option value="ssa">Stochastic simulation algorithm</option>
        </select>
      </Field>
      {config.method === "ode" ? (
        <Field help="0 disables" label="ODE noise-to-signal ratio">
          <NumberInput
            onChange={(nsr) => onChange({ nsr: Math.max(0, nsr) })}
            value={config.nsr}
          />
        </Field>
      ) : null}

      <Field label="Dose sweep">
        <div className="flex gap-1">
          <NumberInput
            aria-label="Dose minimum"
            onChange={(doseMin) => onChange({ doseMin })}
            value={config.doseMin}
          />
          <NumberInput
            aria-label="Dose maximum"
            onChange={(doseMax) => onChange({ doseMax })}
            value={config.doseMax}
          />
        </div>
      </Field>
      <Field help="samples" label="Dose points">
        <NumberInput
          onChange={(dosePoints) => onChange({ dosePoints })}
          value={config.dosePoints}
        />
      </Field>
      <Field label="Measurements">
        <NumberInput
          onChange={(nMeasurements) => onChange({ nMeasurements })}
          value={config.nMeasurements}
        />
      </Field>
      <Field help="hours" label="Interval">
        <NumberInput
          onChange={(interval) => onChange({ interval })}
          value={config.interval}
        />
      </Field>
      <Field help="[y0, ymax, um, lag]" label="Gompertz biomass">
        <div className="flex gap-1">
          {config.biomass.map((value, index) => (
            <NumberInput
              aria-label={`Biomass parameter ${index + 1}`}
              key={index}
              onChange={(next) => {
                const biomass = [
                  ...config.biomass,
                ] as SimulationConfig["biomass"];
                biomass[index] = next;
                onChange({ biomass });
              }}
              value={value}
            />
          ))}
        </div>
      </Field>

      <Button
        className="mt-1 justify-center"
        disabled={!canRun}
        onClick={onRun}
        size="sm"
        variant="default"
      >
        {running ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
        ) : (
          <Play aria-hidden="true" size={14} />
        )}
        {running ? "Running…" : "Run simulation"}
      </Button>

      {canSaveResults ? (
        <div className="flex flex-col gap-1">
          <Button
            className="justify-center"
            disabled={saveState === "saving"}
            onClick={onSaveResults}
            size="sm"
            variant="ghost"
          >
            {saveState === "saving" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                size={14}
              />
            ) : (
              <Save aria-hidden="true" size={14} />
            )}
            {saveState === "saving" ? "Saving…" : "Save results to Flapjack"}
          </Button>
          {saveState === "saved" && savedStudyId !== null ? (
            <span className="text-[10.5px] text-cg-muted">
              Saved as study #{savedStudyId}. Open the Flapjack tab to explore.
            </span>
          ) : null}
          {saveState === "error" && saveError ? (
            <span className="text-[10.5px] text-cg-danger">{saveError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const ENV_MESSAGE: Record<EnvState, string> = {
  checking: "Checking simulation environment…",
  creating: "Creating the Python environment…",
  error: "Environment setup failed.",
  idle: "Preparing simulation environment…",
  installing: "Installing loica — first run only, this can take a minute…",
  ready: "Environment ready.",
  unavailable: "Simulation is available in the desktop app.",
};

function EnvBanner({
  error,
  log,
  onRetry,
  state,
}: {
  error: string | null;
  log: string[];
  onRetry: () => void;
  state: EnvState;
}) {
  const busy =
    state === "checking" || state === "creating" || state === "installing";
  const showLog = busy || state === "error";
  const tail = log.slice(-4);

  return (
    <div className="flex flex-col gap-1.5 rounded-[6px] border border-cg-border bg-cg-surface px-2.5 py-2 text-[11px]">
      <div className="flex items-center gap-1.5 text-cg-fg">
        {busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="shrink-0 animate-spin text-cg-muted"
            size={13}
          />
        ) : null}
        <span>{state === "error" && error ? error : ENV_MESSAGE[state]}</span>
      </div>
      {showLog && tail.length > 0 ? (
        <pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-all font-mono text-[9.5px] leading-snug text-cg-muted">
          {tail.join("\n")}
        </pre>
      ) : null}
      {state === "error" ? (
        <Button
          className="mt-0.5 self-start"
          onClick={onRetry}
          size="sm"
          variant="ghost"
        >
          Retry setup
        </Button>
      ) : null}
    </div>
  );
}

function Field({
  children,
  help,
  label,
}: {
  children: React.ReactNode;
  help?: string;
  label: string;
}) {
  return (
    <label className="grid gap-1 text-[11px] text-cg-muted">
      <span className="flex items-baseline justify-between">
        <span>{label}</span>
        {help ? (
          <span className="font-mono text-[9.5px] text-cg-muted/70">
            {help}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  "aria-label": ariaLabel,
  onChange,
  value,
}: {
  "aria-label"?: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <input
      aria-label={ariaLabel}
      className="w-full min-w-0 rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 text-[12px] text-cg-fg outline-none focus:border-cg-accent"
      inputMode="decimal"
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) {
          onChange(next);
        }
      }}
      type="number"
      value={value}
    />
  );
}
