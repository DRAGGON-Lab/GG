import {
  Handle,
  type NodeProps,
  Position,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { useEffect } from "react";

import { SbolGlyph } from "@/features/circuit/components/SbolGlyph";
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
import { glyphForKind } from "@/features/circuit/core/sbol-glyph";
import { cx } from "@/ui/class-name";

// Every node is a fixed-width box so its left/right connectors sit at consistent
// spots regardless of the glyph's shape. Handles align to the glyph band, which
// sits at the top of the box under the vertical padding.
const NODE_WIDTH = 132;
const GLYPH_SIZE = 44;
const BOX_PAD_TOP = 8;

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
          // Centered on the box side; multi-input operators fan out evenly
          // around that center.
          style={{ top: `${((index + 1) / (count + 1)) * 100}%` }}
          type={type}
        />
      ))}
    </>
  );
}

/// A node: a fixed-width box holding its SBOL Visual glyph, name, and (for
/// operators) parameter summary. Connectors sit on the box edges; double-click
/// opens the code peek (handled at the canvas level).
function GlyphNode({
  data,
  id,
  selected,
  showParams,
}: {
  data: CircuitNodeData;
  id: string;
  selected: boolean;
  showParams: boolean;
}) {
  const spec = getNodeSpec(data.kind);
  const targets = targetHandlesFor(data.kind, data.inputCount);

  // ReactFlow caches handle positions; tell it to re-measure when the node
  // mounts or its input count changes, so edges track the connectors.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data.inputCount, updateNodeInternals]);

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      {targets.length > 0 ? (
        <HandleColumn
          handles={targets}
          position={Position.Left}
          type="target"
        />
      ) : null}

      <div
        className={cx(
          "flex flex-col items-center gap-0.5 rounded-md border bg-cg-surface px-2 pb-2 shadow-sm transition-colors",
          selected ? "border-cg-accent" : "border-cg-border",
        )}
        style={{
          boxShadow: selected ? `0 0 0 1px ${spec.accent}` : undefined,
          paddingTop: BOX_PAD_TOP,
        }}
        title={spec.description}
      >
        <SbolGlyph
          color={glyphColor(data.kind, data.params, spec.accent)}
          glyph={glyphForKind(data.kind)}
          size={GLYPH_SIZE}
        />
        <span className="max-w-full truncate text-[12px] font-medium leading-tight text-cg-fg">
          {data.name}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-cg-muted">
          {spec.label}
        </span>
        {/* Always reserved so every node is the same height, params or not. */}
        <div className="mt-0.5 h-3 max-w-full truncate font-mono text-[9px] leading-3 text-cg-muted">
          {showParams ? paramSummaryText(data.kind, data.params) : ""}
        </div>
      </div>

      {spec.sources.length > 0 ? (
        <HandleColumn
          handles={spec.sources}
          position={Position.Right}
          type="source"
        />
      ) : null}
    </div>
  );
}

export function SpeciesNode({ data, id, selected }: NodeProps<AppNode>) {
  return (
    <GlyphNode
      data={data}
      id={id}
      selected={selected ?? false}
      showParams={data.kind === "regulator" || data.kind === "reporter"}
    />
  );
}

export function OperatorNode({ data, id, selected }: NodeProps<AppNode>) {
  return (
    <GlyphNode data={data} id={id} selected={selected ?? false} showParams />
  );
}

function paramSummaryText(
  kind: NodeKind,
  params: Record<string, unknown>,
): string {
  return getNodeSpec(kind)
    .params.map((paramSpec) => {
      const value = params[paramSpec.key];
      if (value === undefined || value === "") {
        return null;
      }
      if (paramSpec.key === "signal_id") {
        return null;
      }
      if (paramSpec.key === "init_concentration" && value === 0) {
        return null;
      }
      return `${summaryParamLabel(paramSpec.key)}=${formatParam(value)}`;
    })
    .filter((part): part is string => part !== null)
    .join(" ");
}

function formatParam(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatParam(entry)).join(",")}]`;
  }
  return String(value);
}

function glyphColor(
  kind: NodeKind,
  params: Record<string, unknown>,
  fallback: string,
): string {
  if (kind !== "reporter") {
    return fallback;
  }
  const color = params.color;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/iu.test(color)) {
    return fallback;
  }
  return fluorescentColor(color);
}

function fluorescentColor(color: string): string {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const max = Math.max(red, green, blue);
  const boost = max > 0 ? 255 / max : 1;
  const channel = (value: number) =>
    Math.round(Math.min(255, value * boost * 1.12))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function summaryParamLabel(key: string): string {
  switch (key) {
    case "degradation_rate":
      return "deg";
    case "init_concentration":
      return "init";
    default:
      return key;
  }
}
