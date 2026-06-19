import { Copy } from "lucide-react";

import type { PythonEntry } from "@/features/python/types";
import { Button } from "@/ui";

const pythonOutputClassName =
  "grid grid-cols-[48px_minmax(0,1fr)] gap-3 [@container(max-width:520px)]:grid-cols-[minmax(0,1fr)] [@container(max-width:520px)]:gap-1.5";

const pythonOutputLabelClassName =
  "pt-3 font-mono text-[12px] font-semibold leading-none text-cg-muted [@container(max-width:520px)]:pt-0";

const pythonPrimarySurfaceClassName =
  "grid min-w-0 gap-3 rounded-[7px] border border-cg-border bg-cg-surface px-3.5 py-3";

const pythonContextLabelClassName =
  "text-[10.5px] font-bold uppercase leading-none text-cg-muted";

const pythonMathTextClassName =
  "m-0 min-w-0 overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-normal text-cg-fg";

const pythonEntryMetaClassName =
  "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] font-medium leading-tight text-cg-muted";

const pythonIconButtonClassName =
  "size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:border-transparent hover:bg-cg-surface-hover hover:text-cg-fg";

export function PythonResult({
  entry,
  outputNumber,
}: {
  entry: PythonEntry;
  outputNumber: number;
}) {
  if (entry.status === "evaluating") {
    return (
      <PythonStatusResult
        kind="info"
        outputNumber={outputNumber}
        title="Running"
        value="Executing in the local Pyodide Python session..."
      />
    );
  }

  if (entry.status === "failed") {
    return (
      <PythonStatusResult
        kind="error"
        outputNumber={outputNumber}
        title="Error"
        value={entry.error ?? "Python evaluation failed"}
      />
    );
  }

  if (!entry.evaluation) {
    return null;
  }

  const { evaluation } = entry;

  return (
    <div className={pythonOutputClassName}>
      <span className={pythonOutputLabelClassName}>Out[{outputNumber}]</span>
      <div className="grid min-w-0 gap-2.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold leading-none text-cg-fg">
              Python
            </div>
            <div className="mt-1 truncate text-[11.5px] font-medium leading-none text-cg-muted">
              persistent Pyodide session
            </div>
          </div>
          {evaluation.result ? (
            <Button
              aria-label="Copy Python result"
              className={pythonIconButtonClassName}
              onClick={() =>
                copyText(
                  evaluation.result?.copyValue ?? evaluation.result?.text ?? "",
                )
              }
              size="none"
              title="Copy result"
              type="button"
              variant="bare"
            >
              <Copy aria-hidden="true" size={14} strokeWidth={1.9} />
            </Button>
          ) : null}
        </div>

        {evaluation.stdout ? (
          <PythonOutputBlock label="stdout" value={evaluation.stdout} />
        ) : null}
        {evaluation.stderr ? (
          <PythonOutputBlock label="stderr" muted value={evaluation.stderr} />
        ) : null}
        {evaluation.result ? (
          <section className={pythonPrimarySurfaceClassName}>
            <div className="grid min-w-0 gap-2">
              <div className={pythonContextLabelClassName}>
                {evaluation.result.typeName}
              </div>
              <pre className="m-0 min-w-0 overflow-x-auto whitespace-pre-wrap text-[18px] font-mono leading-relaxed text-cg-fg">
                {evaluation.result.text}
              </pre>
            </div>
            {evaluation.result.repr !== evaluation.result.text ? (
              <pre className="m-0 min-w-0 overflow-x-auto whitespace-pre-wrap border-t border-cg-border pt-2 font-mono text-[12px] leading-normal text-cg-muted">
                {evaluation.result.repr}
              </pre>
            ) : null}
          </section>
        ) : null}
        {evaluation.error ? (
          <PythonOutputBlock error label="error" value={evaluation.error} />
        ) : null}
        {evaluation.warnings.length > 0 ? (
          <PythonOutputBlock
            label="packages"
            muted
            value={evaluation.warnings.join("\n")}
          />
        ) : null}
        <PythonMetadata evaluation={evaluation} />
      </div>
    </div>
  );
}

function PythonStatusResult({
  kind,
  outputNumber,
  title,
  value,
}: {
  kind: "error" | "info";
  outputNumber: number;
  title: string;
  value: string;
}) {
  return (
    <div className={pythonOutputClassName}>
      <span className={pythonOutputLabelClassName}>Out[{outputNumber}]</span>
      <section
        className={[
          pythonPrimarySurfaceClassName,
          kind === "info" ? "animate-pulse" : "",
          kind === "error" ? "border-cg-danger [&_pre]:text-cg-danger" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={pythonContextLabelClassName}>{title}</div>
        <pre className={pythonMathTextClassName}>{value}</pre>
      </section>
    </div>
  );
}

function PythonOutputBlock({
  error = false,
  label,
  muted = false,
  value,
}: {
  error?: boolean;
  label: string;
  muted?: boolean;
  value: string;
}) {
  return (
    <section
      className={[
        pythonPrimarySurfaceClassName,
        error ? "border-cg-danger" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={pythonContextLabelClassName}>{label}</div>
      <pre
        className={[
          pythonMathTextClassName,
          muted ? "text-cg-muted" : "",
          error ? "text-cg-danger" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </pre>
    </section>
  );
}

function PythonMetadata({
  evaluation,
}: {
  evaluation: PythonEntry["evaluation"];
}) {
  if (!evaluation) {
    return null;
  }

  return (
    <div className={pythonEntryMetaClassName}>
      <span>
        {evaluation.kernel.runtime} {evaluation.kernel.runtimeVersion}
      </span>
      <span aria-hidden="true">·</span>
      <span>{evaluation.elapsedMs} ms</span>
      <span aria-hidden="true">·</span>
      <span>{evaluation.loadedPackages.length} packages</span>
      <span aria-hidden="true">·</span>
      <span>{evaluation.kernel.offline ? "offline" : "online"}</span>
    </div>
  );
}

function copyText(value: string) {
  if (!navigator.clipboard) {
    return;
  }

  void navigator.clipboard.writeText(value).catch(() => undefined);
}
