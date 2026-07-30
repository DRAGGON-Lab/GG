import {
  type CircuitDocument,
  type CircuitEdge,
  type CircuitNode,
  DEFAULT_SIMULATION,
  defaultParams,
  NODE_SPECS,
  type NodeKind,
  type ParamValue,
  type SimulationConfig,
} from "@/features/circuit/core/loica-model";

/**
 * The deliberately small interchange shared by GG Circuit, Quiver, and
 * grn-lean. Canvas positions, simulation settings, and SBOL annotations are GG
 * concerns and are not smuggled into this behavioral graph.
 */
export type GrnWireNode = {
  id: string;
  kind: NodeKind;
  name: string;
  params: Record<string, ParamValue>;
  inputCount?: number;
  componentId?: string;
};

export type GrnWireEdge = {
  source: string;
  target: string;
  port: number;
};

export type GrnWireV1 = {
  version: 1;
  nodes: GrnWireNode[];
  edges: GrnWireEdge[];
};

export function parseGrnWire(value: unknown): GrnWireV1 {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Expected GRN wire format version 1.");
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("GRN wire data must contain node and edge arrays.");
  }

  const ids = new Set<string>();
  const nodes = value.nodes.map((entry, index): GrnWireNode => {
    if (!isRecord(entry)) {
      throw new Error(`Node ${index + 1} is not an object.`);
    }
    const { id, kind, name } = entry;
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(`Node ${index + 1} has no id.`);
    }
    if (ids.has(id)) {
      throw new Error(`GRN wire data contains duplicate node id ${id}.`);
    }
    ids.add(id);
    if (typeof kind !== "string" || !(kind in NODE_SPECS)) {
      throw new Error(`Node ${id} has unsupported kind ${String(kind)}.`);
    }
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`Node ${id} has no name.`);
    }
    const node: GrnWireNode = {
      id,
      kind: kind as NodeKind,
      name,
      params: parseParams(entry.params, id),
    };
    if (entry.inputCount !== undefined) {
      if (
        typeof entry.inputCount !== "number" ||
        !Number.isInteger(entry.inputCount) ||
        entry.inputCount < 1
      ) {
        throw new Error(`Node ${id} has an invalid inputCount.`);
      }
      node.inputCount = entry.inputCount;
    }
    if (entry.componentId !== undefined) {
      if (
        typeof entry.componentId !== "string" ||
        entry.componentId.trim() === ""
      ) {
        throw new Error(`Node ${id} has an invalid componentId.`);
      }
      node.componentId = entry.componentId;
    }
    return node;
  });

  const edges = value.edges.map((entry, index): GrnWireEdge => {
    if (!isRecord(entry)) {
      throw new Error(`Edge ${index + 1} is not an object.`);
    }
    const { source, target, port } = entry;
    if (
      typeof source !== "string" ||
      typeof target !== "string" ||
      !ids.has(source) ||
      !ids.has(target)
    ) {
      throw new Error(`Edge ${index + 1} references an unknown node.`);
    }
    if (typeof port !== "number" || !Number.isInteger(port) || port < 0) {
      throw new Error(`Edge ${source} → ${target} has an invalid port.`);
    }
    const sourceNode = nodes.find((node) => node.id === source);
    const targetNode = nodes.find((node) => node.id === target);
    if (!sourceNode || !targetNode) {
      throw new Error(`Edge ${source} → ${target} references an unknown node.`);
    }
    if (
      NODE_SPECS[sourceNode.kind].category ===
      NODE_SPECS[targetNode.kind].category
    ) {
      throw new Error(
        `Edge ${source} → ${target} violates GRN bipartite wiring.`,
      );
    }
    if (NODE_SPECS[sourceNode.kind].sources.length === 0) {
      throw new Error(`Node ${source} cannot produce an outgoing edge.`);
    }
    const targetSpec = NODE_SPECS[targetNode.kind];
    const targetPorts = targetSpec.dynamicInputs
      ? Math.max(1, targetNode.inputCount ?? 1)
      : targetSpec.targets.length;
    if (targetPorts === 0 || port >= targetPorts) {
      throw new Error(
        `Edge ${source} → ${target} addresses unavailable port ${port}.`,
      );
    }
    return { port, source, target };
  });

  return { edges, nodes, version: 1 };
}

export function toGrnWire(document: CircuitDocument): GrnWireV1 {
  return {
    edges: document.edges.map((edge) => ({
      port: portFromHandle(edge.targetHandle),
      source: edge.source,
      target: edge.target,
    })),
    nodes: document.nodes.map((node) => {
      const wireNode: GrnWireNode = {
        id: node.id,
        kind: node.kind,
        name: node.name,
        params: node.params,
      };
      if (node.componentId) {
        wireNode.componentId = node.componentId;
      }
      if (node.inputCount !== undefined) {
        wireNode.inputCount = node.inputCount;
      }
      return wireNode;
    }),
    version: 1,
  };
}

export function documentFromGrnWire(
  input: GrnWireV1 | unknown,
  simulation: SimulationConfig = DEFAULT_SIMULATION,
): CircuitDocument {
  const wire = parseGrnWire(input);
  const positions = layoutWire(wire);
  const nodeById = new Map(wire.nodes.map((node) => [node.id, node]));
  const nodes: CircuitNode[] = wire.nodes.map((node) => {
    const circuitNode: CircuitNode = {
      id: node.id,
      kind: node.kind,
      name: node.name,
      params: { ...defaultParams(node.kind), ...node.params },
      position: positions.get(node.id) ?? { x: 80, y: 100 },
    };
    if (node.componentId) {
      circuitNode.componentId = node.componentId;
    }
    if (node.inputCount !== undefined) {
      circuitNode.inputCount = node.inputCount;
    }
    return circuitNode;
  });
  const edges: CircuitEdge[] = wire.edges.map((edge, index) => ({
    id: `design-${index}-${edge.source}-${edge.target}-${edge.port}`,
    source: edge.source,
    sourceHandle: "out",
    target: edge.target,
    targetHandle: handleFromPort(nodeById.get(edge.target), edge.port),
  }));
  return {
    edges,
    nodes,
    simulation: { ...simulation, biomass: [...simulation.biomass] },
    version: 1,
  };
}

function layoutWire(wire: GrnWireV1): Map<string, { x: number; y: number }> {
  const incoming = new Map(wire.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(wire.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of wire.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const rank = new Map(wire.nodes.map((node) => [node.id, 0]));
  const queue = wire.nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    visited.add(id);
    for (const target of outgoing.get(id) ?? []) {
      rank.set(
        target,
        Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1),
      );
      const nextIncoming = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(target);
      }
    }
  }

  // Cyclic components have no topological rank. Keep them together after the
  // feed-forward portion so the import is deterministic and remains editable.
  const maxRank = Math.max(0, ...rank.values());
  for (const node of wire.nodes) {
    if (!visited.has(node.id)) {
      rank.set(node.id, maxRank + 1);
    }
  }

  const layers = new Map<number, GrnWireNode[]>();
  for (const node of wire.nodes) {
    const nodeRank = rank.get(node.id) ?? 0;
    layers.set(nodeRank, [...(layers.get(nodeRank) ?? []), node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [layer, layerNodes] of layers) {
    layerNodes.forEach((node, index) => {
      positions.set(node.id, {
        x: 80 + layer * 220,
        y: 100 + index * 132,
      });
    });
  }
  return positions;
}

function portFromHandle(handle: string): number {
  if (handle === "in") {
    return 0;
  }
  const index = Number(handle.replace(/^in/, ""));
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

function handleFromPort(node: GrnWireNode | undefined, port: number): string {
  if (node?.kind === "hill2" || node?.kind === "sum") {
    return `in${port}`;
  }
  return "in";
}

function parseParams(
  value: unknown,
  nodeId: string,
): Record<string, ParamValue> {
  if (!isRecord(value)) {
    throw new Error(`Node ${nodeId} has invalid params.`);
  }
  const params: Record<string, ParamValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "number" ||
      typeof entry === "string" ||
      isNumberArray(entry) ||
      (Array.isArray(entry) && entry.every(isNumberArray))
    ) {
      params[key] = entry;
    } else {
      throw new Error(`Node ${nodeId} has an invalid ${key} parameter.`);
    }
  }
  return params;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "number")
  );
}
