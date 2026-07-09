import type { Connection, Edge, Node } from "@xyflow/react";

import {
  type CircuitDocument,
  type CircuitEdge,
  type CircuitNode,
  NODE_SPECS,
  type NodeKind,
  type ParamValue,
  type SbolPartRef,
  type SimulationConfig,
} from "@/features/circuit/core/loica-model";

/// The data ReactFlow carries on each node. The domain node's identity (`id`)
/// and `position` live on the ReactFlow node itself; everything else rides here.
export type CircuitNodeData = {
  kind: NodeKind;
  name: string;
  params: Record<string, ParamValue>;
  sbolParts?: SbolPartRef[];
  inputCount?: number;
  [key: string]: unknown;
};

export type AppNode = Node<CircuitNodeData>;
export type AppEdge = Edge;

/// The ReactFlow node `type`, which selects the custom component. Both node
/// categories carry the same data shape; the component reads `data.kind`.
export function flowNodeType(kind: NodeKind): "species" | "operator" {
  return NODE_SPECS[kind].category;
}

export function toFlowNode(node: CircuitNode): AppNode {
  return {
    data: {
      inputCount: node.inputCount,
      kind: node.kind,
      name: node.name,
      params: node.params,
      sbolParts: node.sbolParts,
    },
    id: node.id,
    position: node.position,
    type: flowNodeType(node.kind),
  };
}

export function toFlowNodes(document: CircuitDocument): AppNode[] {
  return document.nodes.map(toFlowNode);
}

export function toFlowEdges(document: CircuitDocument): AppEdge[] {
  return document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  }));
}

export function nodeFromFlow(node: AppNode): CircuitNode {
  const domain: CircuitNode = {
    id: node.id,
    kind: node.data.kind,
    name: node.data.name,
    params: node.data.params,
    position: { x: node.position.x, y: node.position.y },
  };
  if (node.data.sbolParts !== undefined && node.data.sbolParts.length > 0) {
    domain.sbolParts = node.data.sbolParts;
  }
  if (node.data.inputCount !== undefined) {
    domain.inputCount = node.data.inputCount;
  }
  return domain;
}

export function edgeFromFlow(edge: AppEdge): CircuitEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? "out",
    target: edge.target,
    targetHandle: edge.targetHandle ?? "in",
  };
}

export function documentFromFlow(
  nodes: AppNode[],
  edges: AppEdge[],
  simulation: SimulationConfig,
): CircuitDocument {
  return {
    edges: edges.map(edgeFromFlow),
    nodes: nodes.map(nodeFromFlow),
    simulation,
    version: 1,
  };
}

/// A connection is valid only between opposite categories (species ↔ operator),
/// mirroring Loica's bipartite `input`/`output` wiring, and never onto itself.
export function isValidConnection(
  connection: Connection | Edge,
  nodesById: Map<string, AppNode>,
): boolean {
  if (connection.source === connection.target) {
    return false;
  }
  const source = nodesById.get(connection.source ?? "");
  const target = nodesById.get(connection.target ?? "");
  if (!source || !target) {
    return false;
  }
  const sourceCategory = NODE_SPECS[source.data.kind].category;
  const targetCategory = NODE_SPECS[target.data.kind].category;
  return sourceCategory !== targetCategory;
}
