//! Run a Flapjack characterization by executing the real `flapjack-data` engine
//! in the circuit's managed Python environment, over the same SQLite file the
//! Rust store owns. The analysis reads the database read-only and returns a
//! computed characterization, which the caller persists through the Rust store
//! (the single writer). The heavy numeric methods (Savitzky-Golay, non-negative
//! least squares, Gompertz fits, inverse solvers) stay in Python by design.
import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import {
  ensureCircuitEnv,
  isTauriRuntime,
} from "@/features/circuit/core/circuit-run";
import { parseDisplay } from "@/features/editor/components/artifacts/display";
import {
  onPythonEnvOutput,
  onPythonRunOutput,
  pythonPackagesInstall,
  pythonRunScript,
} from "@/features/editor/core/python-service";
import { loadDbPath } from "@/features/flapjack/core/flapjack-service";
import {
  FLAPJACK_CHARACTERIZATION_MIME,
  type SaveCharacterizationInput,
} from "@/features/flapjack/core/flapjack-types";

/// flapjack-data (with the analysis + sqlite extras) installed into the circuit
/// environment on first analysis. Pinned to a commit for reproducibility, like
/// the LOICA requirement. Bump the pin as flapjack-data evolves.
const FLAPJACK_DATA_REQUIREMENT =
  "flapjack-data[analysis,sqlite] @ git+https://github.com/marpaia/flapjack-data.git@11b6e86c6834f3648e5965f66b24a11495443304";

/// Marker file (in the env root) recording the requirement the environment was
/// last provisioned with. Reinstalling only when it changes lets a bumped pin
/// re-resolve a stale install, while a matching marker skips the slow path.
/// Not a dotfile: the fs capability's `$HOME/**` scope does not match a
/// leading-dot filename, so a hidden name would be a forbidden write path.
const FLAPJACK_DATA_MARKER = "flapjack-data-req.txt";

/// The analysis types the UI can run without extra per-analysis configuration.
/// Dose-response types auto-pick the first chemical as the analyte and Mean
/// Expression as the inner aggregate.
export const ANALYSIS_TYPES = [
  "Mean Expression",
  "Max Expression",
  "Velocity",
  "Mean Velocity",
  "Max Velocity",
  "Expression Rate (indirect)",
  "Expression Rate (direct)",
  "Expression Rate (inverse)",
  "Induction Curve",
  "Alpha",
] as const;

export type AnalysisTypeName = (typeof ANALYSIS_TYPES)[number];

/// Ensure the circuit environment exists (venv + loica) and additionally has
/// flapjack-data installed for analysis. Returns the environment root.
async function ensureAnalysisEnv(
  onLog: (line: string) => void,
): Promise<{ root: string } | { error: string }> {
  const base = await ensureCircuitEnv(() => {}, onLog);
  if ("error" in base) {
    return base;
  }

  // Reinstall only when the recorded requirement differs from the current pin;
  // this repairs a stale install (e.g. an earlier unpinned version without the
  // SQLite backend) and picks up a bumped pin, while skipping the slow path once
  // the environment matches.
  const markerPath = await join(base.root, FLAPJACK_DATA_MARKER);
  let recorded: string | null = null;
  try {
    recorded = (await readTextFile(markerPath)).trim();
  } catch {
    // No marker yet — treat the environment as never provisioned.
  }
  if (recorded !== FLAPJACK_DATA_REQUIREMENT) {
    const unlisten = await onPythonEnvOutput((output) => onLog(output.line));
    try {
      const result = await pythonPackagesInstall(base.root, [
        FLAPJACK_DATA_REQUIREMENT,
      ]);
      if (result.exitCode !== 0) {
        return {
          error: "Could not install flapjack-data into the environment.",
        };
      }
    } finally {
      unlisten();
    }
    await writeTextFile(markerPath, FLAPJACK_DATA_REQUIREMENT);
  }
  return { root: base.root };
}

/// Build the Python script that runs one characterization and emits the result
/// as a display artifact under the characterization MIME type.
export function buildAnalysisScript(
  dbPath: string,
  studyId: number,
  analysisType: string,
): string {
  const db = JSON.stringify(dbPath);
  const analysis = JSON.stringify(analysisType);
  return `import math

from flapjack_data.backends.sqlite import SQLiteStorage
from flapjack_data.characterization import AnalysisSpec, AnalysisType, Selection, engine
from flapjack_data.model import Chemical, Signal

DB_PATH = ${db}
STUDY_ID = ${studyId}
ANALYSIS = ${analysis}

store = SQLiteStorage(DB_PATH)
signals = store.list_all(Signal)
biomass_id = next((s.id for s in signals if (s.kind or "").lower() == "biomass"), None)
fluor_ids = [s.id for s in signals if (s.kind or "").lower() != "biomass"]

analysis = AnalysisType(ANALYSIS)
dose_types = (AnalysisType.INDUCTION_CURVE, AnalysisType.KYMOGRAPH)
if analysis in dose_types:
    selection = Selection(study_ids=[STUDY_ID], signal_ids=fluor_ids)
else:
    selection = Selection(study_ids=[STUDY_ID])

params = {"type": analysis, "selection": selection}
if biomass_id is not None:
    params["biomass_signal_id"] = biomass_id
if analysis in dose_types:
    chemicals = store.list_all(Chemical)
    if chemicals:
        params["analyte_id"] = chemicals[0].id
    params["function"] = AnalysisType.MEAN_EXPRESSION

result = engine.run(AnalysisSpec(**params), store, use_cache=False)


def _num(value):
    if value is None:
        return None
    value = float(value)
    return None if math.isnan(value) or math.isinf(value) else value


data = []
for datum in result.data:
    computed = _num(datum.value)
    if computed is None:
        continue
    data.append(
        {
            "sampleId": datum.sample_id,
            "signalId": datum.signal_id,
            "metric": datum.metric,
            "value": computed,
            "time": _num(datum.time),
            "concentration": _num(datum.concentration),
            "concentration2": _num(datum.concentration2),
        }
    )

payload = {
    "analysisType": result.characterization.analysis_type,
    "name": ANALYSIS + " — study " + str(STUDY_ID),
    "paramsHash": result.characterization.params_hash,
    "spec": result.characterization.spec,
    "data": data,
}


class _Result:
    def _repr_mimebundle_(self, include=None, exclude=None):
        return {"${FLAPJACK_CHARACTERIZATION_MIME}": payload}


display(_Result())
`;
}

/// Run one characterization and return the computed result, ready to persist via
/// `saveCharacterization`. Ensures the analysis environment first; streams
/// setup/install progress through `onLog`.
export async function runAnalysis(
  studyId: number,
  analysisType: string,
  onLog: (line: string) => void,
): Promise<SaveCharacterizationInput> {
  if (!isTauriRuntime()) {
    throw new Error("Analysis is only available in the desktop app.");
  }
  const dbPath = await loadDbPath();
  const env = await ensureAnalysisEnv(onLog);
  if ("error" in env) {
    throw new Error(env.error);
  }

  const script = buildAnalysisScript(dbPath, studyId, analysisType);
  let payload: SaveCharacterizationInput | null = null;
  const stderr: string[] = [];
  let activeRunId: number | null = null;

  const unlisten = await onPythonRunOutput((output) => {
    if (activeRunId !== null && output.runId !== activeRunId) {
      return;
    }
    if (output.stream === "display") {
      const bundle = parseDisplay(output.line);
      const found = bundle?.data?.[FLAPJACK_CHARACTERIZATION_MIME];
      if (found) {
        payload = found as SaveCharacterizationInput;
      }
    } else if (output.stream === "stderr") {
      stderr.push(output.line);
    }
  });

  try {
    const result = await pythonRunScript(script, undefined, env.root);
    activeRunId = result.runId;
    if (!payload && result.exitCode !== 0) {
      throw new Error(stderr.join("\n").trim() || "Analysis failed.");
    }
  } finally {
    unlisten();
  }

  if (!payload) {
    throw new Error(stderr.join("\n").trim() || "Analysis produced no result.");
  }
  return payload;
}
