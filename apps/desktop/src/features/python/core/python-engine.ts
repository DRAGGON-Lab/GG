import type {
  PythonEvaluation,
  PythonKernelInfo,
  PythonWorkerResponse,
} from "@/features/python/core/python.types";

type PendingWorkerRequest = {
  reject: (reason?: unknown) => void;
  resolve: (value: PythonKernelInfo | PythonEvaluation) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
};

type PythonWorkerClientRequest =
  | {
      type: "initialize";
    }
  | {
      code: string;
      type: "evaluatePython";
    }
  | {
      type: "resetPythonSession";
    };

const pendingRequests = new Map<number, PendingWorkerRequest>();

const PYTHON_REQUEST_TIMEOUT_MS = 15_000;

let pythonKernelWarmupPromise: Promise<PythonKernelInfo> | undefined;
let pythonWorker: Worker | undefined;
let nextRequestId = 1;

function getPythonWorker() {
  if (pythonWorker) {
    return pythonWorker;
  }

  pythonWorker = new Worker(
    new URL("./pyodide-python.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );

  pythonWorker.addEventListener("message", handleWorkerMessage);
  pythonWorker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Python worker failed");
    resetPythonWorker(error);
  });

  return pythonWorker;
}

function handleWorkerMessage(event: MessageEvent<PythonWorkerResponse>) {
  const response = event.data;
  const pendingRequest = pendingRequests.get(response.id);

  if (!pendingRequest) {
    return;
  }

  if (pendingRequest.timeoutId) {
    clearTimeout(pendingRequest.timeoutId);
  }

  pendingRequests.delete(response.id);

  if (response.type === "error") {
    pendingRequest.reject(new Error(response.error));
    return;
  }

  if (response.type === "ready") {
    pendingRequest.resolve(response.kernel);
    return;
  }

  if (response.type === "pythonReset") {
    pendingRequest.resolve(response.kernel);
    return;
  }

  pendingRequest.resolve(response.result);
}

function rejectPendingRequests(error: Error) {
  for (const pendingRequest of pendingRequests.values()) {
    if (pendingRequest.timeoutId) {
      clearTimeout(pendingRequest.timeoutId);
    }

    pendingRequest.reject(error);
  }

  pendingRequests.clear();
}

function resetPythonWorker(
  error: Error,
  options: { prewarmNextWorker?: boolean } = {},
) {
  rejectPendingRequests(error);
  pythonWorker?.terminate();
  pythonKernelWarmupPromise = undefined;
  pythonWorker = undefined;

  if (options.prewarmNextWorker) {
    void warmPythonKernel().catch(() => undefined);
  }
}

function postWorkerRequest(
  request: PythonWorkerClientRequest,
  timeoutMs?: number,
): Promise<PythonKernelInfo | PythonEvaluation> {
  const id = nextRequestId;
  nextRequestId += 1;

  return new Promise((resolve, reject) => {
    const pendingRequest: PendingWorkerRequest = { reject, resolve };

    if (timeoutMs !== undefined) {
      pendingRequest.timeoutId = setTimeout(() => {
        if (!pendingRequests.has(id)) {
          return;
        }

        resetPythonWorker(
          new Error(
            `Python request exceeded ${Math.round(
              timeoutMs / 1000,
            )} seconds; the local Python kernel was restarted.`,
          ),
          { prewarmNextWorker: true },
        );
      }, timeoutMs);
    }

    pendingRequests.set(id, pendingRequest);

    try {
      getPythonWorker().postMessage({ ...request, id });
    } catch (error) {
      pendingRequests.delete(id);

      if (pendingRequest.timeoutId) {
        clearTimeout(pendingRequest.timeoutId);
      }

      reject(error);
    }
  });
}

export function warmPythonKernel() {
  pythonKernelWarmupPromise ??= postWorkerRequest({
    type: "initialize",
  })
    .then((kernel) => kernel as PythonKernelInfo)
    .catch((error: unknown) => {
      pythonKernelWarmupPromise = undefined;
      throw error;
    });

  return pythonKernelWarmupPromise;
}

export async function evaluatePythonCode(code: string) {
  return (await postWorkerRequest(
    {
      code,
      type: "evaluatePython",
    },
    PYTHON_REQUEST_TIMEOUT_MS,
  )) as PythonEvaluation;
}

export async function resetPythonSession() {
  return (await postWorkerRequest({
    type: "resetPythonSession",
  })) as PythonKernelInfo;
}
