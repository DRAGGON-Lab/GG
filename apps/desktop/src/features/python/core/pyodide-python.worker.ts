import { loadPyodide, version as pyodideVersion } from "pyodide";

import type {
  PythonEvaluation,
  PythonKernelInfo,
  PythonResultValue,
  PythonWorkerRequest,
  PythonWorkerResponse,
} from "@/features/python/core/python.types";

type PyodideApi = Awaited<ReturnType<typeof loadPyodide>>;
type PythonGlobals = PyodideApi["globals"];

type PyodidePythonKernel = {
  kernel: PythonKernelInfo;
  pyodide: PyodideApi;
  formatPythonResult: (value: unknown) => string;
  resetPythonSession: () => void;
  sessionGlobals: () => PythonGlobals;
};

const PYODIDE_PACKAGE_CDN_URL = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
const MICROPIP_WHEEL_URL = `${PYODIDE_PACKAGE_CDN_URL}micropip-0.11.1-py3-none-any.whl`;

let kernelPromise: Promise<PyodidePythonKernel> | undefined;
let activePackageMessages: string[] | null = null;
let micropipPromise: Promise<void> | undefined;

const pythonPrelude = String.raw`
import json
from gg_packages import install

ans = None

def __gg_format_python_result(value):
    return json.dumps({
        "copyValue": str(value),
        "repr": repr(value),
        "text": str(value),
        "typeName": type(value).__name__,
    })
`;

function getPyodideIndexUrl() {
  return new URL("/assets/pyodide/", globalThis.location.href).toString();
}

async function getKernel() {
  if (kernelPromise) {
    return kernelPromise;
  }

  kernelPromise = loadKernel();
  return kernelPromise;
}

async function loadKernel(): Promise<PyodidePythonKernel> {
  const pyodide = await loadPyodide({
    indexURL: getPyodideIndexUrl(),
    stderr: console.warn,
    stdout: console.info,
  });

  registerPackageRuntime(pyodide);
  let pythonGlobals = createPythonSession(pyodide);

  return {
    formatPythonResult: (value) => {
      const formatter = pythonGlobals.get("__gg_format_python_result") as (
        pythonValue: unknown,
      ) => string;
      return formatter(value);
    },
    kernel: {
      offline: true,
      runtime: "Pyodide",
      runtimeVersion: pyodideVersion,
    },
    pyodide,
    resetPythonSession: () => {
      pythonGlobals.destroy?.();
      pythonGlobals = createPythonSession(pyodide);
    },
    sessionGlobals: () => pythonGlobals,
  };
}

function createPythonSession(pyodide: PyodideApi) {
  const globals = pyodide.runPython(
    "dict(__name__='__main__')",
  ) as PythonGlobals;
  pyodide.runPython(pythonPrelude, { globals });
  return globals;
}

function registerPackageRuntime(pyodide: PyodideApi) {
  pyodide.registerJsModule("gg_packages", {
    install: async (packageName: unknown) => {
      await ensureMicropip(pyodide);
      const micropip = pyodide.pyimport("micropip") as {
        install: (name: string) => Promise<void>;
      };
      const normalizedPackageName = String(packageName).trim();

      if (!normalizedPackageName) {
        throw new Error("Provide a package name to install.");
      }

      activePackageMessages?.push(`Installing ${normalizedPackageName}`);
      await micropip.install(normalizedPackageName);
      activePackageMessages?.push(`Installed ${normalizedPackageName}`);
      return normalizedPackageName;
    },
  });
}

async function ensureMicropip(pyodide: PyodideApi) {
  micropipPromise ??= pyodide
    .loadPackage(MICROPIP_WHEEL_URL, {
      checkIntegrity: false,
      errorCallback: (message) => activePackageMessages?.push(message),
      messageCallback: (message) => activePackageMessages?.push(message),
    })
    .then(() => undefined)
    .catch((error: unknown) => {
      micropipPromise = undefined;
      throw error;
    });

  await micropipPromise;
}

async function evaluatePython(code: string) {
  const { formatPythonResult, kernel, pyodide, sessionGlobals } =
    await getKernel();
  const startedAt = performance.now();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const packageMessages: string[] = [];
  let error: string | undefined;
  let result: PythonResultValue | undefined;

  activePackageMessages = packageMessages;
  pyodide.setStdout({ batched: (message) => stdout.push(message) });
  pyodide.setStderr({ batched: (message) => stderr.push(message) });

  try {
    const rawResult = await pyodide.runPythonAsync(code, {
      filename: "<gg-python>",
      globals: sessionGlobals(),
    });

    if (rawResult !== undefined && rawResult !== null) {
      sessionGlobals().set("ans", rawResult);
      result = JSON.parse(formatPythonResult(rawResult)) as PythonResultValue;
    }
  } catch (caughtError) {
    error =
      caughtError instanceof Error
        ? caughtError.message
        : "Python evaluation failed unexpectedly";
  } finally {
    activePackageMessages = null;
    pyodide.setStdout({ batched: console.info });
    pyodide.setStderr({ batched: console.warn });
  }

  return {
    code,
    elapsedMs: Math.round(performance.now() - startedAt),
    error,
    kernel,
    loadedPackages: Object.keys(pyodide.loadedPackages).sort(),
    result,
    stderr: stderr.join(""),
    stdout: stdout.join(""),
    warnings: packageMessages,
  } satisfies PythonEvaluation;
}

function postWorkerResponse(response: PythonWorkerResponse) {
  globalThis.postMessage(response);
}

globalThis.addEventListener(
  "message",
  async (event: MessageEvent<PythonWorkerRequest>) => {
    const request = event.data;

    try {
      if (request.type === "initialize") {
        const { kernel } = await getKernel();
        postWorkerResponse({
          id: request.id,
          kernel,
          type: "ready",
        });
        return;
      }

      if (request.type === "resetPythonSession") {
        const { kernel, resetPythonSession } = await getKernel();
        resetPythonSession();
        postWorkerResponse({
          id: request.id,
          kernel,
          type: "pythonReset",
        });
        return;
      }

      const result = await evaluatePython(request.code);
      postWorkerResponse({
        id: request.id,
        result,
        type: "pythonResult",
      });
    } catch (error) {
      postWorkerResponse({
        error:
          error instanceof Error
            ? error.message
            : "Python kernel failed unexpectedly",
        id: request.id,
        type: "error",
      });
    }
  },
);
