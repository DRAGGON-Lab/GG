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

/// The import block for a generated script. All imports live at the top of the
/// file; `simulation` adds what the timecourse harness needs, `sbolDb` adds the
/// client used to pull component definitions.
function buildImports(options: {
  sbolDb: boolean;
  simulation: boolean;
}): string[] {
  const lines: string[] = [];
  if (options.simulation) {
    lines.push("import math", "import numpy as np");
  }
  lines.push("import sbol3");
  if (options.simulation) {
    lines.push("import plotly.graph_objects as go");
  }
  lines.push("from loica import *");
  if (options.sbolDb) {
    lines.push("from sbol_db import SbolDbClient");
  }
  lines.push("");
  return lines;
}

/// Build the network-construction portion of the script (SBOL setup through
/// `GeneticNetwork` assembly), without the simulation harness. The caller emits
/// the import block; when `sbolDbUrl` is given the script constructs an
/// `sbol-db` client bound to the app's embedded server and pulls real component
/// definitions from it.
export function buildNetworkSource(
  document: CircuitDocument,
  sbolDbUrl?: string | null,
): string {
  const varById = assignVarNames(document);
  const lines: string[] = [
    ...buildSbolSetupSource(document, varById, sbolDbUrl),
  ];

  const species = document.nodes.filter((node) => !isOperator(node.kind));
  const operators = document.nodes.filter((node) => isOperator(node.kind));

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

  return `${lines.join("\n")}\n`;
}

function buildSbolSetupSource(
  document: CircuitDocument,
  varById: Map<string, string>,
  sbolDbUrl?: string | null,
): string[] {
  const lines: string[] = [
    "# --- SBOL components ---",
    "sbol3.set_namespace('https://gg.draggonlab.org/circuit')",
    "sbol_doc = sbol3.Document()",
    "_gg_sbol_components = {}",
    "",
    ...buildSbolClientSource(sbolDbUrl),
    "def _gg_sbol_role_uri(role):",
    "    mapping = {",
    "        'promoter': sbol3.SO_PROMOTER,",
    "        'rbs': sbol3.SO_RBS,",
    "        'cds': sbol3.SO_CDS,",
    "        'terminator': sbol3.SO_TERMINATOR,",
    "        'engineered region': sbol3.SO_ENGINEERED_REGION,",
    "        'stability': sbol3.SO_CDS,",
    "    }",
    "    return mapping.get(role)",
    "",
    "def _gg_sbol_type_uri(node_kind, role):",
    "    if node_kind == 'supplement':",
    "        return sbol3.SBO_SIMPLE_CHEMICAL",
    "    if role == 'rna':",
    "        return sbol3.SBO_RNA",
    "    if role == 'protein':",
    "        return sbol3.SBO_PROTEIN",
    "    return sbol3.SBO_DNA",
    "",
    "def _gg_sbol_component(identity, name, node_kind, role, roles):",
    "    if identity in _gg_sbol_components:",
    "        return _gg_sbol_components[identity]",
    "    role_values = []",
    "    for value in roles or []:",
    "        if value and value not in role_values:",
    "            role_values.append(value)",
    "    role_uri = _gg_sbol_role_uri(role)",
    "    if role_uri and role_uri not in role_values:",
    "        role_values.append(role_uri)",
    "    comp = sbol3.Component(identity, _gg_sbol_type_uri(node_kind, role), roles=role_values or None, name=name)",
    "    sbol_doc.add(comp)",
    "    _gg_sbol_components[identity] = comp",
    "    return comp",
    "",
    "def _gg_pull_component(iri):",
    "    # Pull a part's real SBOL3 definition (and its reference closure) from",
    "    # the embedded sbol-db server into sbol_doc. Returns the Component, or",
    "    # None to fall back to a locally-synthesized one.",
    "    if sbol_db is None or not iri:",
    "        return None",
    "    existing = sbol_doc.find(iri)",
    "    if existing is not None:",
    "        return existing",
    "    try:",
    "        rdf = sbol_db.export_rdf(iri, format='rdfxml', version='sbol3', recursive=True)",
    "        pulled = sbol3.Document()",
    "        pulled.read_string(rdf, sbol3.RDF_XML)",
    "        target = pulled.find(iri)",
    "        if not isinstance(target, sbol3.Component):",
    "            return None",
    "        fresh = [obj for obj in pulled.objects if sbol_doc.find(str(obj.identity)) is None]",
    "        if fresh:",
    "            sbol3.copy(fresh, into_document=sbol_doc)",
    "        return sbol_doc.find(iri)",
    "    except Exception:",
    "        return None",
    "",
    "def _gg_node_sbol_comp(identity, name, node_kind, parts):",
    "    if not parts:",
    "        return _gg_sbol_component(identity, name, node_kind, 'engineered region', [sbol3.SO_ENGINEERED_REGION])",
    "    part_components = []",
    "    for part in parts:",
    "        pulled = _gg_pull_component(part.get('iri'))",
    "        if pulled is not None:",
    "            part_components.append(pulled)",
    "            continue",
    "        part_components.append(_gg_sbol_component(",
    "            part.get('iri') or part.get('display_id'),",
    "            part.get('name') or part.get('display_id'),",
    "            node_kind,",
    "            part.get('role'),",
    "            part.get('roles') or [],",
    "        ))",
    "    if len(part_components) == 1:",
    "        return part_components[0]",
    "    comp = _gg_sbol_component(identity, name, node_kind, 'engineered region', [sbol3.SO_ENGINEERED_REGION])",
    "    comp.features = [sbol3.SubComponent(part) for part in part_components]",
    "    comp.constraints = [sbol3.Constraint(sbol3.SBOL_PRECEDES, comp.features[i], comp.features[i + 1]) for i in range(len(comp.features) - 1)]",
    "    return comp",
    "",
  ];

  for (const node of document.nodes) {
    const varName = varById.get(node.id);
    if (!varName) {
      continue;
    }
    lines.push(
      `${sbolVarName(varName)} = _gg_node_sbol_comp(${pyLiteral(
        sbolNodeIdentity(node),
      )}, ${pyLiteral(node.name)}, ${pyLiteral(node.kind)}, ${pyDataLiteral(
        sbolCompMetadata(node)?.parts ?? [],
      )})`,
    );
  }
  lines.push("");
  return lines;
}

/// The `sbol_db` client setup: an `SbolDbClient` bound to the app's embedded
/// server when a URL is known, else `None`. Defining `sbol_db` unconditionally
/// lets the pull helper — and any hand-written or AI-edited code — reference it
/// safely; a missing server simply means the local synthesis path is used.
/// `SbolDbClient` is imported in the top-level import block; construction opens
/// no connection (it just holds the base URL), so this is a plain assignment.
function buildSbolClientSource(sbolDbUrl?: string | null): string[] {
  if (!sbolDbUrl) {
    return ["# --- sbol-db client (unavailable) ---", "sbol_db = None", ""];
  }
  return [
    "# --- sbol-db client ---",
    `sbol_db = SbolDbClient(${pyLiteral(sbolDbUrl)})`,
    "",
  ];
}

function sbolVarName(varName: string): string {
  return `${varName}_sbol`;
}

function sbolNodeIdentity(node: CircuitNode): string {
  return `gg_${node.kind}_${node.id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/// Build the simulation harness: a Gompertz metabolism, one sample per point of
/// a log-spaced dose sweep over the first supplement (or a single baseline
/// sample when the circuit has no supplement), an `Assay`, and rich output — the
/// measurements DataFrame plus an interactive reporter timecourse figure. Both
/// render in the Output panel via the runner's rich `display()` protocol.
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

  // Registry metadata for the Flapjack manifest. Reporters name the vector
  // (a construct) and the study; the first supplement is the dose-response
  // analyte. Embedded as JSON so they are valid Python string literals.
  const reporterNames = document.nodes
    .filter((node) => node.kind === "reporter")
    .map((node) => node.name);
  const studyLit = JSON.stringify(
    reporterNames.length
      ? `Circuit: ${reporterNames.join(", ")}`
      : "Circuit simulation",
  );
  const vectorLit = JSON.stringify(
    reporterNames.length ? reporterNames.join("+") : "circuit",
  );
  const supplementLit = JSON.stringify(supplements[0]?.name ?? "inducer");

  const lines: string[] = [
    "",
    "# --- simulation ---",
    "",
    `metab = SimulatedMetabolism('sim', lambda t: gompertz(t, ${y0}, ${ymax}, ${um}, ${lag}), lambda t: gompertz_growth_rate(t, ${y0}, ${ymax}, ${um}, ${lag}))`,
  ];

  if (firstSupplement) {
    const lo = Math.log10(sim.doseMin > 0 ? sim.doseMin : 1e-6);
    const hi = Math.log10(sim.doseMax > 0 ? sim.doseMax : 1);
    lines.push(
      `doses = np.append(0, np.logspace(${round(lo)}, ${round(hi)}, ${sim.dosePoints}))`,
      "samples = []",
      "sample_meta = []",
      "for _i, conc in enumerate(doses):",
      "    sample = Sample(genetic_network=network, metabolism=metab, media='M9', strain='E. coli')",
      `    sample.set_supplement(${firstSupplement}, conc)`,
      "    samples.append(sample)",
      `    sample_meta.append({'row': 0, 'col': _i, 'media': 'M9', 'strain': 'E. coli', 'vector': ${vectorLit}, 'supplements': [{'chemical': ${supplementLit}, 'concentration': float(conc)}]})`,
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
    "_reporter_hexcolors = {reporter.name: reporter.color for sample in samples for reporter in sample.reporters}",
    "df['HexColor'] = df['Signal'].map(_reporter_hexcolors)",
    "display(df)",
    "",
    "signals = df[df.Signal != 'Biomass']",
    "if len(signals):",
    "    fig = go.Figure()",
    "    labeled_signals = set()",
    "    for (sample_id, signal), group in signals.groupby(['Sample', 'Signal']):",
    "        label = signal",
    "        hexcolor = group.HexColor.dropna().iloc[0] if 'HexColor' in group and group.HexColor.notna().any() else None",
    "        show_legend = signal not in labeled_signals",
    "        fig.add_trace(go.Scatter(",
    "            x=group.Time,",
    "            y=group.Measurement,",
    "            mode='lines+markers',",
    "            name=label,",
    "            legendgroup=signal,",
    "            showlegend=show_legend,",
    "            line=dict(color=hexcolor, width=1.8),",
    "            marker=dict(size=4),",
    "            customdata=np.stack([group.Sample, group.Signal], axis=-1),",
    "            hovertemplate='Time: %{x:.3g} h<br>Measurement: %{y:.3g}<br>Sample: %{customdata[0]}<br>Signal: %{customdata[1]}<extra></extra>',",
    "        ))",
    "        labeled_signals.add(signal)",
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
  );

  // Emit the experiment as a Flapjack manifest under a custom MIME type. The
  // Flapjack tab captures it (the circuit Output panel ignores this MIME) and
  // imports the whole study on demand. Measurements map back to samples by
  // first-seen order in the DataFrame, which matches sample creation order.
  lines.push(
    "",
    "# --- flapjack manifest ---",
    "_signal_names = [str(_s) for _s in df.Signal.unique()]",
    "_signals = [{'name': _n, 'kind': 'biomass' if _n == 'Biomass' else 'fluorescence'} for _n in _signal_names]",
    "_sample_ids = list(dict.fromkeys(df.Sample.tolist()))",
    "_id_to_index = {_sid: _i for _i, _sid in enumerate(_sample_ids) if _i < len(sample_meta)}",
    "_measurements = []",
    "for _row in df.itertuples(index=False):",
    "    _idx = _id_to_index.get(_row.Sample)",
    "    if _idx is None:",
    "        continue",
    "    _val = float(_row.Measurement)",
    "    if math.isnan(_val):",
    "        continue",
    "    _measurements.append({'sampleIndex': _idx, 'signal': str(_row.Signal), 'value': _val, 'time': float(_row.Time)})",
    "_manifest = {",
    `    'study': {'name': ${studyLit}, 'description': 'Simulated with LOICA'},`,
    "    'assay': {'name': 'simulation', 'machine': 'LOICA', 'temperature': 0.0},",
    "    'signals': _signals,",
    "    'samples': sample_meta,",
    "    'measurements': _measurements,",
    "}",
    "class _FlapjackManifest:",
    "    def __init__(self, payload):",
    "        self._payload = payload",
    "    def _repr_mimebundle_(self, include=None, exclude=None):",
    "        return {'application/vnd.gg.flapjack+json': self._payload}",
    "display(_FlapjackManifest(_manifest))",
  );

  return `${lines.join("\n")}\n`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/// Build a runnable script that converts the generated `GeneticNetwork` to SBOL,
/// validates it, and emits RDF/XML plus the validation report as a MIME payload.
export function buildSbolExportSource(
  document: CircuitDocument,
  sbolDbUrl?: string | null,
): string {
  const lines = [
    ...buildImports({ sbolDb: Boolean(sbolDbUrl), simulation: false }),
    buildNetworkSource(document, sbolDbUrl).trimEnd(),
    "",
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
  return `${lines.join("\n")}\n`;
}

/// The complete runnable script: network construction followed by the
/// simulation harness.
export function generateScript(
  document: CircuitDocument,
  sbolDbUrl?: string | null,
): string {
  const imports = buildImports({
    sbolDb: Boolean(sbolDbUrl),
    simulation: true,
  }).join("\n");
  return `${imports}\n${buildNetworkSource(document, sbolDbUrl)}${buildSimulationSource(document)}`;
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
