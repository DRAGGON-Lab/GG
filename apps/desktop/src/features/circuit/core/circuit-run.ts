import { invoke } from "@tauri-apps/api/core";
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
/// gene-product HEX colors for downstream tables and plots. Pin the managed
/// environment so existing installs can be upgraded deterministically.
const LOICA_REQUIREMENT = "loica==1.0.7";
const CIRCUIT_ENV_MARKER = "circuit-runtime-req.txt";

/// Packages the managed environment needs for circuit simulation. Plotly backs
/// the interactive reporter plot; loica is the simulation engine; sbol-db is
/// the client for the app's embedded SBOL server, letting scripts read and
/// write the corpus the Data tab shows; pyFlapjack is the client for the app's
/// embedded Flapjack server, letting scripts upload measurements and request
/// analyses against the Flapjack tab's installation. pyFlapjack is pinned to the
/// fork that supports the pandas 2 stack loica needs (upstream pins pandas 1.5).
const PYFLAPJACK_REQUIREMENT =
  "pyflapjack @ git+https://github.com/marpaia/pyFlapjack.git";
const REQUIRED_PACKAGES = [
  LOICA_REQUIREMENT,
  "plotly",
  "sbol-db",
  PYFLAPJACK_REQUIREMENT,
];
const REQUIRED_NAMES = ["loica", "plotly", "sbol-db", "pyflapjack"];

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/// The loopback base URL of the app's embedded sbol-db server, or `null`
/// outside the desktop app (or if the server did not start). Passed into the
/// generated LOICA script so it can construct an `sbol-db` client.
export async function getSbolServerUrl(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    const info = await invoke<{ baseUrl: string }>("sbol_server_info");
    return info.baseUrl;
  } catch {
    return null;
  }
}

/// The loopback base URL of the app's embedded Flapjack API server, or `null`
/// outside the desktop app (or if it could not start). Unlike the sbol-db
/// server (in-process, always up), the Flapjack server is a Python process
/// started on demand: `flapjack_server_ensure` creates its managed environment
/// on first use and launches it, returning the URL. Passed into the generated
/// LOICA script so it can construct a `pyFlapjack` client.
export async function getFlapjackServerUrl(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    const info = await invoke<{ baseUrl: string }>("flapjack_server_ensure");
    return info.baseUrl;
  } catch (error) {
    // Surface the reason (missing command in an un-rebuilt binary, a failed
    // environment build, a health-check timeout) rather than hiding it behind a
    // silent `flapjack = None` in the generated script.
    console.error("Flapjack server unavailable:", error);
    return null;
  }
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
