import { useMemo, useState } from "react";

import { LoicaCodeEditor } from "@/features/circuit/components/LoicaCodeEditor";
import {
  assignVarNames,
  constructorCall,
  parseParamsFromCode,
  resolveWiring,
} from "@/features/circuit/core/codegen";
import {
  type CircuitDocument,
  type CircuitNode,
  getNodeSpec,
  type ParamSpec,
  type ParamValue,
} from "@/features/circuit/core/loica-model";
import type { TextEditorSettings } from "@/features/settings";
import { Button, type ResolvedTheme } from "@/ui";
import { cx } from "@/ui/class-name";

type NodeInspectorProps = {
  document: CircuitDocument;
  node: CircuitNode;
  onDelete: () => void;
  onInputCountChange: (count: number) => void;
  onParamChange: (key: string, value: ParamValue) => void;
  onRename: (name: string) => void;
  onReplaceFromCode: (patch: {
    name?: string;
    params: Record<string, ParamValue>;
  }) => void;
  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;
};

export function NodeInspector({
  document,
  node,
  onDelete,
  onInputCountChange,
  onParamChange,
  onRename,
  onReplaceFromCode,
  resolvedTheme,
  textEditorSettings,
}: NodeInspectorProps) {
  const [mode, setMode] = useState<"form" | "code">("form");
  const spec = getNodeSpec(node.kind);

  const { inputNames, outputNames, snippet } = useMemo(() => {
    const varById = assignVarNames(document);
    const varName = varById.get(node.id) ?? "node";
    const isOperator = spec.category === "operator";
    const wiring = isOperator ? resolveWiring(document, node, varById) : null;

    const inputs = isOperator
      ? document.edges
          .filter((edge) => edge.target === node.id)
          .sort((a, b) =>
            a.targetHandle.localeCompare(b.targetHandle, undefined, {
              numeric: true,
            }),
          )
          .map(
            (edge) =>
              document.nodes.find((candidate) => candidate.id === edge.source)
                ?.name ?? edge.source,
          )
      : document.edges
          .filter((edge) => edge.target === node.id)
          .map(
            (edge) =>
              document.nodes.find((candidate) => candidate.id === edge.source)
                ?.name ?? edge.source,
          );

    const outputs = document.edges
      .filter((edge) => edge.source === node.id)
      .map(
        (edge) =>
          document.nodes.find((candidate) => candidate.id === edge.target)
            ?.name ?? edge.target,
      );

    return {
      inputNames: inputs,
      outputNames: outputs,
      snippet: `${varName} = ${constructorCall(node, wiring)}`,
    };
  }, [document, node, spec.category]);

  return (
    <div className="flex min-h-0 flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-cg-muted">
          {spec.label}
        </span>
        <div className="flex gap-0.5 rounded-[6px] border border-cg-border p-0.5">
          <ModeButton
            active={mode === "form"}
            label="Form"
            onClick={() => setMode("form")}
          />
          <ModeButton
            active={mode === "code"}
            label="Code"
            onClick={() => setMode("code")}
          />
        </div>
      </div>

      <label className="grid gap-1 text-[11px] text-cg-muted">
        Name
        <input
          className="rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 text-[12px] text-cg-fg outline-none focus:border-cg-accent"
          onChange={(event) => onRename(event.target.value)}
          spellCheck={false}
          value={node.name}
        />
      </label>

      <WiringSummary
        category={spec.category}
        inputNames={inputNames}
        outputNames={outputNames}
      />

      {mode === "form" ? (
        <div className="flex flex-col gap-2.5">
          {spec.dynamicInputs ? (
            <InputCountControl
              count={Math.max(1, node.inputCount ?? 1)}
              onChange={onInputCountChange}
            />
          ) : null}
          {spec.params.map((paramSpec) => (
            <ParamField
              key={paramSpec.key}
              onChange={(value) => onParamChange(paramSpec.key, value)}
              spec={paramSpec}
              value={node.params[paramSpec.key] ?? paramSpec.default}
            />
          ))}
          {spec.params.length === 0 ? (
            <p className="text-[11px] text-cg-muted">No parameters.</p>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-[160px] flex-col gap-1.5">
          <p className="text-[10.5px] text-cg-muted">
            Editing parameters below syncs to the form. Wiring (
            <code className="font-mono">input</code>/
            <code className="font-mono">output</code>) is managed by the graph.
          </p>
          <div className="flex min-h-[140px]">
            <NodeCodeEditor
              key={node.id}
              kind={node.kind}
              nodeId={node.id}
              nodeName={node.name}
              onReplaceFromCode={onReplaceFromCode}
              resolvedTheme={resolvedTheme}
              snippet={snippet}
              textEditorSettings={textEditorSettings}
            />
          </div>
        </div>
      )}

      <Button className="mt-1" onClick={onDelete} size="sm" variant="ghost">
        Delete node
      </Button>
    </div>
  );
}

/// The per-node code editor. Keyed by node id and mounted only in code mode, so
/// its local state seeds from the current generated snippet each time it opens
/// and edits flow out without the regenerated snippet fighting the cursor.
function NodeCodeEditor({
  kind,
  nodeId,
  nodeName,
  onReplaceFromCode,
  resolvedTheme,
  snippet,
  textEditorSettings,
}: {
  kind: CircuitNode["kind"];
  nodeId: string;
  nodeName: string;
  onReplaceFromCode: NodeInspectorProps["onReplaceFromCode"];
  resolvedTheme: ResolvedTheme;
  snippet: string;
  textEditorSettings: TextEditorSettings;
}) {
  const [code, setCode] = useState(snippet);
  return (
    <LoicaCodeEditor
      ariaLabel={`Loica code for ${nodeName}`}
      lineNumbers={false}
      modelUri={`inmemory://circuit-node/${nodeId}.py`}
      onChange={(next) => {
        setCode(next);
        onReplaceFromCode(parseParamsFromCode(kind, next));
      }}
      resolvedTheme={resolvedTheme}
      textEditorSettings={textEditorSettings}
      value={code}
    />
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cx(
        "cursor-pointer rounded-[4px] border-none px-2 py-0.5 text-[11px]",
        active
          ? "bg-cg-surface-hover text-cg-fg"
          : "bg-transparent text-cg-muted hover:text-cg-fg",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function WiringSummary({
  category,
  inputNames,
  outputNames,
}: {
  category: "species" | "operator";
  inputNames: string[];
  outputNames: string[];
}) {
  const inputLabel = category === "operator" ? "Inputs" : "Produced by";
  const outputLabel = category === "operator" ? "Outputs" : "Regulates";
  return (
    <div className="grid gap-1 rounded-[6px] border border-cg-border bg-cg-surface px-2.5 py-2 text-[11px]">
      <WiringRow label={inputLabel} names={inputNames} />
      <WiringRow label={outputLabel} names={outputNames} />
    </div>
  );
}

function WiringRow({ label, names }: { label: string; names: string[] }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[76px] shrink-0 text-cg-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-cg-fg">
        {names.length > 0 ? names.join(", ") : "—"}
      </span>
    </div>
  );
}

function InputCountControl({
  count,
  onChange,
}: {
  count: number;
  onChange: (count: number) => void;
}) {
  return (
    <div className="flex items-center justify-between text-[11px] text-cg-muted">
      <span>Inputs</span>
      <div className="flex items-center gap-1.5">
        <StepButton
          disabled={count <= 1}
          label="−"
          onClick={() => onChange(count - 1)}
        />
        <span className="w-4 text-center font-mono text-cg-fg">{count}</span>
        <StepButton label="+" onClick={() => onChange(count + 1)} />
      </div>
    </div>
  );
}

function StepButton({
  disabled,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="size-5 cursor-pointer rounded-[4px] border border-cg-border bg-cg-surface text-cg-fg disabled:cursor-default disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ParamField({
  onChange,
  spec,
  value,
}: {
  onChange: (value: ParamValue) => void;
  spec: ParamSpec;
  value: ParamValue;
}) {
  return (
    <label className="grid gap-1 text-[11px] text-cg-muted">
      <span className="flex items-baseline justify-between">
        <span>{spec.label}</span>
        {spec.help ? (
          <span className="font-mono text-[9.5px] text-cg-muted/70">
            {spec.help}
          </span>
        ) : null}
      </span>
      <ParamInput onChange={onChange} spec={spec} value={value} />
    </label>
  );
}

function ParamInput({
  onChange,
  spec,
  value,
}: {
  onChange: (value: ParamValue) => void;
  spec: ParamSpec;
  value: ParamValue;
}) {
  if (spec.kind === "string") {
    return (
      <input
        className="rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 text-[12px] text-cg-fg outline-none focus:border-cg-accent"
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={typeof value === "string" ? value : ""}
      />
    );
  }

  if (spec.kind === "number") {
    return (
      <NumberInput
        onChange={onChange}
        value={typeof value === "number" ? value : 0}
      />
    );
  }

  if (spec.kind === "number[]" && spec.arity) {
    const vector = Array.isArray(value) ? (value as number[]) : [];
    return (
      <div className="flex gap-1">
        {Array.from({ length: spec.arity }, (_, index) => (
          <NumberInput
            key={index}
            onChange={(next) => {
              const copy = [...vector];
              copy[index] = next;
              onChange(copy);
            }}
            value={typeof vector[index] === "number" ? vector[index] : 0}
          />
        ))}
      </div>
    );
  }

  // Variable-length vectors and matrices (Sum) edit as a compact literal.
  return (
    <ListInput onChange={onChange} value={value as number[] | number[][]} />
  );
}

function NumberInput({
  onChange,
  value,
}: {
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <input
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

/// A text field for a numeric list/matrix literal (`[1, 2]` or `[[0, 1]]`). The
/// field is only committed when it parses to the expected shape, so a mid-edit
/// keystroke never writes a malformed value.
function ListInput({
  onChange,
  value,
}: {
  onChange: (value: number[] | number[][]) => void;
  value: number[] | number[][];
}) {
  const [text, setText] = useState(() => JSON.stringify(value));
  const [dirty, setDirty] = useState(false);

  const display = dirty ? text : JSON.stringify(value);

  return (
    <input
      className="rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 font-mono text-[11.5px] text-cg-fg outline-none focus:border-cg-accent"
      onBlur={() => setDirty(false)}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        setDirty(true);
        try {
          const parsed = JSON.parse(next) as unknown;
          if (isNumberArrayOrMatrix(parsed)) {
            onChange(parsed);
          }
        } catch {
          // Keep the raw text until it parses; do not write a malformed value.
        }
      }}
      spellCheck={false}
      value={display}
    />
  );
}

function isNumberArrayOrMatrix(value: unknown): value is number[] | number[][] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    (entry) =>
      typeof entry === "number" ||
      (Array.isArray(entry) && entry.every((n) => typeof n === "number")),
  );
}
