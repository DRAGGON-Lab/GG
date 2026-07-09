/// The circuit graph model. A circuit is a bipartite graph that mirrors Loica's
/// own `GeneticNetwork.to_graph()`: nodes are either genetic *species*
/// (`Regulator`, `Reporter`, `Supplement`) or *operators* (`Source`, `Receiver`,
/// `Hill1`, `Hill2`, `Sum`), and edges are wiring by object reference —
/// `species → operator.input` and `operator → species.output`.
///
/// Wiring is graph-owned: an operator's `input=` / `output=` arguments are
/// filled from the edges at codegen time, never stored in a node. A node owns
/// only its class parameters (`alpha`, `K`, `n`, `rate`, degradation rate, …).

export type NodeCategory = "species" | "operator";

export type NodeKind =
  | "regulator"
  | "reporter"
  | "supplement"
  | "source"
  | "receiver"
  | "hill1"
  | "hill2"
  | "sum";

/// A scalar or vector parameter value. Loica operators take scalars (`K`, `n`),
/// fixed-length vectors (`alpha`), and — for `Sum` — nested vectors.
export type ParamValue = number | number[] | number[][] | string;

export type ParamKind =
  | "string"
  | "color"
  | "number"
  | "number[]"
  | "number[][]";

/// Metadata for one editable parameter, driving both the inspector form and the
/// Loica code generation.
export type ParamSpec = {
  key: string;
  label: string;
  kind: ParamKind;
  default: ParamValue;
  help?: string;
  /// UI-only parameters are stored with the node but omitted from generated Loica constructors.
  uiOnly?: boolean;
  /// Fixed length for a `number[]` parameter (e.g. `Hill1.alpha` is `[basal,
  /// regulated]`). Omitted for variable-length parameters.
  arity?: number;
};

export type HandleSpec = { id: string; label: string };

/// The static description of a node kind: its Loica class, palette presentation,
/// handles, and editable parameters. One spec drives the palette, the node
/// component, the inspector form, and codegen.
export type NodeSpec = {
  kind: NodeKind;
  category: NodeCategory;
  /// The Loica class this node constructs. `Supplement` is a species but is
  /// attached at the `Sample` level, not added to the network.
  loicaClass:
    | "Regulator"
    | "Reporter"
    | "Supplement"
    | "Source"
    | "Receiver"
    | "Hill1"
    | "Hill2"
    | "Sum";
  label: string;
  description: string;
  /// Accent color for the node body, in the bone/microscopy palette.
  accent: string;
  /// Incoming handles (ReactFlow targets): the things that flow into this node.
  targets: HandleSpec[];
  /// Outgoing handles (ReactFlow sources): the things this node produces.
  sources: HandleSpec[];
  /// `Sum` accepts a variable number of inputs; its target handles are derived
  /// from `inputCount` rather than this fixed list.
  dynamicInputs?: boolean;
  params: ParamSpec[];
  /// The operator's expression rate as a KaTeX string, mirroring Loica's
  /// `expression_rate`. Present on operators, omitted on species.
  equation?: string;
};

const SPECIES_ACCENT = {
  regulator: "#7cc6a6",
  reporter: "#4fd67f",
  supplement: "#e08fb0",
} as const;

const OPERATOR_ACCENT = "#8fb3d9";
const HILL2_ACCENT = "#e0a86f";

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  regulator: {
    accent: SPECIES_ACCENT.regulator,
    category: "species",
    description:
      "A transcription factor produced by one operator and regulating another.",
    kind: "regulator",
    label: "Regulator",
    loicaClass: "Regulator",
    params: [
      {
        default: 0,
        key: "degradation_rate",
        kind: "number",
        label: "Degradation rate",
      },
      {
        default: 0,
        key: "init_concentration",
        kind: "number",
        label: "Initial concentration",
      },
    ],
    sources: [{ id: "out", label: "regulates" }],
    targets: [{ id: "in", label: "produced by" }],
  },
  reporter: {
    accent: SPECIES_ACCENT.reporter,
    category: "species",
    description: "A fluorescent output measured during simulation.",
    kind: "reporter",
    label: "Reporter",
    loicaClass: "Reporter",
    params: [
      {
        default: "",
        help: "Flapjack signal id / measurement label.",
        key: "signal_id",
        kind: "string",
        label: "Signal id",
      },
      {
        default: SPECIES_ACCENT.reporter,
        help: "Canvas glyph color.",
        key: "color",
        kind: "color",
        label: "Color",
        uiOnly: true,
      },
      {
        default: 0,
        key: "degradation_rate",
        kind: "number",
        label: "Degradation rate",
      },
      {
        default: 0,
        key: "init_concentration",
        kind: "number",
        label: "Initial concentration",
      },
    ],
    sources: [],
    targets: [{ id: "in", label: "produced by" }],
  },
  supplement: {
    accent: SPECIES_ACCENT.supplement,
    category: "species",
    description: "An inducer / chemical whose concentration is set per sample.",
    kind: "supplement",
    label: "Supplement",
    loicaClass: "Supplement",
    params: [],
    sources: [{ id: "out", label: "induces" }],
    targets: [],
  },
  source: {
    accent: OPERATOR_ACCENT,
    category: "operator",
    description:
      "Constitutive promoter — produces its output at a constant rate.",
    equation: "\\phi = \\text{rate}",
    kind: "source",
    label: "Source",
    loicaClass: "Source",
    params: [{ default: 10, key: "rate", kind: "number", label: "Rate" }],
    sources: [{ id: "out", label: "output" }],
    targets: [],
  },
  receiver: {
    accent: OPERATOR_ACCENT,
    category: "operator",
    description: "Inducible promoter — activation Hill response to one input.",
    equation:
      "\\phi = \\dfrac{\\alpha_0 + \\alpha_1\\,(i/K)^{n}}{1 + (i/K)^{n}}",
    kind: "receiver",
    label: "Receiver",
    loicaClass: "Receiver",
    params: [
      {
        arity: 2,
        default: [0, 100],
        help: "[basal, max]",
        key: "alpha",
        kind: "number[]",
        label: "alpha",
      },
      { default: 1, key: "K", kind: "number", label: "K" },
      { default: 2, key: "n", kind: "number", label: "n" },
    ],
    sources: [{ id: "out", label: "output" }],
    targets: [{ id: "in", label: "input" }],
  },
  hill1: {
    accent: OPERATOR_ACCENT,
    category: "operator",
    description:
      "Single-input promoter — repression or activation (inverter/NOT when [hi, lo]).",
    equation:
      "\\phi = \\dfrac{\\alpha_0 + \\alpha_1\\,(x/K)^{n}}{1 + (x/K)^{n}}",
    kind: "hill1",
    label: "Hill1",
    loicaClass: "Hill1",
    params: [
      {
        arity: 2,
        default: [1, 0],
        help: "[basal, regulated]",
        key: "alpha",
        kind: "number[]",
        label: "alpha",
      },
      { default: 1, key: "K", kind: "number", label: "K" },
      { default: 2, key: "n", kind: "number", label: "n" },
    ],
    sources: [{ id: "out", label: "output" }],
    targets: [{ id: "in", label: "input" }],
  },
  hill2: {
    accent: HILL2_ACCENT,
    category: "operator",
    description: "Two-input promoter — NOR / AND-from-NOR logic.",
    equation:
      "\\phi = \\dfrac{\\alpha_0 + \\alpha_1 r_1 + \\alpha_2 r_2 + \\alpha_3 r_1 r_2}{1 + r_1 + r_2 + r_1 r_2},\\quad r_i = (x_i/K_i)^{n_i}",
    kind: "hill2",
    label: "Hill2",
    loicaClass: "Hill2",
    params: [
      {
        arity: 4,
        default: [1, 0, 0, 0],
        help: "[a0, a1, a2, a3]",
        key: "alpha",
        kind: "number[]",
        label: "alpha",
      },
      {
        arity: 2,
        default: [1, 1],
        help: "[K1, K2]",
        key: "K",
        kind: "number[]",
        label: "K",
      },
      {
        arity: 2,
        default: [2, 2],
        help: "[n1, n2]",
        key: "n",
        kind: "number[]",
        label: "n",
      },
    ],
    sources: [{ id: "out", label: "output" }],
    targets: [
      { id: "in0", label: "input 1" },
      { id: "in1", label: "input 2" },
    ],
  },
  sum: {
    accent: OPERATOR_ACCENT,
    category: "operator",
    description: "Additive combination of N inputs.",
    dynamicInputs: true,
    equation:
      "\\phi = \\sum_i \\dfrac{\\alpha_{i,0} + \\alpha_{i,1} r_i}{1 + r_i},\\quad r_i = (x_i/K_i)^{n_i}",
    kind: "sum",
    label: "Sum",
    loicaClass: "Sum",
    params: [
      {
        default: [[0, 1]],
        help: "One [a0, a1] pair per input.",
        key: "alpha",
        kind: "number[][]",
        label: "alpha",
      },
      {
        default: [1],
        help: "One K per input.",
        key: "K",
        kind: "number[]",
        label: "K",
      },
      {
        default: [2],
        help: "One n per input.",
        key: "n",
        kind: "number[]",
        label: "n",
      },
    ],
    sources: [{ id: "out", label: "output" }],
    targets: [{ id: "in0", label: "input 1" }],
  },
};

export function getNodeSpec(kind: NodeKind): NodeSpec {
  return NODE_SPECS[kind];
}

export function isOperator(kind: NodeKind): boolean {
  return NODE_SPECS[kind].category === "operator";
}

/// The target handles a node exposes. `Sum` derives them from `inputCount`.
export function targetHandles(node: CircuitNode): HandleSpec[] {
  const spec = NODE_SPECS[node.kind];
  if (!spec.dynamicInputs) {
    return spec.targets;
  }
  const count = Math.max(1, node.inputCount ?? 1);
  return Array.from({ length: count }, (_, index) => ({
    id: `in${index}`,
    label: `input ${index + 1}`,
  }));
}

export function sourceHandles(node: CircuitNode): HandleSpec[] {
  return NODE_SPECS[node.kind].sources;
}

// --- Persisted document shapes ---

export type CircuitNode = {
  id: string;
  kind: NodeKind;
  /// Display name and the basis for the generated Python variable.
  name: string;
  params: Record<string, ParamValue>;
  /// Number of input handles for a dynamic-input operator (`Sum`).
  inputCount?: number;
  position: { x: number; y: number };
};

export type CircuitEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

/// Simulation harness configuration. Drives the generated `Assay`.
export type SimulationConfig = {
  /// Log-spaced supplement dose sweep, one point per sample, plus a zero point.
  doseMin: number;
  doseMax: number;
  dosePoints: number;
  nMeasurements: number;
  /// Hours between measurements.
  interval: number;
  /// Gompertz biomass parameters [y0, ymax, um, lambda].
  biomass: [number, number, number, number];
};

export const DEFAULT_SIMULATION: SimulationConfig = {
  biomass: [0.05, 1, 1, 1],
  doseMax: 100,
  doseMin: 1e-4,
  dosePoints: 12,
  interval: 0.24,
  nMeasurements: 50,
};

export type CircuitDocument = {
  version: 1;
  nodes: CircuitNode[];
  edges: CircuitEdge[];
  simulation: SimulationConfig;
};

export function emptyDocument(): CircuitDocument {
  return {
    edges: [],
    nodes: [],
    simulation: { ...DEFAULT_SIMULATION },
    version: 1,
  };
}

/// A small, illustrative starting circuit shown on first launch: an aTc-inducible
/// receiver drives the TetR regulator, which a Hill1 inverter reads to express
/// GFP. It exercises every node category (supplement, operator, regulator,
/// reporter) and produces a clear dose response under simulation.
export function exampleDocument(): CircuitDocument {
  return {
    edges: [
      {
        id: "ex-atc-rec",
        source: "ex-atc",
        sourceHandle: "out",
        target: "ex-rec",
        targetHandle: "in",
      },
      {
        id: "ex-rec-tetr",
        source: "ex-rec",
        sourceHandle: "out",
        target: "ex-tetr",
        targetHandle: "in",
      },
      {
        id: "ex-tetr-inv",
        source: "ex-tetr",
        sourceHandle: "out",
        target: "ex-inv",
        targetHandle: "in",
      },
      {
        id: "ex-inv-gfp",
        source: "ex-inv",
        sourceHandle: "out",
        target: "ex-gfp",
        targetHandle: "in",
      },
    ],
    nodes: [
      {
        id: "ex-atc",
        kind: "supplement",
        name: "aTc",
        params: {},
        position: { x: 40, y: 220 },
      },
      {
        id: "ex-rec",
        kind: "receiver",
        name: "receiver",
        params: { K: 1, alpha: [0, 100], n: 2 },
        position: { x: 280, y: 220 },
      },
      {
        id: "ex-tetr",
        kind: "regulator",
        name: "TetR",
        params: { degradation_rate: 1, init_concentration: 0 },
        position: { x: 520, y: 220 },
      },
      {
        id: "ex-inv",
        kind: "hill1",
        name: "inverter",
        params: { K: 1, alpha: [1, 0], n: 2 },
        position: { x: 760, y: 220 },
      },
      {
        id: "ex-gfp",
        kind: "reporter",
        name: "GFP",
        params: {
          degradation_rate: 0,
          init_concentration: 0,
          signal_id: "gfp",
        },
        position: { x: 1000, y: 220 },
      },
    ],
    simulation: { ...DEFAULT_SIMULATION },
    version: 1,
  };
}

// --- Node construction ---

let nodeSequence = 0;

/// A stable-ish unique id for a new node. Prefixed by kind for readability.
export function newNodeId(kind: NodeKind): string {
  nodeSequence += 1;
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `${kind}-${nodeSequence}-${rand}`;
}

/// Default parameters for a node kind, cloned from its spec so edits never
/// mutate the shared defaults.
export function defaultParams(kind: NodeKind): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const spec of NODE_SPECS[kind].params) {
    params[spec.key] = cloneParam(spec.default);
  }
  return params;
}

function cloneParam(value: ParamValue): ParamValue {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((entry) =>
      Array.isArray(entry) ? [...(entry as number[])] : entry,
    ) as ParamValue;
  }
  return value;
}

/// A short human default name for a freshly dropped node of `kind`, unique
/// among `existing` names (case-insensitive).
export function defaultNodeName(
  kind: NodeKind,
  existing: CircuitNode[],
): string {
  const base = DEFAULT_NAME_BASE[kind];
  const taken = new Set(existing.map((node) => node.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) {
    return base;
  }
  let index = 2;
  while (taken.has(`${base}${index}`.toLowerCase())) {
    index += 1;
  }
  return `${base}${index}`;
}

const DEFAULT_NAME_BASE: Record<NodeKind, string> = {
  hill1: "hill1",
  hill2: "hill2",
  receiver: "receiver",
  regulator: "reg",
  reporter: "reporter",
  source: "source",
  sum: "sum",
  supplement: "inducer",
};

export function createNode(
  kind: NodeKind,
  position: { x: number; y: number },
  existing: CircuitNode[],
): CircuitNode {
  const node: CircuitNode = {
    id: newNodeId(kind),
    kind,
    name: defaultNodeName(kind, existing),
    params: defaultParams(kind),
    position,
  };
  if (NODE_SPECS[kind].dynamicInputs) {
    node.inputCount = 1;
  }
  return node;
}

/// Sanitize a display name into a valid, unique Python identifier. Used by
/// codegen to turn node names into variable names.
/// Resize a `Sum` operator's per-input parameters to match `count` inputs,
/// preserving existing entries and filling new ones with defaults.
export function resizedSumParams(
  params: Record<string, ParamValue>,
  count: number,
): Record<string, ParamValue> {
  const alphaSource = Array.isArray(params.alpha)
    ? (params.alpha as number[][])
    : [];
  const kSource = Array.isArray(params.K) ? (params.K as number[]) : [];
  const nSource = Array.isArray(params.n) ? (params.n as number[]) : [];
  return {
    ...params,
    K: Array.from({ length: count }, (_, index) =>
      typeof kSource[index] === "number" ? kSource[index] : 1,
    ),
    alpha: Array.from({ length: count }, (_, index) =>
      Array.isArray(alphaSource[index]) ? alphaSource[index] : [0, 1],
    ),
    n: Array.from({ length: count }, (_, index) =>
      typeof nSource[index] === "number" ? nSource[index] : 2,
    ),
  };
}

export function toPythonVar(name: string, taken: Set<string>): string {
  let base = name
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^(?=[0-9])/, "_");
  if (base.length === 0) {
    base = "node";
  }
  if (PY_KEYWORDS.has(base)) {
    base = `${base}_`;
  }
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
}

const PY_KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);
