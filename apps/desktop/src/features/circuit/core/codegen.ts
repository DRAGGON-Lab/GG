/// Graph → Loica code generation. Emits a runnable script against the Loica
/// v1.0.7 API: species are declared first, then operators wired by object
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

export const SBOL_EXPORT_MIME = "application/vnd.gg.sbol-export+json";

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

function pyDataLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "string") {
    return pyLiteral(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => pyDataLiteral(entry)).join(", ")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => `${pyLiteral(key)}: ${pyDataLiteral(entry)}`)
      .join(", ")}}`;
  }
  return "None";
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
  sbolCompArg: string | null = null,
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
    if (paramSpec.uiOnly) {
      continue;
    }
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

  if (sbolCompArg) {
    args.push(`sbol_comp=${sbolCompArg}`);
  } else {
    const sbolComp = sbolCompMetadata(node);
    if (sbolComp) {
      args.push(`sbol_comp=${pyDataLiteral(sbolComp)}`);
    }
  }

  if (spec.category === "operator") {
    args.push(`name=${pyLiteral(node.name)}`);
  }

  return `${spec.loicaClass}(${args.join(", ")})`;
}

function sbolCompMetadata(node: CircuitNode): Record<string, unknown> | null {
  const parts = node.sbolParts ?? [];
  if (parts.length === 0) {
    return null;
  }
  return {
    parts: parts.map((part, index) => ({
      display_id: part.displayId ?? null,
      graph_id: part.graphId ?? null,
      iri: part.iri,
      name: part.name ?? null,
      order: index,
      role: part.roleHint ?? null,
      roles: part.roles,
      sbol_class: part.sbolClass,
    })),
    source: "gg-sbol-db",
  };
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
  sbolCompArg: string | null = null,
): string {
  return `${varName} = ${constructorCall(node, wiring, sbolCompArg)}`;
}

// --- Script assembly ---------------------------------------------------------
//
// A generated script reads top to bottom like a hand-written file: imports, the
// embedded-service clients and SBOL document state, the reusable helper
// functions, then the body — SBOL components, the circuit, and (for a run) the
// simulation and its Flapjack export. Each builder below emits one of those
// sections; `generateScript` and `buildSbolExportSource` compose them.

const SBOL_NAMESPACE = "https://gg.draggonlab.org/circuit";

/// The import block, grouped and ordered like isort: the standard library
/// first, then third-party. `simulation` pulls in the numeric and plotting
/// stack; `sbolDb`/`flapjack` add the clients the body constructs.
function buildImports(options: {
  sbolDb: boolean;
  flapjack: boolean;
  simulation: boolean;
}): string[] {
  const stdlib = options.simulation ? ["import math"] : [];
  const thirdParty = ["import sbol3"];
  if (options.simulation) {
    thirdParty.unshift(
      "import numpy as np",
      "import plotly.graph_objects as go",
    );
  }
  if (options.flapjack) {
    thirdParty.push("from flapjack import Flapjack");
  }
  thirdParty.push("from loica import *");
  if (options.sbolDb) {
    thirdParty.push("from sbol_db import SbolDbClient");
  }
  return [...stdlib, ...(stdlib.length ? [""] : []), ...thirdParty, ""];
}

/// The embedded-service clients and the SBOL document they populate, defined
/// before the helper functions that close over them. Each client is `None` when
/// its server isn't running, and the helpers degrade to local synthesis.
function buildClients(
  sbolDbUrl: string | null | undefined,
  flapjackUrl: string | null | undefined,
  options: { flapjack: boolean },
): string[] {
  const lines = ["# Embedded service clients (None when the server is down)."];
  lines.push(
    sbolDbUrl
      ? `sbol_db = SbolDbClient(${pyLiteral(sbolDbUrl)})`
      : "sbol_db = None",
  );
  if (options.flapjack) {
    if (flapjackUrl) {
      const host = flapjackUrl.replace(/^https?:\/\//, "");
      lines.push(
        `flapjack = Flapjack(${pyLiteral(host)})`,
        "flapjack.log_in('gg', 'gg')",
      );
    } else {
      lines.push("flapjack = None");
    }
  }
  lines.push(
    "",
    `sbol3.set_namespace(${pyLiteral(SBOL_NAMESPACE)})`,
    "sbol_doc = sbol3.Document()",
    "sbol_component_cache = {}",
  );
  return lines;
}

/// The SBOL helper functions, shared by the run and export scripts. They read
/// the module-level `sbol_db`/`sbol_doc`/`sbol_component_cache` defined above.
function buildSbolHelpers(): string[] {
  return [
    "def role_uri(role):",
    '    """The SBOL sequence-ontology URI for a genetic-part role, or None."""',
    "    return {",
    "        'promoter': sbol3.SO_PROMOTER,",
    "        'rbs': sbol3.SO_RBS,",
    "        'cds': sbol3.SO_CDS,",
    "        'terminator': sbol3.SO_TERMINATOR,",
    "        'engineered region': sbol3.SO_ENGINEERED_REGION,",
    "        'stability': sbol3.SO_CDS,",
    "    }.get(role)",
    "",
    "",
    "def type_uri(node_kind, role):",
    '    """The SBOL component type URI for a node kind and molecular role."""',
    "    if node_kind == 'supplement':",
    "        return sbol3.SBO_SIMPLE_CHEMICAL",
    "    if role == 'rna':",
    "        return sbol3.SBO_RNA",
    "    if role == 'protein':",
    "        return sbol3.SBO_PROTEIN",
    "    return sbol3.SBO_DNA",
    "",
    "",
    "def synthesize_component(identity, name, node_kind, role, roles):",
    '    """A locally-built SBOL Component, created once per identity and cached."""',
    "    if identity in sbol_component_cache:",
    "        return sbol_component_cache[identity]",
    "    values = []",
    "    for value in roles or []:",
    "        if value and value not in values:",
    "            values.append(value)",
    "    inferred = role_uri(role)",
    "    if inferred and inferred not in values:",
    "        values.append(inferred)",
    "    component = sbol3.Component(identity, type_uri(node_kind, role), roles=values or None, name=name)",
    "    sbol_doc.add(component)",
    "    sbol_component_cache[identity] = component",
    "    return component",
    "",
    "",
    "def pull_component(iri):",
    '    """Fetch a part\'s real SBOL3 definition and its reference closure from the',
    "    embedded sbol-db server into sbol_doc. Returns the Component, or None to",
    '    fall back to local synthesis when the server or part is unavailable."""',
    "    if sbol_db is None or not iri:",
    "        return None",
    "    existing = sbol_doc.find(iri)",
    "    if existing is not None:",
    "        return existing",
    "    try:",
    "        rdf = sbol_db.export_rdf(iri, format='rdfxml', version='sbol3', recursive=True)",
    "        pulled = sbol3.Document()",
    "        pulled.read_string(rdf, sbol3.RDF_XML)",
    "        if not isinstance(pulled.find(iri), sbol3.Component):",
    "            return None",
    "        fresh = [obj for obj in pulled.objects if sbol_doc.find(str(obj.identity)) is None]",
    "        if fresh:",
    "            sbol3.copy(fresh, into_document=sbol_doc)",
    "        return sbol_doc.find(iri)",
    "    except Exception:",
    "        return None",
    "",
    "",
    "def node_component(identity, name, node_kind, parts):",
    '    """The SBOL Component for a circuit node: each part pulled from sbol-db when',
    '    available (else synthesized), assembled into a composite for multi-part nodes."""',
    "    if not parts:",
    "        return synthesize_component(identity, name, node_kind, 'engineered region', [sbol3.SO_ENGINEERED_REGION])",
    "    components = []",
    "    for part in parts:",
    "        pulled = pull_component(part.get('iri'))",
    "        if pulled is not None:",
    "            components.append(pulled)",
    "            continue",
    "        components.append(synthesize_component(",
    "            part.get('iri') or part.get('display_id'),",
    "            part.get('name') or part.get('display_id'),",
    "            node_kind,",
    "            part.get('role'),",
    "            part.get('roles') or [],",
    "        ))",
    "    if len(components) == 1:",
    "        return components[0]",
    "    composite = synthesize_component(identity, name, node_kind, 'engineered region', [sbol3.SO_ENGINEERED_REGION])",
    "    composite.features = [sbol3.SubComponent(part) for part in components]",
    "    composite.constraints = [",
    "        sbol3.Constraint(sbol3.SBOL_PRECEDES, composite.features[i], composite.features[i + 1])",
    "        for i in range(len(composite.features) - 1)",
    "    ]",
    "    return composite",
  ];
}

/// The reporter-timecourse plotting function, used by the run script.
function buildPlotHelper(): string[] {
  return [
    "def plot_reporter_timecourse(df):",
    '    """Display an interactive Plotly timecourse, one line per (sample, reporter)."""',
    "    signals = df[df.Signal != 'Biomass']",
    "    if not len(signals):",
    "        return",
    "    fig = go.Figure()",
    "    labeled = set()",
    "    for (sample_id, signal), group in signals.groupby(['Sample', 'Signal']):",
    "        color = group.HexColor.dropna().iloc[0] if 'HexColor' in group and group.HexColor.notna().any() else None",
    "        fig.add_trace(go.Scatter(",
    "            x=group.Time,",
    "            y=group.Measurement,",
    "            mode='lines+markers',",
    "            name=signal,",
    "            legendgroup=signal,",
    "            showlegend=signal not in labeled,",
    "            line=dict(color=color, width=1.8),",
    "            marker=dict(size=4),",
    "            customdata=np.stack([group.Sample, group.Signal], axis=-1),",
    "            hovertemplate='Time: %{x:.3g} h<br>Measurement: %{y:.3g}<br>Sample: %{customdata[0]}<br>Signal: %{customdata[1]}<extra></extra>',",
    "        ))",
    "        labeled.add(signal)",
    "    fig.update_layout(",
    "        title='Reporter timecourse (one line per sample)',",
    "        template='plotly_white',",
    "        height=420,",
    "        margin=dict(l=52, r=24, t=56, b=48),",
    "        paper_bgcolor='white',",
    "        plot_bgcolor='white',",
    "        font=dict(family='Inter, system-ui, sans-serif', size=12, color='#24313d'),",
    "        hovermode='closest',",
    "        legend=dict(title='Reporter', orientation='h', yanchor='bottom', y=1.02, xanchor='right', x=1),",
    "        xaxis=dict(title='Time (h)', showgrid=True, gridcolor='#e5e7eb', zeroline=False, rangeslider=dict(visible=True)),",
    "        yaxis=dict(title='Reporter signal', showgrid=True, gridcolor='#e5e7eb', zeroline=False),",
    "    )",
    "    fig.update_xaxes(showspikes=True, spikemode='across', spikesnap='cursor', spikedash='dot', spikecolor='#64748b')",
    "    fig.update_yaxes(showspikes=True, spikemode='across', spikesnap='cursor', spikedash='dot', spikecolor='#64748b')",
    "    display({'text/html': fig.to_html(include_plotlyjs='cdn', full_html=False, config={'responsive': True, 'displaylogo': False, 'modeBarButtonsToAdd': ['drawline', 'drawopenpath', 'eraseshape'], 'toImageButtonOptions': {'format': 'png', 'filename': 'reporter-timecourse'}})})",
  ];
}

/// The Flapjack manifest builder and its rich-display wrapper. The Flapjack tab
/// captures the emitted MIME bundle and imports the study; the circuit Output
/// panel ignores it.
function buildFlapjackHelper(): string[] {
  return [
    "class FlapjackManifest:",
    '    """A rich-display wrapper the Flapjack tab imports via its MIME type."""',
    "",
    "    MIME = 'application/vnd.gg.flapjack+json'",
    "",
    "    def __init__(self, payload):",
    "        self.payload = payload",
    "",
    "    def _repr_mimebundle_(self, include=None, exclude=None):",
    "        return {self.MIME: self.payload}",
    "",
    "",
    "def flapjack_manifest(df, sample_meta, study_name):",
    '    """Package the simulated run as a Flapjack import manifest.',
    "",
    "    Measurements map to samples by first-seen order in the DataFrame, which",
    '    matches sample-creation order."""',
    "    signal_names = [str(signal) for signal in df.Signal.unique()]",
    "    signals = [",
    "        {'name': name, 'kind': 'biomass' if name == 'Biomass' else 'fluorescence'}",
    "        for name in signal_names",
    "    ]",
    "    sample_ids = list(dict.fromkeys(df.Sample.tolist()))",
    "    index_by_sample = {sid: i for i, sid in enumerate(sample_ids) if i < len(sample_meta)}",
    "    measurements = []",
    "    for row in df.itertuples(index=False):",
    "        index = index_by_sample.get(row.Sample)",
    "        if index is None:",
    "            continue",
    "        value = float(row.Measurement)",
    "        if math.isnan(value):",
    "            continue",
    "        measurements.append({'sampleIndex': index, 'signal': str(row.Signal), 'value': value, 'time': float(row.Time)})",
    "    return FlapjackManifest({",
    "        'study': {'name': study_name, 'description': 'Simulated with LOICA'},",
    "        'assay': {'name': 'simulation', 'machine': 'LOICA', 'temperature': 0.0},",
    "        'signals': signals,",
    "        'samples': sample_meta,",
    "        'measurements': measurements,",
    "    })",
  ];
}

/// The per-node SBOL component assignments, e.g.
/// `GFP_sbol = node_component('gg_reporter_ex_gfp', 'GFP', 'reporter', [...])`.
function buildSbolComponents(
  document: CircuitDocument,
  varById: Map<string, string>,
): string[] {
  const lines = ["# --- SBOL components ---"];
  for (const node of document.nodes) {
    const varName = varById.get(node.id);
    if (!varName) {
      continue;
    }
    lines.push(
      `${sbolVarName(varName)} = node_component(${pyLiteral(
        sbolNodeIdentity(node),
      )}, ${pyLiteral(node.name)}, ${pyLiteral(node.kind)}, ${pyDataLiteral(
        sbolCompMetadata(node)?.parts ?? [],
      )})`,
    );
  }
  return lines;
}

/// The circuit itself: species, then edge-wired operators, assembled into a
/// `GeneticNetwork`. Each node carries the SBOL component built above.
function buildCircuit(
  document: CircuitDocument,
  varById: Map<string, string>,
): string[] {
  const species = document.nodes.filter((node) => !isOperator(node.kind));
  const operators = document.nodes.filter((node) => isOperator(node.kind));
  const lines: string[] = [];

  if (species.length > 0) {
    lines.push("# --- species ---");
    for (const node of species) {
      const varName = varById.get(node.id)!;
      lines.push(nodeAssignment(node, varName, null, sbolVarName(varName)));
    }
    lines.push("");
  }

  if (operators.length > 0) {
    lines.push("# --- operators ---");
    for (const node of operators) {
      const wiring = resolveWiring(document, node, varById);
      const varName = varById.get(node.id)!;
      lines.push(nodeAssignment(node, varName, wiring, sbolVarName(varName)));
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

  return lines;
}

function sbolVarName(varName: string): string {
  return `${varName}_sbol`;
}

function sbolNodeIdentity(node: CircuitNode): string {
  return `gg_${node.kind}_${node.id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/// The dose-response simulation: a Gompertz metabolism, one sample per point of
/// a log-spaced dose sweep over the first supplement (or a single baseline
/// sample), an `Assay`, and rich output — the measurements DataFrame, the
/// reporter timecourse, and the Flapjack manifest.
function buildSimulationBody(
  document: CircuitDocument,
  varById: Map<string, string>,
): string[] {
  const sim = document.simulation;
  const [y0, ymax, um, lag] = sim.biomass;

  const supplements = document.nodes.filter(
    (node) => node.kind === "supplement",
  );
  const firstSupplement = supplements[0]
    ? varById.get(supplements[0].id)
    : null;

  const reporterNames = document.nodes
    .filter((node) => node.kind === "reporter")
    .map((node) => node.name);
  const studyLit = pyLiteral(
    reporterNames.length
      ? `Circuit: ${reporterNames.join(", ")}`
      : "Circuit simulation",
  );
  const vectorLit = pyLiteral(
    reporterNames.length ? reporterNames.join("+") : "circuit",
  );
  const supplementLit = pyLiteral(supplements[0]?.name ?? "inducer");

  const lines: string[] = [
    "# --- simulation ---",
    `metab = SimulatedMetabolism('sim', lambda t: gompertz(t, ${y0}, ${ymax}, ${um}, ${lag}), lambda t: gompertz_growth_rate(t, ${y0}, ${ymax}, ${um}, ${lag}))`,
  ];

  if (firstSupplement) {
    const lo = Math.log10(sim.doseMin > 0 ? sim.doseMin : 1e-6);
    const hi = Math.log10(sim.doseMax > 0 ? sim.doseMax : 1);
    lines.push(
      `doses = np.append(0, np.logspace(${round(lo)}, ${round(hi)}, ${sim.dosePoints}))`,
      "samples = []",
      "sample_meta = []",
      "for i, conc in enumerate(doses):",
      "    sample = Sample(genetic_network=network, metabolism=metab, media='M9', strain='E. coli')",
      `    sample.set_supplement(${firstSupplement}, conc)`,
      "    samples.append(sample)",
      `    sample_meta.append({'row': 0, 'col': i, 'media': 'M9', 'strain': 'E. coli', 'vector': ${vectorLit}, 'supplements': [{'chemical': ${supplementLit}, 'concentration': float(conc)}]})`,
    );
  } else {
    lines.push(
      "samples = [Sample(genetic_network=network, metabolism=metab, media='M9', strain='E. coli')]",
      `sample_meta = [{'row': 0, 'col': 0, 'media': 'M9', 'strain': 'E. coli', 'vector': ${vectorLit}, 'supplements': []}]`,
    );
  }

  const runArgs =
    sim.method === "ssa"
      ? "stochastic=True"
      : sim.nsr > 0
        ? `nsr=${sim.nsr}`
        : "";

  lines.push(
    `assay = Assay(samples, n_measurements=${sim.nMeasurements}, interval=${sim.interval}, biomass_signal_id='od')`,
    `assay.run(${runArgs})`,
    "df = assay.measurements",
    "reporter_colors = {reporter.name: reporter.color for sample in samples for reporter in sample.reporters}",
    "df['HexColor'] = df['Signal'].map(reporter_colors)",
    "",
    "display(df)",
    "plot_reporter_timecourse(df)",
    `display(flapjack_manifest(df, sample_meta, ${studyLit}))`,
  );

  return lines;
}

/// The complete runnable script: imports, clients, helpers, the circuit, and the
/// simulation with its plot and Flapjack export.
export function generateScript(
  document: CircuitDocument,
  sbolDbUrl?: string | null,
  flapjackUrl?: string | null,
): string {
  const varById = assignVarNames(document);
  const sections = [
    buildImports({
      sbolDb: Boolean(sbolDbUrl),
      flapjack: Boolean(flapjackUrl),
      simulation: true,
    }),
    buildClients(sbolDbUrl, flapjackUrl, { flapjack: true }),
    ["", ""],
    buildSbolHelpers(),
    ["", ""],
    buildPlotHelper(),
    ["", ""],
    buildFlapjackHelper(),
    ["", ""],
    buildSbolComponents(document, varById),
    [""],
    buildCircuit(document, varById),
    [""],
    buildSimulationBody(document, varById),
  ];
  return joinSections(sections);
}

/// A runnable script that converts the generated `GeneticNetwork` to SBOL,
/// validates it, and emits RDF/XML plus the validation report as a MIME payload.
export function buildSbolExportSource(
  document: CircuitDocument,
  sbolDbUrl?: string | null,
): string {
  const varById = assignVarNames(document);
  const sections = [
    buildImports({
      sbolDb: Boolean(sbolDbUrl),
      flapjack: false,
      simulation: false,
    }),
    buildClients(sbolDbUrl, null, { flapjack: false }),
    [""],
    buildSbolHelpers(),
    [""],
    buildSbolComponents(document, varById),
    [""],
    buildCircuit(document, varById),
    buildSbolExportBody(),
  ];
  return joinSections(sections);
}

/// The SBOL export body: convert the network, validate, and display the result.
function buildSbolExportBody(): string[] {
  return [
    "# --- SBOL export ---",
    "sbol_export_doc = network.to_sbol(sbol_doc=sbol_doc)",
    "sbol_identities = []",
    "for obj in sbol_export_doc.objects:",
    "    sbol_identities.append(str(obj.identity))",
    "    print(obj.identity)",
    "report_sbol3 = sbol_export_doc.validate()",
    "validation_count = len(report_sbol3)",
    "print(validation_count)",
    "validation_report = []",
    "for error in report_sbol3.errors:",
    "    validation_report.append('ERROR: ' + str(error))",
    "for warning in report_sbol3.warnings:",
    "    validation_report.append('WARNING: ' + str(warning))",
    "sbol_rdf_xml = sbol_export_doc.write_string(sbol3.RDF_XML)",
    "display({",
    `    '${SBOL_EXPORT_MIME}': {`,
    "        'rdfXml': sbol_rdf_xml,",
    "        'identities': sbol_identities,",
    "        'validationCount': validation_count,",
    "        'validationReport': validation_report,",
    "    },",
    "    'text/plain': f'SBOL export: {len(sbol_identities)} objects, {validation_count} validation issues',",
    "})",
  ];
}

/// Join the section line-arrays into one script, collapsing runs of blank lines
/// to at most one so the composed file stays tidy.
function joinSections(sections: string[][]): string {
  const text = sections.map((section) => section.join("\n")).join("\n");
  return `${text.replace(/\n{3,}/g, "\n\n\n")}\n`;
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
  const paramKinds = new Map(
    spec.params.filter((param) => !param.uiOnly).map((p) => [p.key, p.kind]),
  );

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
