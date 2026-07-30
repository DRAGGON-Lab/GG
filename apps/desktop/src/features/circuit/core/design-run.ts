import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { isTauriRuntime } from "@/features/circuit/core/circuit-run";
import {
  type DesignPortfolio,
  type DesignRequest,
  normalizeDesignRequest,
  parseDesignPortfolio,
} from "@/features/circuit/core/design-types";
import {
  loadSbolDesignLibrary,
  type SbolDesignLibrary,
} from "@/features/circuit/core/sbol-design-library";
import { parseDisplay } from "@/features/editor/components/artifacts/display";
import {
  onPythonEnvOutput,
  onPythonRunOutput,
  pythonEnvCreate,
  pythonEnvStatus,
  pythonPackagesInstall,
  pythonPackagesList,
  pythonRunScript,
} from "@/features/editor/core/python-service";

export const QUIVER_PORTFOLIO_MIME = "application/vnd.gg.quiver-portfolio+json";

const DESIGN_ENV_DIR = "circuit-design-runtime";
const DESIGN_ENV_MARKER = "circuit-design-runtime-req.txt";
const QUIVER_COMMIT = "5398290b2b191ba573ec9cbe255641680036a4c6";
const QUIVER_REQUIREMENT = `quiver @ git+https://github.com/marpaia/quiver.git@${QUIVER_COMMIT}`;
const REQUIRED_PACKAGES = [QUIVER_REQUIREMENT];

let cachedDesignRoot: string | null = null;
let designRootPromise: Promise<string> | null = null;

export async function runQuiverDesign(
  input: DesignRequest,
  onProgress: (message: string) => void,
): Promise<DesignPortfolio> {
  if (!isTauriRuntime()) {
    throw new Error("Quiver runs are available in the GG desktop app.");
  }
  const target = normalizeDesignRequest(input);
  onProgress("Reading eligible parts from GG's SBOL database…");
  const library = await loadSbolDesignLibrary(target.inducer);
  onProgress(
    `Using ${library.inventory.eligiblePartCount} SBOL parts (${library.inventory.priorPartCount} with kinetic priors).`,
  );
  onProgress("Checking the isolated Quiver runtime…");
  const root = await ensureDesignEnv(onProgress);
  onProgress("Training Quiver's graph policy and sampling candidates…");

  let payload: unknown = null;
  const unlisten = await onPythonRunOutput((output) => {
    if (output.stream === "display") {
      const bundle = parseDisplay(output.line);
      const candidate = bundle?.data?.[QUIVER_PORTFOLIO_MIME];
      if (candidate !== undefined) {
        payload = candidate;
      }
      return;
    }
    if (output.stream === "stdout" && output.line.trim() !== "") {
      onProgress(output.line.trim());
    }
  });
  try {
    const result = await pythonRunScript(
      buildQuiverScript(target, library),
      undefined,
      root,
    );
    if (result.exitCode !== 0) {
      throw new Error("Quiver exited before producing a candidate portfolio.");
    }
    if (payload === null) {
      throw new Error("Quiver did not return a candidate portfolio.");
    }
    const portfolio = parseDesignPortfolio(payload);
    onProgress(
      portfolio.candidates.length === 1
        ? "Quiver returned 1 distinct candidate."
        : `Quiver returned ${portfolio.candidates.length} distinct candidates.`,
    );
    return portfolio;
  } finally {
    unlisten();
  }
}

async function ensureDesignEnv(
  onProgress: (message: string) => void,
): Promise<string> {
  if (cachedDesignRoot) {
    return cachedDesignRoot;
  }
  if (designRootPromise) {
    return designRootPromise;
  }
  designRootPromise = (async () => {
    const diagnostics: string[] = [];
    const unlisten = await onPythonEnvOutput((output) => {
      // Keep uv's high-volume stream out of the compact Design panel, but retain
      // a bounded stderr tail so failures remain actionable.
      const line = output.line.trim();
      if (output.stream === "stderr" && line !== "") {
        diagnostics.push(line);
        diagnostics.splice(0, Math.max(0, diagnostics.length - 4));
      }
    });
    try {
      const root = await join(await appLocalDataDir(), DESIGN_ENV_DIR);
      await mkdir(root, { recursive: true });
      const status = await pythonEnvStatus(root);
      if (!status.hasVenv) {
        onProgress("Creating the isolated design environment…");
        diagnostics.length = 0;
        const created = await pythonEnvCreate(root);
        if (created.exitCode !== 0) {
          throw new Error(
            runtimeFailure(
              "Could not create the Quiver environment.",
              diagnostics,
            ),
          );
        }
      }

      const markerPath = await join(root, DESIGN_ENV_MARKER);
      let recorded = "";
      try {
        recorded = (await readTextFile(markerPath)).trim();
      } catch {
        // First setup has no marker.
      }
      const installed = new Set(
        (await pythonPackagesList(root)).map((pkg) => pkg.name.toLowerCase()),
      );
      const expected = REQUIRED_PACKAGES.join("\n");
      if (recorded !== expected || !installed.has("quiver")) {
        onProgress(
          "Installing Quiver and its ML runtime once (this is a large download)…",
        );
        diagnostics.length = 0;
        const result = await pythonPackagesInstall(root, REQUIRED_PACKAGES);
        if (result.exitCode !== 0) {
          throw new Error(
            runtimeFailure(
              "Could not install the pinned Quiver runtime.",
              diagnostics,
            ),
          );
        }
        await writeTextFile(markerPath, expected);
      }
      cachedDesignRoot = root;
      return root;
    } finally {
      unlisten();
    }
  })();
  try {
    return await designRootPromise;
  } catch (error) {
    designRootPromise = null;
    throw error;
  }
}

function runtimeFailure(summary: string, diagnostics: string[]): string {
  const detail = diagnostics.join(" ");
  return detail === "" ? summary : `${summary} ${detail}`;
}

function buildQuiverScript(
  target: DesignRequest,
  library: SbolDesignLibrary,
): string {
  const requestJson = JSON.stringify(JSON.stringify(target));
  const componentsJson = JSON.stringify(JSON.stringify(library.components));
  const inventoryJson = JSON.stringify(JSON.stringify(library.inventory));
  return [
    "import hashlib",
    "import importlib.metadata",
    "import json",
    "import statistics",
    "import time",
    "import quiver",
    "from quiver.component import Component, ComponentLibrary",
    "from quiver.objective import TargetResponse, dose_response_match",
    "",
    `request = json.loads(${requestJson})`,
    `part_specs = json.loads(${componentsJson})`,
    `inventory = json.loads(${inventoryJson})`,
    "",
    "cello = quiver.load_cello()",
    "def _median(values, fallback):",
    "    usable = [float(value) for value in values if value is not None]",
    "    return statistics.median(usable) if usable else fallback",
    "",
    "def _template(role):",
    "    source = cello.sensors() if role == 'sensor' else cello.gates()",
    "    return {",
    "        'ymax': _median([part.ymax for part in source], 100.0),",
    "        'ymin': _median([part.ymin for part in source], 1.0),",
    "        'K': _median([part.K for part in source], 1.0),",
    "        'n': _median([part.n for part in source], 2.0),",
    "    }",
    "",
    "def _component(spec):",
    "    template = _template(spec['role'])",
    "    ymax = spec.get('ymax')",
    "    ymin = spec.get('ymin')",
    "    dynamic_range = spec.get('dynamicRange')",
    "    if ymax is None or ymin is None:",
    "        if dynamic_range is not None and float(dynamic_range) > 0:",
    "            ymin = 0.05",
    "            ymax = ymin * float(dynamic_range)",
    "        else:",
    "            ymax, ymin = template['ymax'], template['ymin']",
    "    return Component(",
    "        id=spec['variantId'],",
    "        name=spec['part'].get('displayId') or spec['part'].get('name') or spec['part']['iri'],",
    "        role=spec['role'],",
    "        regulator=spec['regulator'],",
    "        family=spec.get('family', ''),",
    "        organism=spec.get('organism', ''),",
    "        ymax=float(ymax),",
    "        ymin=float(ymin),",
    "        K=float(spec['k']) if spec.get('k') is not None else template['K'],",
    "        n=float(spec['n']) if spec.get('n') is not None else template['n'],",
    "        dynamic_range=float(ymax) / max(float(ymin), 1e-12),",
    "        source=spec['source'],",
    "        quality=spec['kineticsEvidence'],",
    "    )",
    "",
    "component_library = ComponentLibrary(tuple(_component(spec) for spec in part_specs), name='gg-sbol-db')",
    "spec_by_variant = {spec['variantId']: spec for spec in part_specs}",
    "started = time.perf_counter()",
    "target = TargetResponse(",
    "    request['signal'],",
    "    ec50=request['ec50'],",
    "    dynamic_range=request['dynamicRange'],",
    "    direction=request['direction'],",
    ")",
    "behavior = dose_response_match(target)",
    "portfolio = quiver.design(",
    "    behavior,",
    "    budget=request['budget'],",
    "    policy='gnn',",
    "    threshold=request['threshold'],",
    "    seed=request['seed'],",
    "    robust=True,",
    "    ensemble=12,",
    "    jitter=0.5 if inventory['priorPartCount'] else 0.3,",
    "    library=component_library,",
    "    inducer=request['inducer'],",
    ")",
    "operator_kinds = {'receiver', 'hill1', 'hill2', 'sum'}",
    "candidates = []",
    "rejected_ungrounded = 0",
    "for grn, score in portfolio:",
    "    topology = grn.topology_hash()",
    "    structural = grn.structural_hash()",
    "    operators = [node for node in grn.nodes if node.kind in operator_kinds]",
    "    design = grn.to_dict()",
    "    serialized_by_id = {node['id']: node for node in design['nodes']}",
    "    assignments = []",
    "    for node in operators:",
    "        spec = spec_by_variant.get(node.component_id)",
    "        if spec is None:",
    "            continue",
    "        serialized_by_id[node.id]['componentId'] = spec['part']['iri']",
    "        assignments.append({",
    "            'nodeId': node.id,",
    "            'part': spec['part'],",
    "            'role': spec['role'],",
    "            'kineticsEvidence': spec['kineticsEvidence'],",
    "            'kineticsSource': spec['source'],",
    "        })",
    "    if len(assignments) != len(operators):",
    "        rejected_ungrounded += 1",
    "        continue",
    "    candidate_id = hashlib.sha256(structural.encode()).hexdigest()[:12]",
    "    candidates.append({",
    "        'id': candidate_id,",
    "        'rank': len(candidates) + 1,",
    "        'score': float(score),",
    "        'topologyId': hashlib.sha256(topology.encode()).hexdigest()[:12],",
    "        'structuralId': candidate_id,",
    "        'design': design,",
    "        'assignments': assignments,",
    "    })",
    "payload = {",
    "    'schemaVersion': 1,",
    "    'provider': 'quiver',",
    "    'engine': {",
    "        'name': 'Quiver GFlowNet',",
    "        'version': importlib.metadata.version('quiver'),",
    "        'evidence': 'computed',",
    "    },",
    "    'target': request,",
    "    'library': {'source': 'sbol-db', **inventory},",
    "    'candidates': candidates,",
    "    'rejectedUngrounded': rejected_ungrounded,",
    "    'elapsedMs': round((time.perf_counter() - started) * 1000),",
    "}",
    "class _PortfolioDisplay:",
    "    def _repr_mimebundle_(self, include=None, exclude=None):",
    `        return {${JSON.stringify(QUIVER_PORTFOLIO_MIME)}: payload, 'text/plain': f"Quiver portfolio ({len(candidates)} candidates)"}`,
    "display(_PortfolioDisplay())",
  ].join("\n");
}
