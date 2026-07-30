import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "@/features/circuit/core/circuit-run";
import { toGrnWire } from "@/features/circuit/core/grn-wire";
import type { CircuitDocument } from "@/features/circuit/core/loica-model";
import {
  parseCertificateReport,
  type StructuralValidationResult,
} from "@/features/circuit/core/validation-types";

export type GrnAnalyzerStatus = {
  available: boolean;
  source: "bundled" | "development" | "environment" | null;
};

export async function getGrnAnalyzerStatus(): Promise<GrnAnalyzerStatus> {
  if (!isTauriRuntime()) {
    return { available: false, source: null };
  }
  return invoke<GrnAnalyzerStatus>("grn_analyzer_status");
}

export async function runGrnLeanValidation(
  document: CircuitDocument,
): Promise<StructuralValidationResult> {
  if (!isTauriRuntime()) {
    throw new Error("grn-lean validation is available in the GG desktop app.");
  }
  const started = performance.now();
  const raw = await invoke<unknown>("grn_analyze", {
    design: JSON.stringify(toGrnWire(document)),
  });
  const status = await getGrnAnalyzerStatus();
  return {
    elapsedMs: Math.round(performance.now() - started),
    engine: "grn-lean",
    evidence: "kernel-checked",
    report: parseCertificateReport(raw),
    source: status.source ?? "runtime",
  };
}
