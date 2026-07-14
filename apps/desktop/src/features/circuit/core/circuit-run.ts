import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import {
  onPythonEnvOutput,
  onPythonRunOutput,
  pythonEnvCreate,
  pythonEnvStatus,
  pythonPackagesInstall,
  pythonPackagesList,
  pythonRunScript,
} from "@/features/editor/core/python-service";

/// Circuit owns a dedicated, app-managed Python environment — the user never
/// opens a folder or manages packages. It lives under the app's local data
/// directory and holds a `.venv` with loica and Plotly installed on first
/// use, then reused on every later run.
const CIRCUIT_ENV_DIR = "circuit-runtime";

/// LOICA 1.0.7 includes pandas-2-compatible assay output and preserves
/// gene-product HEX colors for downstream tables and plots. Keep the managed
/// environment on 1.0.7 or newer so active LOICA co-development can pull the
/// latest compatible release until we freeze it for an app release.
const LOICA_REQUIREMENT = "loica>=1.0.7";
const CIRCUIT_ENV_MARKER = "circuit-runtime-req.txt";

/// Packages the managed environment needs for circuit simulation. Plotly backs
/// the interactive reporter plot; loica is the simulation engine.
const REQUIRED_PACKAGES = [LOICA_REQUIREMENT, "plotly"];
const REQUIRED_NAMES = ["loica", "plotly"];

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let cachedRoot: string | null = null;

/// The absolute path to the managed environment root, created on first access.
export async function getCircuitEnvRoot(): Promise<string> {
  if (cachedRoot) {
    return cachedRoot;
  }
  const root = await join(await appLocalDataDir(), CIRCUIT_ENV_DIR);
  await mkdir(root, { recursive: true });
  cachedRoot = root;
  return root;
}

export type EnvPhase = "checking" | "creating" | "installing" | "ready";

export type EnsureEnvResult = { root: string } | { error: string };

/// Ensure the managed environment exists with the required packages, creating
/// the `.venv` and installing packages as needed. Reports coarse phases and
/// streams uv's progress lines. A no-op (fast) once set up.
export async function ensureCircuitEnv(
  onPhase: (phase: EnvPhase) => void,
  onLog: (line: string) => void,
): Promise<EnsureEnvResult> {
  const unlisten = await onPythonEnvOutput((output) => onLog(output.line));
  try {
    const root = await getCircuitEnvRoot();

    onPhase("checking");
    const status = await pythonEnvStatus(root);
    if (!status.hasVenv) {
      onPhase("creating");
      const created = await pythonEnvCreate(root);
      if (created.exitCode !== 0) {
        return { error: "Could not create the Python environment." };
      }
    }

    const installed = new Set(
      (await pythonPackagesList(root)).map((pkg) => pkg.name.toLowerCase()),
    );
    const markerPath = await join(root, CIRCUIT_ENV_MARKER);
    let recorded: string | null = null;
    try {
      recorded = (await readTextFile(markerPath)).trim();
    } catch {
      // No marker yet — treat the environment as needing verification.
    }
    const expected = REQUIRED_PACKAGES.join("\n");
    if (
      recorded !== expected ||
      !REQUIRED_NAMES.every((name) => installed.has(name))
    ) {
      onPhase("installing");
      const result = await pythonPackagesInstall(root, REQUIRED_PACKAGES);
      if (result.exitCode !== 0) {
        return { error: "Could not install loica into the environment." };
      }
      await writeTextFile(markerPath, expected);
    }

    onPhase("ready");
    return { root };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Environment setup failed.",
    };
  } finally {
    unlisten();
  }
}

export type RunLine = {
  stream: "stdout" | "stderr" | "display";
  text: string;
};

/// Run a generated Loica script in the managed environment, streaming its
/// output lines. Resolves with the process exit code once the run completes.
export async function runCircuitScript(
  script: string,
  workspaceRoot: string,
  onLine: (line: RunLine) => void,
): Promise<{ exitCode: number | null }> {
  let activeRunId: number | null = null;
  const unlisten = await onPythonRunOutput((output) => {
    if (activeRunId !== null && output.runId !== activeRunId) {
      return;
    }
    onLine({ stream: output.stream, text: output.line });
  });

  try {
    const result = await pythonRunScript(script, undefined, workspaceRoot);
    activeRunId = result.runId;
    return { exitCode: result.exitCode };
  } finally {
    unlisten();
  }
}
