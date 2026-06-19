import type { PythonEvaluation } from "@/features/python/core/python.types";

export type PythonEntryStatus = "evaluating" | "failed" | "ready";

export type PythonEntry = {
  code: string;
  error?: string;
  evaluation?: PythonEvaluation;
  id: number;
  status: PythonEntryStatus;
};
