import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import {
  addEdge,
  type Connection,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
} from "dockview-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CircuitPageContext,
  type CircuitPageContextValue,
  useCircuitPage,
} from "@/features/circuit/circuit-page-context";
import { CircuitCanvas } from "@/features/circuit/components/CircuitCanvas";
import {
  CircuitDockPanel,
  type CircuitDockPanelParams,
  CircuitDockTab,
} from "@/features/circuit/components/CircuitDock";
import { CircuitOutputPanel } from "@/features/circuit/components/CircuitOutputPanel";
import { LoicaCodeEditor } from "@/features/circuit/components/LoicaCodeEditor";
import { NodeInspector } from "@/features/circuit/components/NodeInspector";
import { NodePalette } from "@/features/circuit/components/NodePalette";
import { SimulationPanel } from "@/features/circuit/components/SimulationPanel";
import type { EnvState } from "@/features/circuit/components/SimulationPanel";
import {
  CIRCUIT_FILE_EXTENSION,
  loadCircuitFile,
  loadInitialDocument,
  loadStoredPath,
  saveCircuitFile,
  serializeDocument,
  storeDocument,
  storePath,
} from "@/features/circuit/core/circuit-file";
import {
  ensureCircuitEnv,
  getFlapjackServerUrl,
  getSbolServerUrl,
  isTauriRuntime,
  runCircuitScript,
  type RunLine,
} from "@/features/circuit/core/circuit-run";
import {
  buildSbolExportSource,
  generateScript,
  nodeSnippet,
  parseParamsFromCode,
  SBOL_EXPORT_MIME,
} from "@/features/circuit/core/codegen";
import {
  type AppEdge,
  type AppNode,
  documentFromFlow,
  isValidConnection as isValidConnectionRule,
  nodeFromFlow,
  toFlowEdges,
  toFlowNode,
  toFlowNodes,
} from "@/features/circuit/core/flow-adapter";
import {
  createNode,
  emptyDocument,
  type NodeKind,
  type ParamValue,
  resizedSumParams,
  type SbolPartRef,
  type SimulationConfig,
} from "@/features/circuit/core/loica-model";
import { importDocument } from "@/features/data/core/data-service";
import { parseDisplay } from "@/features/editor/components/artifacts/display";
import { importStudy } from "@/features/flapjack/core/flapjack-service";
import type { ExperimentManifest } from "@/features/flapjack/core/flapjack-types";
import { FLAPJACK_MANIFEST_MIME } from "@/features/flapjack/core/flapjack-types";
import { useAppSettings } from "@/features/settings";
import { useTheme } from "@/ui";
import { dockviewThemeByMode } from "@/workbench/theme";

function baseName(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function isSbolExportPayload(value: unknown): value is SbolExportPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.rdfXml === "string" &&
    Array.isArray(record.identities) &&
    typeof record.validationCount === "number" &&
    Array.isArray(record.validationReport)
  );
}

const CIRCUIT_DOCK_COMPONENTS = { circuitPanel: CircuitDockPanel };
const CIRCUIT_DOCK_TAB_COMPONENTS = { circuitTab: CircuitDockTab };

const CANVAS_PANEL_ID = "circuit-canvas";
const NODE_PANEL_ID = "circuit-node";
const CODE_PANEL_ID = "circuit-code";
const SIMULATE_PANEL_ID = "circuit-simulate";
const OUTPUT_PANEL_ID = "circuit-output";

// The right tool group is compact for Node/Simulate but widens for the Code tab
// so the generated script is readable without a manual resize each time.
const TOOL_GROUP_WIDTH = 320;
const CODE_GROUP_WIDTH = 640;

type SbolExportPayload = {
  identities: string[];
  rdfXml: string;
  validationCount: number;
  validationReport: string[];
};

// Panel renderers are module constants that read live page state from context,
// so dockview never needs to re-run them when state changes.
const renderCanvas = () => <CanvasPanel />;
const renderPalette = () => <PalettePanel />;
const renderNode = () => <NodePanel />;
const renderCode = () => <CodePanel />;
const renderSimulate = () => <SimulateTabPanel />;
const renderOutput = () => <OutputPanel />;

export function CircuitPage() {
  return (
    <ReactFlowProvider>
      <CircuitWorkspace />
    </ReactFlowProvider>
  );
}

function CircuitWorkspace() {
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();

  // First launch opens the example template; after that the user's own circuit
  // is restored from session storage (an empty board persists once seeded).
  const initial = useMemo(() => loadInitialDocument(), []);

  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(
    toFlowNodes(initial),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(
    toFlowEdges(initial),
  );
  const [simulation, setSimulation] = useState<SimulationConfig>(
    initial.simulation,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(() =>
    loadStoredPath(),
  );
  // The document as of the last save / open / new. Comparing it to the live
  // document yields the unsaved-changes ("dirty") state.
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    serializeDocument(initial),
  );

  const rootRef = useRef<HTMLDivElement>(null);

  const [runLines, setRunLines] = useState<RunLine[]>([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [envState, setEnvState] = useState<EnvState>(
    isTauriRuntime() ? "idle" : "unavailable",
  );
  const [envError, setEnvError] = useState<string | null>(null);
  const [envLog, setEnvLog] = useState<string[]>([]);

  // The most recent run's experiment manifest, captured from the diverted
  // display artifact; the "Save to Flapjack" action persists it to the store.
  const [manifest, setManifest] = useState<ExperimentManifest | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [savedStudyId, setSavedStudyId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sbolExportState, setSbolExportState] = useState<
    "idle" | "exporting" | "imported" | "error"
  >("idle");
  const [sbolExportError, setSbolExportError] = useState<string | null>(null);
  const [sbolExportGraphId, setSbolExportGraphId] = useState<string | null>(
    null,
  );
  const [sbolExportIssueCount, setSbolExportIssueCount] = useState(0);
  const [sbolExportObjectCount, setSbolExportObjectCount] = useState(0);
  const [sbolExportReport, setSbolExportReport] = useState<string[]>([]);
  // The embedded sbol-db server's loopback URL, resolved once. Passed into the
  // generated script so it can pull SBOL parts from the corpus over HTTP.
  const [sbolDbUrl, setSbolDbUrl] = useState<string | null>(null);
  // The embedded Flapjack API server's loopback URL, resolved once (its Python
  // environment and process are brought up on first use). Passed into the
  // generated script so it can construct a pre-authenticated pyFlapjack client.
  const [flapjackUrl, setFlapjackUrl] = useState<string | null>(null);

  const addCounterRef = useRef(0);
  const envRootRef = useRef<string | null>(null);
  const envPromiseRef = useRef<Promise<string | null> | null>(null);
  const dockApiRef = useRef<DockviewApi | null>(null);

  const nodesById = useMemo(() => {
    const map = new Map<string, AppNode>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);

  const document = useMemo(
    () => documentFromFlow(nodes, edges, simulation),
    [nodes, edges, simulation],
  );

  useEffect(() => {
    let cancelled = false;
    getSbolServerUrl().then((url) => {
      if (!cancelled) {
        setSbolDbUrl(url);
      }
    });
    getFlapjackServerUrl().then((url) => {
      if (!cancelled) {
        setFlapjackUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const generatedScript = useMemo(
    () => generateScript(document, sbolDbUrl, flapjackUrl),
    [document, sbolDbUrl, flapjackUrl],
  );

  const dirty = useMemo(
    () => serializeDocument(document) !== savedSnapshot,
    [document, savedSnapshot],
  );

  // Persist the working document to session storage so it survives reloads even
  // without an on-disk file.
  useEffect(() => {
    storeDocument(document);
  }, [document]);

  const isValidConnection = useCallback(
    (connection: Connection | AppEdge) =>
      isValidConnectionRule(connection, nodesById),
    [nodesById],
  );

  // Each operator input (and each species "produced by" handle) takes exactly
  // one producer, so a new connection replaces any edge already on that target
  // handle. Source handles may fan out freely.
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) {
        return;
      }
      setEdges((current) => {
        const cleared = current.filter(
          (edge) =>
            !(
              edge.target === connection.target &&
              (edge.targetHandle ?? "in") === (connection.targetHandle ?? "in")
            ),
        );
        return addEdge(connection, cleared);
      });
    },
    [isValidConnection, setEdges],
  );

  const placeNode = useCallback(
    (kind: NodeKind, position: { x: number; y: number }) => {
      setNodes((current) => {
        const existing = current.map(nodeFromFlow);
        const node = createNode(kind, position, existing);
        return [...current, toFlowNode(node)];
      });
    },
    [setNodes],
  );

  // Palette click drops a node in a cascading position near the top-left of the
  // canvas; palette drag drops at the pointer (handled by the canvas).
  const addNode = useCallback(
    (kind: NodeKind) => {
      const step = addCounterRef.current % 8;
      addCounterRef.current += 1;
      placeNode(kind, { x: 120 + step * 28, y: 120 + step * 28 });
    },
    [placeNode],
  );

  const updateNodeData = useCallback(
    (id: string, patch: Partial<AppNode["data"]>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      );
    },
    [setNodes],
  );

  const updateNodeParam = useCallback(
    (id: string, key: string, value: ParamValue) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  params: { ...node.data.params, [key]: value },
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const replaceNodeFromCode = useCallback(
    (
      id: string,
      patch: { name?: string; params: Record<string, ParamValue> },
    ) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  params: { ...node.data.params, ...patch.params },
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const getNodeSnippet = useCallback(
    (id: string) => nodeSnippet(document, id),
    [document],
  );

  // Apply an on-node code edit: parse the recognized parameters from the snippet
  // (wiring is graph-owned and ignored) and sync them to the node.
  const applyNodeCode = useCallback(
    (id: string, code: string) => {
      const node = document.nodes.find((candidate) => candidate.id === id);
      if (node) {
        replaceNodeFromCode(id, parseParamsFromCode(node.kind, code));
      }
    },
    [document, replaceNodeFromCode],
  );

  // Changing a Sum operator's input count resizes its per-input parameters and
  // prunes any edges left dangling on removed input handles.
  const changeInputCount = useCallback(
    (id: string, count: number) => {
      const next = Math.max(1, count);
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  inputCount: next,
                  params: resizedSumParams(node.data.params, next),
                },
              }
            : node,
        ),
      );
      setEdges((current) =>
        current.filter((edge) => {
          if (edge.target !== id) {
            return true;
          }
          const index = Number((edge.targetHandle ?? "in0").replace(/^in/, ""));
          return !Number.isFinite(index) || index < next;
        }),
      );
    },
    [setEdges, setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) =>
        current.filter((edge) => edge.source !== id && edge.target !== id),
      );
      setSelectedId((current) => (current === id ? null : current));
    },
    [setEdges, setNodes],
  );

  const handleNew = useCallback(() => {
    const doc = emptyDocument();
    setNodes(toFlowNodes(doc));
    setEdges(toFlowEdges(doc));
    setSimulation(doc.simulation);
    setSelectedId(null);
    setFilePath(null);
    storePath(null);
    setSavedSnapshot(serializeDocument(doc));
  }, [setEdges, setNodes]);

  const handleOpen = useCallback(async () => {
    const selected = await openDialog({
      filters: [{ extensions: [CIRCUIT_FILE_EXTENSION], name: "Circuit" }],
      multiple: false,
    });
    if (typeof selected !== "string") {
      return;
    }
    const doc = await loadCircuitFile(selected);
    setNodes(toFlowNodes(doc));
    setEdges(toFlowEdges(doc));
    setSimulation(doc.simulation);
    setSelectedId(null);
    setFilePath(selected);
    storePath(selected);
    setSavedSnapshot(serializeDocument(doc));
  }, [setEdges, setNodes]);

  const handleSave = useCallback(async () => {
    let path = filePath;
    if (!path) {
      const selected = await saveDialog({
        filters: [{ extensions: [CIRCUIT_FILE_EXTENSION], name: "Circuit" }],
      });
      if (typeof selected !== "string") {
        return;
      }
      path = selected;
    }
    const snapshot = serializeDocument(document);
    await saveCircuitFile(path, document);
    setFilePath(path);
    storePath(path);
    setSavedSnapshot(snapshot);
  }, [document, filePath]);

  // ⌘S / Ctrl+S saves the circuit, but only while the Circuit page is the
  // visible workbench tab (offsetParent is null when its panel is hidden), so
  // it never collides with the editor's own ⌘S.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "s" || event.key === "S")
      ) {
        if (rootRef.current && rootRef.current.offsetParent !== null) {
          event.preventDefault();
          void handleSave();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // --- Managed simulation environment ---

  // Ensure the app-managed Python environment (with loica) is ready, creating
  // and provisioning it on first use. Concurrent callers share one in-flight
  // setup; a ready environment resolves immediately. Returns the env root, or
  // null when unavailable (non-desktop) or setup failed.
  const ensureEnv = useCallback(async (): Promise<string | null> => {
    if (!isTauriRuntime()) {
      setEnvState("unavailable");
      return null;
    }
    if (envRootRef.current) {
      return envRootRef.current;
    }
    if (envPromiseRef.current) {
      return envPromiseRef.current;
    }
    const promise = (async () => {
      setEnvError(null);
      setEnvLog([]);
      const result = await ensureCircuitEnv(
        (phase) => setEnvState(phase),
        (line) => setEnvLog((current) => [...current.slice(-200), line]),
      );
      if ("error" in result) {
        setEnvError(result.error);
        setEnvState("error");
        envPromiseRef.current = null;
        return null;
      }
      envRootRef.current = result.root;
      setEnvState("ready");
      return result.root;
    })();
    envPromiseRef.current = promise;
    return promise;
  }, []);

  // Provision the environment eagerly when the Circuit workspace mounts, so it's
  // ready by the time a simulation runs — the user never manages Python by hand
  // and never waits for a first-use install. Idempotent, so Run/Import reuse it.
  useEffect(() => {
    void ensureEnv();
  }, [ensureEnv]);

  // Reveal the on-demand Output panel below the canvas, creating it on first run.
  const openOutputPanel = useCallback(() => {
    const api = dockApiRef.current;
    if (!api) {
      return;
    }
    const existing = api.getPanel(OUTPUT_PANEL_ID);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const canvas = api.getPanel(CANVAS_PANEL_ID);
    api.addPanel<CircuitDockPanelParams>({
      component: "circuitPanel",
      id: OUTPUT_PANEL_ID,
      params: { closeable: true, kind: "output", render: renderOutput },
      position: canvas
        ? { direction: "below", referencePanel: canvas }
        : undefined,
      tabComponent: "circuitTab",
      title: "Output",
    });
    const panel = api.getPanel(OUTPUT_PANEL_ID);
    panel?.api.setActive();
    panel?.group.api.setSize({ height: 260 });
  }, []);

  // A run's display stream carries the Flapjack manifest under a custom MIME.
  // Divert it into state (so "Save to Flapjack" can persist it) and keep it out
  // of the visible output; everything else appends to the output lines.
  const handleRunLine = useCallback((line: RunLine) => {
    if (line.stream === "display") {
      const bundle = parseDisplay(line.text);
      const payload = bundle?.data?.[FLAPJACK_MANIFEST_MIME];
      if (payload) {
        setManifest(payload as ExperimentManifest);
        return;
      }
    }
    setRunLines((current) => [...current, line]);
  }, []);

  const handleRun = useCallback(async () => {
    if (running) {
      return;
    }
    setRunLines([]);
    setExitCode(null);
    setManifest(null);
    setSaveState("idle");
    setSavedStudyId(null);
    setSaveError(null);
    setRunning(true);
    openOutputPanel();
    const root = await ensureEnv();
    if (!root) {
      setRunLines((current) => [
        ...current,
        { stream: "stderr", text: "Simulation environment is not ready." },
      ]);
      setRunning(false);
      return;
    }
    try {
      const result = await runCircuitScript(
        generatedScript,
        root,
        handleRunLine,
      );
      setExitCode(result.exitCode);
    } catch (error) {
      setRunLines((current) => [
        ...current,
        {
          stream: "stderr",
          text: error instanceof Error ? error.message : "Run failed",
        },
      ]);
    } finally {
      setRunning(false);
    }
  }, [ensureEnv, generatedScript, handleRunLine, openOutputPanel, running]);

  const exportSbol = useCallback(async () => {
    if (running || sbolExportState === "exporting") {
      return;
    }
    setRunLines([]);
    setExitCode(null);
    setSbolExportState("exporting");
    setSbolExportError(null);
    setSbolExportGraphId(null);
    setSbolExportIssueCount(0);
    setSbolExportObjectCount(0);
    setSbolExportReport([]);
    openOutputPanel();
    const root = await ensureEnv();
    if (!root) {
      setRunLines((current) => [
        ...current,
        { stream: "stderr", text: "Simulation environment is not ready." },
      ]);
      setSbolExportError("Simulation environment is not ready.");
      setSbolExportState("error");
      return;
    }

    const payloadRef: { current: SbolExportPayload | null } = {
      current: null,
    };
    try {
      const script = buildSbolExportSource(document, sbolDbUrl);
      const result = await runCircuitScript(script, root, (line) => {
        if (line.stream === "display") {
          const bundle = parseDisplay(line.text);
          const candidate = bundle?.data?.[SBOL_EXPORT_MIME];
          if (isSbolExportPayload(candidate)) {
            payloadRef.current = candidate;
            return;
          }
        }
        setRunLines((current) => [...current, line]);
      });
      setExitCode(result.exitCode);
      if (result.exitCode !== 0) {
        throw new Error("SBOL export script failed.");
      }
      const payload = payloadRef.current;
      if (!payload) {
        throw new Error("SBOL export did not produce an SBOL document.");
      }
      setSbolExportIssueCount(payload.validationCount);
      setSbolExportObjectCount(payload.identities.length);
      setSbolExportReport(payload.validationReport);
      const report = await importDocument({
        body: payload.rdfXml,
        description: "Generated from the Circuit workspace using LOICA.",
        format: "rdfxml",
        name: `Circuit SBOL: ${filePath ? baseName(filePath) : "Untitled circuit"}`,
        sourceUri: "gg://circuit/to-sbol",
      });
      setSbolExportGraphId(report.graphId);
      setSbolExportObjectCount(report.objectCount);
      setSbolExportState("imported");
      setRunLines((current) => [
        ...current,
        {
          stream: "stdout",
          text: `Imported SBOL graph ${report.graphId} (${report.objectCount} objects, ${report.tripleCount} triples).`,
        },
      ]);
    } catch (error) {
      setSbolExportError(
        error instanceof Error ? error.message : "Could not export SBOL.",
      );
      setSbolExportState("error");
    }
  }, [
    document,
    ensureEnv,
    filePath,
    openOutputPanel,
    running,
    sbolDbUrl,
    sbolExportState,
  ]);

  // Persist the last run's results into the local Flapjack store.
  const saveResults = useCallback(async () => {
    if (!manifest || saveState === "saving") {
      return;
    }
    setSaveState("saving");
    setSaveError(null);
    try {
      const report = await importStudy(manifest);
      setSavedStudyId(report.studyId);
      setSaveState("saved");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save to Flapjack.",
      );
      setSaveState("error");
    }
  }, [manifest, saveState]);

  const updateSimulation = useCallback((patch: Partial<SimulationConfig>) => {
    setSimulation((current) => ({ ...current, ...patch }));
  }, []);

  const selectedNode = selectedId ? (nodesById.get(selectedId) ?? null) : null;
  const selectedDomainNode = selectedNode ? nodeFromFlow(selectedNode) : null;
  const selectedNodeId = selectedDomainNode?.id ?? null;

  const handleDockReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event;
    dockApiRef.current = api;

    const canvas = api.addPanel<CircuitDockPanelParams>({
      component: "circuitPanel",
      id: CANVAS_PANEL_ID,
      params: { kind: "canvas", render: renderCanvas },
      tabComponent: "circuitTab",
      title: "Canvas",
    });
    const palette = api.addPanel<CircuitDockPanelParams>({
      component: "circuitPanel",
      id: "circuit-palette",
      params: { kind: "palette", render: renderPalette },
      position: { direction: "left", referencePanel: canvas },
      tabComponent: "circuitTab",
      title: "Nodes",
    });
    const node = api.addPanel<CircuitDockPanelParams>({
      component: "circuitPanel",
      id: NODE_PANEL_ID,
      params: { kind: "node", render: renderNode },
      position: { direction: "right", referencePanel: canvas },
      tabComponent: "circuitTab",
      title: "Node",
    });
    api.addPanel<CircuitDockPanelParams>({
      component: "circuitPanel",
      id: CODE_PANEL_ID,
      params: { kind: "code", render: renderCode },
      position: { direction: "within", referencePanel: node },
      tabComponent: "circuitTab",
      title: "Code",
    });
    api.addPanel<CircuitDockPanelParams>({
      component: "circuitPanel",
      id: SIMULATE_PANEL_ID,
      params: { kind: "simulate", render: renderSimulate },
      position: { direction: "within", referencePanel: node },
      tabComponent: "circuitTab",
      title: "Simulate",
    });

    palette.group.api.setSize({ width: 196 });
    node.group.api.setSize({ width: TOOL_GROUP_WIDTH });
    api.getPanel(NODE_PANEL_ID)?.api.setActive();
    canvas.api.setActive();

    api.onDidActivePanelChange((panel) => {
      if (!panel) {
        return;
      }
      // Widen the tool group for the Code tab, restore it for Node/Simulate, so
      // the code is readable without a manual resize on every switch.
      if (
        panel.id === NODE_PANEL_ID ||
        panel.id === CODE_PANEL_ID ||
        panel.id === SIMULATE_PANEL_ID
      ) {
        panel.group.api.setSize({
          width:
            panel.id === CODE_PANEL_ID ? CODE_GROUP_WIDTH : TOOL_GROUP_WIDTH,
        });
      }
    });
  }, []);

  useEffect(
    () => () => {
      dockApiRef.current = null;
    },
    [],
  );

  const contextValue = useMemo<CircuitPageContextValue>(
    () => ({
      addNode,
      applyNodeCode,
      changeInputCount: (count) =>
        selectedNodeId && changeInputCount(selectedNodeId, count),
      changeNodeParam: (key, value) =>
        selectedNodeId && updateNodeParam(selectedNodeId, key, value),
      changeNodeSbolParts: (sbolParts: SbolPartRef[]) =>
        selectedNodeId && updateNodeData(selectedNodeId, { sbolParts }),
      circuitName: filePath ? baseName(filePath) : "Untitled circuit",
      deleteSelectedNode: () => selectedNodeId && deleteNode(selectedNodeId),
      dirty,
      document,
      edges,
      envError,
      envLog,
      envState,
      exportSbol: () => void exportSbol(),
      exitCode,
      generatedScript,
      getNodeSnippet,
      isValidConnection,
      nodes,
      onConnect,
      onDropNode: placeNode,
      onEdgesChange,
      onNew: handleNew,
      onNodesChange,
      onOpen: () => void handleOpen(),
      onSave: () => void handleSave(),
      onSelect: setSelectedId,
      renameNode: (name) =>
        selectedNodeId && updateNodeData(selectedNodeId, { name }),
      replaceNodeFromCode: (patch) =>
        selectedNodeId && replaceNodeFromCode(selectedNodeId, patch),
      resolvedTheme,
      retryEnv: () => void ensureEnv(),
      runLines,
      runSimulation: () => void handleRun(),
      running,
      saveError,
      saveResults: () => void saveResults(),
      saveState,
      savedStudyId,
      sbolExportError,
      sbolExportGraphId,
      sbolExportIssueCount,
      sbolExportObjectCount,
      sbolExportReport,
      sbolExportState,
      canSaveResults: manifest !== null,
      selectedNode: selectedDomainNode,
      simulation,
      textEditorSettings: settings.textEditor,
      updateSimulation,
    }),
    [
      addNode,
      applyNodeCode,
      changeInputCount,
      deleteNode,
      dirty,
      document,
      edges,
      ensureEnv,
      envError,
      envLog,
      envState,
      exportSbol,
      exitCode,
      filePath,
      generatedScript,
      getNodeSnippet,
      handleNew,
      handleOpen,
      handleRun,
      handleSave,
      isValidConnection,
      manifest,
      nodes,
      onConnect,
      onEdgesChange,
      onNodesChange,
      placeNode,
      replaceNodeFromCode,
      resolvedTheme,
      runLines,
      running,
      saveError,
      saveResults,
      saveState,
      savedStudyId,
      sbolExportError,
      sbolExportGraphId,
      sbolExportIssueCount,
      sbolExportObjectCount,
      sbolExportReport,
      sbolExportState,
      selectedDomainNode,
      selectedNodeId,
      settings.textEditor,
      simulation,
      updateNodeData,
      updateNodeParam,
      updateSimulation,
    ],
  );

  return (
    <CircuitPageContext.Provider value={contextValue}>
      <div className="h-full min-h-0 min-w-0 bg-cg-editor" ref={rootRef}>
        <DockviewReact
          components={CIRCUIT_DOCK_COMPONENTS}
          onReady={handleDockReady}
          tabComponents={CIRCUIT_DOCK_TAB_COMPONENTS}
          theme={dockviewThemeByMode[resolvedTheme]}
        />
      </div>
    </CircuitPageContext.Provider>
  );
}

// --- Connected panels: stable components reading live state from context ---

function CanvasPanel() {
  const page = useCircuitPage();
  return (
    <CircuitCanvas
      applyNodeCode={page.applyNodeCode}
      edges={page.edges}
      getNodeSnippet={page.getNodeSnippet}
      isValidConnection={page.isValidConnection}
      nodes={page.nodes}
      onConnect={page.onConnect}
      onDropNode={page.onDropNode}
      onEdgesChange={page.onEdgesChange}
      onNodesChange={page.onNodesChange}
      onSelect={page.onSelect}
      resolvedTheme={page.resolvedTheme}
      textEditorSettings={page.textEditorSettings}
    />
  );
}

function PalettePanel() {
  const page = useCircuitPage();
  return (
    <NodePalette
      circuitName={page.circuitName}
      dirty={page.dirty}
      onAdd={page.addNode}
      onNew={page.onNew}
      onOpen={page.onOpen}
      onSave={page.onSave}
    />
  );
}

function NodePanel() {
  const page = useCircuitPage();
  if (!page.selectedNode) {
    return (
      <div className="p-4 text-[12px] text-cg-muted">
        Select a node to edit its Loica definition.
      </div>
    );
  }
  return (
    <div className="min-h-0 overflow-auto">
      <NodeInspector
        document={page.document}
        node={page.selectedNode}
        onDelete={page.deleteSelectedNode}
        onInputCountChange={page.changeInputCount}
        onParamChange={page.changeNodeParam}
        onRename={page.renameNode}
        onReplaceFromCode={page.replaceNodeFromCode}
        onSbolPartsChange={page.changeNodeSbolParts}
        resolvedTheme={page.resolvedTheme}
        textEditorSettings={page.textEditorSettings}
      />
    </div>
  );
}

function CodePanel() {
  const page = useCircuitPage();
  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <LoicaCodeEditor
        ariaLabel="Generated Loica script"
        modelUri="inmemory://circuit-generated.py"
        readOnly
        resolvedTheme={page.resolvedTheme}
        textEditorSettings={page.textEditorSettings}
        value={page.generatedScript}
      />
    </div>
  );
}

function SimulateTabPanel() {
  const page = useCircuitPage();
  return (
    <div className="min-h-0 overflow-auto">
      <SimulationPanel
        canSaveResults={page.canSaveResults}
        config={page.simulation}
        envError={page.envError}
        envLog={page.envLog}
        envState={page.envState}
        onChange={page.updateSimulation}
        onExportSbol={page.exportSbol}
        onRetry={page.retryEnv}
        onRun={page.runSimulation}
        onSaveResults={page.saveResults}
        running={page.running}
        saveError={page.saveError}
        savedStudyId={page.savedStudyId}
        saveState={page.saveState}
        sbolExportError={page.sbolExportError}
        sbolExportGraphId={page.sbolExportGraphId}
        sbolExportIssueCount={page.sbolExportIssueCount}
        sbolExportObjectCount={page.sbolExportObjectCount}
        sbolExportReport={page.sbolExportReport}
        sbolExportState={page.sbolExportState}
      />
    </div>
  );
}

function OutputPanel() {
  const page = useCircuitPage();
  return (
    <CircuitOutputPanel
      exitCode={page.exitCode}
      lines={page.runLines}
      running={page.running}
    />
  );
}
