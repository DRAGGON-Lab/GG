import type { Connection, EdgeChange, NodeChange } from "@xyflow/react";
import { createContext, useContext } from "react";

import type { EnvState } from "@/features/circuit/components/SimulationPanel";
import type { RunLine } from "@/features/circuit/core/circuit-run";
import type { AppEdge, AppNode } from "@/features/circuit/core/flow-adapter";
import type {
  CircuitDocument,
  CircuitNode,
  NodeKind,
  ParamValue,
  SimulationConfig,
} from "@/features/circuit/core/loica-model";
import type { TextEditorSettings } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";

/// Everything the dockview panels need. The dock panels are stable module-level
/// components; they read live page state through this context (React context
/// propagates through dockview's panel portals, as in the editor).
export type CircuitPageContextValue = {
  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;

  // Canvas
  nodes: AppNode[];
  edges: AppEdge[];
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onDropNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  isValidConnection: (connection: Connection | AppEdge) => boolean;
  onSelect: (nodeId: string | null) => void;
  getNodeSnippet: (id: string) => string;
  applyNodeCode: (id: string, code: string) => void;

  // Palette / sidebar
  addNode: (kind: NodeKind) => void;
  circuitName: string;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;

  // Node inspector (bound to the current selection)
  document: CircuitDocument;
  selectedNode: CircuitNode | null;
  renameNode: (name: string) => void;
  changeNodeParam: (key: string, value: ParamValue) => void;
  changeInputCount: (count: number) => void;
  replaceNodeFromCode: (patch: {
    name?: string;
    params: Record<string, ParamValue>;
  }) => void;
  deleteSelectedNode: () => void;

  // Generated code
  generatedScript: string;

  // Simulation
  simulation: SimulationConfig;
  updateSimulation: (patch: Partial<SimulationConfig>) => void;
  envState: EnvState;
  envError: string | null;
  envLog: string[];
  retryEnv: () => void;
  runSimulation: () => void;
  running: boolean;

  // Output
  runLines: RunLine[];
  exitCode: number | null;
};

export const CircuitPageContext = createContext<CircuitPageContextValue | null>(
  null,
);

export function useCircuitPage(): CircuitPageContextValue {
  const value = useContext(CircuitPageContext);
  if (!value) {
    throw new Error("useCircuitPage requires a CircuitPageContext provider");
  }
  return value;
}
