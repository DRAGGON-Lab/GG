import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";

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
/// directory and holds a `.venv` with loica (and matplotlib) installed on first
/// use, then reused on every later run.
const CIRCUIT_ENV_DIR = "circuit-runtime";

/// The published loica 1.0.6 predates the pandas-2.0 fix (its `Assay.run` calls
/// the removed `DataFrame.append`), so the environment installs loica from the
/// upstream commit that switches to `pd.concat`, pinned for reproducibility.
const LOICA_REQUIREMENT =
  "loica @ git+https://github.com/RudgeLab/LOICA.git@c2b65b30938f5f67a4fa215689efbb418510c422";

/// Packages the managed environment needs for circuit simulation. matplotlib
/// backs the reporter plot; loica is the simulation engine.
const REQUIRED_PACKAGES = [LOICA_REQUIREMENT, "matplotlib"];
const REQUIRED_NAMES = ["loica", "matplotlib"];

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
    if (!REQUIRED_NAMES.every((name) => installed.has(name))) {
      onPhase("installing");
      const result = await pythonPackagesInstall(root, REQUIRED_PACKAGES);
      if (result.exitCode !== 0) {
        return { error: "Could not install loica into the environment." };
      }
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
