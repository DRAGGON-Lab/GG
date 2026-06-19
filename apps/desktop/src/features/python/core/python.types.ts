export type PythonKernelInfo = {
  offline: boolean;
  runtime: "Pyodide";
  runtimeVersion: string;
};

export type PythonResultValue = {
  copyValue?: string;
  repr: string;
  text: string;
  typeName: string;
};

export type PythonEvaluation = {
  code: string;
  elapsedMs: number;
  error?: string;
  kernel: PythonKernelInfo;
  loadedPackages: string[];
  result?: PythonResultValue;
  stderr: string;
  stdout: string;
  warnings: string[];
};

export type PythonWorkerRequest =
  | {
      id: number;
      type: "initialize";
    }
  | {
      code: string;
      id: number;
      type: "evaluatePython";
    }
  | {
      id: number;
      type: "resetPythonSession";
    };

export type PythonWorkerResponse =
  | {
      id: number;
      kernel: PythonKernelInfo;
      type: "ready";
    }
  | {
      id: number;
      kernel: PythonKernelInfo;
      type: "pythonReset";
    }
  | {
      id: number;
      result: PythonEvaluation;
      type: "pythonResult";
    }
  | {
      error: string;
      id: number;
      type: "error";
    };
