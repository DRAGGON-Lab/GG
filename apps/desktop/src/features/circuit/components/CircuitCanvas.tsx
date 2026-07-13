import {
  Background,
  type Connection,
  Controls,
  type EdgeChange,
  type NodeChange,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";

import "@xyflow/react/dist/style.css";
import "@/features/circuit/circuit.css";

import {
  OperatorNode,
  SpeciesNode,
} from "@/features/circuit/components/CircuitNodes";
import { NodeCodePeek } from "@/features/circuit/components/NodeCodePeek";
import type { AppEdge, AppNode } from "@/features/circuit/core/flow-adapter";
import { NODE_SPECS, type NodeKind } from "@/features/circuit/core/loica-model";
import type { TextEditorSettings } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";

const DRAG_MIME = "application/gg-circuit-node";

const CIRCUIT_NODE_TYPES = {
  operator: OperatorNode,
  species: SpeciesNode,
};

export function CircuitCanvas({
  applyNodeCode,
  edges,
  getNodeSnippet,
  isValidConnection,
  nodes,
  onConnect,
  onDropNode,
  onEdgesChange,
  onNodesChange,
  onSelect,
  resolvedTheme,
  textEditorSettings,
}: {
  applyNodeCode: (id: string, code: string) => void;
  edges: AppEdge[];
  getNodeSnippet: (id: string) => string;
  isValidConnection: (connection: Connection | AppEdge) => boolean;
  nodes: AppNode[];
  onConnect: (connection: Connection) => void;
  onDropNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  onSelect: (nodeId: string | null) => void;
  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;
}) {
  const { fitView, screenToFlowPosition } = useReactFlow();

  // `fitView` on mount runs before custom nodes are measured, which over-zooms;
  // refit once ReactFlow has real node dimensions. Fires once (the flag stays
  // true), so later edits don't re-frame the canvas.
  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    if (nodesInitialized) {
      void fitView({ maxZoom: 1, padding: 0.2 });
    }
  }, [nodesInitialized, fitView]);

  // The center peek shows one node's code at a time. `peek` holds the displayed
  // node through its exit transition; `open` drives the enter/exit.
  const [peek, setPeek] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!peek) {
      return;
    }
    // Mount closed, then open on the next frame so the enter transition runs.
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [peek]);

  const closePeek = useCallback(() => {
    setOpen(false);
    const timer = setTimeout(() => setPeek(null), 160);
    return () => clearTimeout(timer);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(DRAG_MIME);
      if (!kind || !(kind in NODE_SPECS)) {
        return;
      }
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      onDropNode(kind as NodeKind, position);
    },
    [onDropNode, screenToFlowPosition],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        colorMode={resolvedTheme}
        deleteKeyCode={["Backspace", "Delete"]}
        edges={edges}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        isValidConnection={isValidConnection}
        nodes={nodes}
        nodeTypes={CIRCUIT_NODE_TYPES}
        onConnect={onConnect}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDoubleClick={(_, node) =>
          setPeek({ id: node.id, name: node.data.name })
        }
        onNodesChange={onNodesChange}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {peek ? (
        <NodeCodePeek
          initialCode={getNodeSnippet(peek.id)}
          key={peek.id}
          name={peek.name}
          nodeId={peek.id}
          onChange={(code) => applyNodeCode(peek.id, code)}
          onClose={closePeek}
          open={open}
          resolvedTheme={resolvedTheme}
          textEditorSettings={textEditorSettings}
        />
      ) : null}
    </div>
  );
}
