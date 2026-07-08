/// Graph → Loica code generation. Emits a runnable script against the Loica
/// v1.0.6 API: species are declared first, then operators wired by object
/// reference from the graph edges, then assembled into a `GeneticNetwork`.
///
/// Wiring is graph-owned: an operator's `input=` / `output=` arguments come from
/// the edges, never from a node's stored parameters.
import {
  type CircuitDocument,
  type CircuitNode,
  getNodeSpec,
  isOperator,
  type ParamValue,
  toPythonVar,
} from "@/features/circuit/core/loica-model";

/// Resolved wiring for one operator: the variable names feeding its inputs (in
/// handle order) and the variable names it outputs to.
export type OperatorWiring = {
  inputs: string[];
  outputs: string[];
};

/// Assign every node a unique, stable Python variable name, in document order.
export function assignVarNames(document: CircuitDocument): Map<string, string> {
  const taken = new Set<string>();
  const byId = new Map<string, string>();
  for (const node of document.nodes) {
    byId.set(node.id, toPythonVar(node.name, taken));
  }
  return byId;
}

/// Resolve an operator's inputs (ordered by target handle) and outputs from the
/// document edges, mapped to the connected nodes' variable names.
export function resolveWiring(
  document: CircuitDocument,
  operator: CircuitNode,
  varById: Map<string, string>,
): OperatorWiring {
  const inputs = document.edges
    .filter((edge) => edge.target === operator.id)
    .sort((a, b) =>
      a.targetHandle.localeCompare(b.targetHandle, undefined, {
        numeric: true,
      }),
    )
    .map((edge) => varById.get(edge.source))
    .filter((value): value is string => Boolean(value));
  const outputs = document.edges
    .filter((edge) => edge.source === operator.id)
    .map((edge) => varById.get(edge.target))
    .filter((value): value is string => Boolean(value));
  return { inputs, outputs };
}

/// A Python literal for a parameter value.
export function pyLiteral(value: ParamValue): string {
  if (typeof value === "string") {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `[${value.map((entry) => pyLiteral(entry as ParamValue)).join(", ")}]`;
}

/// A single-value or list argument for an operator's `input=` / `output=`,
/// depending on how many endpoints the wiring resolved. `None` when unwired.
function wiringArg(vars: string[]): string {
  if (vars.length === 0) {
    return "None";
  }
  if (vars.length === 1) {
    return vars[0];
  }
  return `[${vars.join(", ")}]`;
}

/// The constructor call (right-hand side) for a node, e.g.
/// `Receiver(input=atc, output=tetr, alpha=[0, 100], K=1, n=2)`.
export function constructorCall(
  node: CircuitNode,
  wiring: OperatorWiring | null,
): string {
  const spec = getNodeSpec(node.kind);
  const args: string[] = [];

  if (spec.category === "operator") {
    const resolved = wiring ?? { inputs: [], outputs: [] };
    if (node.kind !== "source") {
      args.push(`input=${wiringArg(resolved.inputs)}`);
    }
    args.push(`output=${wiringArg(resolved.outputs)}`);
  } else {
    args.push(`name=${pyLiteral(node.name)}`);
  }

  for (const paramSpec of spec.params) {
    const value = node.params[paramSpec.key];
    if (value === undefined) {
      continue;
    }
    // An empty string (e.g. an unset reporter signal id) is omitted so Loica
    // falls back to its own default.
    if (typeof value === "string" && value.trim() === "") {
      continue;
    }
    args.push(`${paramSpec.key}=${pyLiteral(value)}`);
  }

  if (spec.category === "operator") {
    args.push(`name=${pyLiteral(node.name)}`);
  }

  return `${spec.loicaClass}(${args.join(", ")})`;
}

/// The assignment line for a single node within a document, with wiring resolved
/// from the document edges. Used by the on-node flip editor.
export function nodeSnippet(document: CircuitDocument, nodeId: string): string {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return "";
  }
  const varById = assignVarNames(document);
  const varName = varById.get(nodeId) ?? "node";
  const wiring = isOperator(node.kind)
    ? resolveWiring(document, node, varById)
    : null;
  return nodeAssignment(node, varName, wiring);
}

/// The full assignment line for a node, e.g. `atc = Supplement(name='aTc')`.
export function nodeAssignment(
  node: CircuitNode,
  varName: string,
  wiring: OperatorWiring | null,
): string {
  return `${varName} = ${constructorCall(node, wiring)}`;
}

/// Build the network-construction portion of the script (imports through
/// `GeneticNetwork` assembly), without the simulation harness.
export function buildNetworkSource(document: CircuitDocument): string {
  const varById = assignVarNames(document);
  const lines: string[] = ["import numpy as np", "from loica import *", ""];

  const species = document.nodes.filter((node) => !isOperator(node.kind));
  const operators = document.nodes.filter((node) => isOperator(node.kind));

  if (species.length > 0) {
    lines.push("# --- species ---");
    for (const node of species) {
      lines.push(nodeAssignment(node, varById.get(node.id)!, null));
    }
    lines.push("");
  }

  if (operators.length > 0) {
    lines.push("# --- operators ---");
    for (const node of operators) {
      const wiring = resolveWiring(document, node, varById);
      lines.push(nodeAssignment(node, varById.get(node.id)!, wiring));
    }
    lines.push("");
  }

  lines.push("# --- network ---", "network = GeneticNetwork()");

  const regulators = species
    .filter((node) => node.kind === "regulator")
    .map((node) => varById.get(node.id)!);
  const reporters = species
    .filter((node) => node.kind === "reporter")
    .map((node) => varById.get(node.id)!);
  const operatorVars = operators.map((node) => varById.get(node.id)!);

  if (regulators.length > 0) {
    lines.push(`network.add_regulator([${regulators.join(", ")}])`);
  }
  if (reporters.length > 0) {
    lines.push(`network.add_reporter([${reporters.join(", ")}])`);
  }
  if (operatorVars.length > 0) {
    lines.push(`network.add_operator([${operatorVars.join(", ")}])`);
  }

  return `${lines.join("\n")}\n`;
}

/// Build the simulation harness: a Gompertz metabolism, one sample per point of
/// a log-spaced dose sweep over the first supplement (or a single baseline
/// sample when the circuit has no supplement), an `Assay`, and rich output — the
/// measurements DataFrame plus a reporter timecourse figure. Both render in the
/// Output panel via the runner's `display()` and matplotlib capture.
export function buildSimulationSource(document: CircuitDocument): string {
  const varById = assignVarNames(document);
  const sim = document.simulation;
  const [y0, ymax, um, lag] = sim.biomass;

  const supplements = document.nodes.filter(
    (node) => node.kind === "supplement",
  );
  const firstSupplement = supplements[0]
    ? varById.get(supplements[0].id)
    : null;

  const lines: string[] = [
    "",
    "# --- simulation ---",
    "import matplotlib.pyplot as plt",
    "",
    `metab = SimulatedMetabolism('sim', lambda t: gompertz(t, ${y0}, ${ymax}, ${um}, ${lag}), lambda t: gompertz_growth_rate(t, ${y0}, ${ymax}, ${um}, ${lag}))`,
  ];

  if (firstSupplement) {
    const lo = Math.log10(sim.doseMin > 0 ? sim.doseMin : 1e-6);
    const hi = Math.log10(sim.doseMax > 0 ? sim.doseMax : 1);
    lines.push(
      `doses = np.append(0, np.logspace(${round(lo)}, ${round(hi)}, ${sim.dosePoints}))`,
      "samples = []",
      "for conc in doses:",
      "    sample = Sample(genetic_network=network, metabolism=metab, media='M9', strain='E. coli')",
      `    sample.set_supplement(${firstSupplement}, conc)`,
      "    samples.append(sample)",
    );
  } else {
    lines.push(
      "samples = [Sample(genetic_network=network, metabolism=metab, media='M9', strain='E. coli')]",
    );
  }

  lines.push(
    `assay = Assay(samples, n_measurements=${sim.nMeasurements}, interval=${sim.interval}, biomass_signal_id='od')`,
    "assay.run()",
    "df = assay.measurements",
    "display(df)",
    "",
    "signals = df[df.Signal != 'Biomass']",
    "if len(signals):",
    "    fig, ax = plt.subplots(figsize=(6, 4))",
    "    for (sample_id, signal), group in signals.groupby(['Sample', 'Signal']):",
    "        ax.plot(group.Time, group.Measurement, linewidth=1)",
    "    ax.set_xlabel('Time (h)')",
    "    ax.set_ylabel('Reporter signal')",
    "    ax.set_title('Reporter timecourse (one line per sample)')",
  );

  return `${lines.join("\n")}\n`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/// The complete runnable script: network construction followed by the
/// simulation harness.
export function generateScript(document: CircuitDocument): string {
  return `${buildNetworkSource(document)}${buildSimulationSource(document)}`;
}

// --- Reverse parse: edit the code, sync params back ---

/// Extract known parameter values from an edited constructor snippet. Best
/// effort: recognizes `key=value` for the node kind's spec parameters, parsing
/// numbers, numeric lists, nested lists, and quoted strings. Wiring arguments
/// (`input`/`output`) and anything unrecognized are ignored, so a code edit
/// never corrupts the graph — it only updates parameters it can read.
export function parseParamsFromCode(
  kind: CircuitNode["kind"],
  code: string,
): { name?: string; params: Record<string, ParamValue> } {
  const result: { name?: string; params: Record<string, ParamValue> } = {
    params: {},
  };
  const open = code.indexOf("(");
  const close = code.lastIndexOf(")");
  if (open < 0 || close < open) {
    return result;
  }
  const argList = code.slice(open + 1, close);
  const args = splitTopLevel(argList);
  const spec = getNodeSpec(kind);
  const paramKinds = new Map(spec.params.map((p) => [p.key, p.kind]));

  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = arg.slice(0, eq).trim();
    const rawValue = arg.slice(eq + 1).trim();

    if (key === "name") {
      const parsed = parseValue(rawValue);
      if (typeof parsed === "string") {
        result.name = parsed;
      }
      continue;
    }

    const paramKind = paramKinds.get(key);
    if (!paramKind) {
      continue;
    }
    const parsed = parseValue(rawValue);
    if (parsed === null) {
      continue;
    }
    if (matchesKind(parsed, paramKind)) {
      result.params[key] = parsed;
    }
  }
  return result;
}

/// Split a comma-separated argument list at the top bracket level so commas
/// inside `[...]` don't split a list argument.
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "[" || char === "(") {
      depth += 1;
    } else if (char === "]" || char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) {
    parts.push(current);
  }
  return parts;
}

function parseValue(raw: string): ParamValue | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as ParamValue;
      }
    } catch {
      return null;
    }
    return null;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function matchesKind(value: ParamValue, kind: string): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "number[]":
      return Array.isArray(value) && value.every((v) => typeof v === "number");
    case "number[][]":
      return (
        Array.isArray(value) &&
        value.every(
          (v) => Array.isArray(v) && v.every((n) => typeof n === "number"),
        )
      );
    default:
      return false;
  }
}
