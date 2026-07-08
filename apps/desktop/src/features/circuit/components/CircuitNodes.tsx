import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { ReactNode } from "react";

import type {
  AppNode,
  CircuitNodeData,
} from "@/features/circuit/core/flow-adapter";
import {
  getNodeSpec,
  type HandleSpec,
  NODE_SPECS,
  type NodeKind,
} from "@/features/circuit/core/loica-model";
import { cx } from "@/ui/class-name";

/// Evenly distribute N handles down an edge of the node.
function handleOffset(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

function targetHandlesFor(
  kind: NodeKind,
  inputCount: number | undefined,
): HandleSpec[] {
  const spec = NODE_SPECS[kind];
  if (!spec.dynamicInputs) {
    return spec.targets;
  }
  const count = Math.max(1, inputCount ?? 1);
  return Array.from({ length: count }, (_, index) => ({
    id: `in${index}`,
    label: `input ${index + 1}`,
  }));
}

function HandleColumn({
  handles,
  position,
  type,
}: {
  handles: HandleSpec[];
  position: Position;
  type: "source" | "target";
}) {
  const count = handles.length;
  return (
    <>
      {handles.map((handle, index) => (
        <Handle
          className="!size-2 !border-cg-border-strong !bg-cg-surface"
          id={handle.id}
          key={handle.id}
          position={position}
          style={{ top: handleOffset(index, count) }}
          type={type}
        />
      ))}
    </>
  );
}

/// Wraps a node's body with its input/output handles. Double-clicking a node
/// opens its code in the center peek (handled at the canvas level).
function NodeShell({
  children,
  data,
}: {
  children: ReactNode;
  data: CircuitNodeData;
}) {
  const targets = targetHandlesFor(data.kind, data.inputCount);
  const sources = NODE_SPECS[data.kind].sources;
  return (
    <div className="relative">
      {targets.length > 0 ? (
        <HandleColumn
          handles={targets}
          position={Position.Left}
          type="target"
        />
      ) : null}
      {children}
      {sources.length > 0 ? (
        <HandleColumn
          handles={sources}
          position={Position.Right}
          type="source"
        />
      ) : null}
    </div>
  );
}

export function SpeciesNode({ data, selected }: NodeProps<AppNode>) {
  const spec = getNodeSpec(data.kind);
  return (
    <NodeShell data={data}>
      <div
        className={cx(
          "min-w-[120px] rounded-full border bg-cg-surface px-3.5 py-2 text-center shadow-sm transition-colors",
          selected ? "border-cg-accent" : "border-cg-border",
        )}
        style={{ boxShadow: selected ? `0 0 0 1px ${spec.accent}` : undefined }}
      >
        <div className="flex items-center justify-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: spec.accent }}
          />
          <span className="truncate text-[12px] font-medium text-cg-fg">
            {data.name}
          </span>
        </div>
        <div className="mt-0.5 text-[9.5px] uppercase tracking-wide text-cg-muted">
          {spec.label}
        </div>
      </div>
    </NodeShell>
  );
}

export function OperatorNode({ data, selected }: NodeProps<AppNode>) {
  const spec = getNodeSpec(data.kind);
  return (
    <NodeShell data={data}>
      <div
        className={cx(
          "min-w-[132px] rounded-md border bg-cg-surface px-3 py-2 shadow-sm transition-colors",
          selected ? "border-cg-accent" : "border-cg-border",
        )}
        style={{
          borderLeft: `3px solid ${spec.accent}`,
          boxShadow: selected ? `0 0 0 1px ${spec.accent}` : undefined,
        }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12px] font-medium text-cg-fg">
            {data.name}
          </span>
          <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-cg-muted">
            {spec.label}
          </span>
        </div>
        <ParamSummary kind={data.kind} params={data.params} />
      </div>
    </NodeShell>
  );
}

function ParamSummary({
  kind,
  params,
}: {
  kind: NodeKind;
  params: Record<string, unknown>;
}) {
  const spec = getNodeSpec(kind);
  const parts = spec.params
    .map((paramSpec) => {
      const value = params[paramSpec.key];
      if (value === undefined || value === "") {
        return null;
      }
      return `${paramSpec.key}=${formatParam(value)}`;
    })
    .filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return null;
  }
  return (
    <div className="mt-1 truncate font-mono text-[9.5px] text-cg-muted">
      {parts.join(" ")}
    </div>
  );
}

function formatParam(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatParam(entry)).join(",")}]`;
  }
  return String(value);
}
