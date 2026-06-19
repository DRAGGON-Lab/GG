import { invoke } from "@tauri-apps/api/core";

export type AiMemoryKind =
  | "background"
  | "goal"
  | "preference"
  | "project"
  | "struggle"
  | "convention";

export type AiMemoryStatus = "active" | "invalidated";

export type AiMemoryConclusion = {
  id: string;
  kind: AiMemoryKind;
  content: string;
  confidence: number;
  status: AiMemoryStatus;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiMemoryUpdateInput = {
  content?: string;
  kind?: AiMemoryKind;
  confidence?: number;
};

export const AI_MEMORY_KIND_LABELS: ReadonlyArray<{
  kind: AiMemoryKind;
  label: string;
}> = [
  { kind: "background", label: "Background" },
  { kind: "goal", label: "Goals" },
  { kind: "preference", label: "Preferences" },
  { kind: "project", label: "Projects" },
  { kind: "struggle", label: "Struggles" },
  { kind: "convention", label: "Conventions" },
];

export function listAiMemory() {
  return invoke<AiMemoryConclusion[]>("ai_memory_list");
}

export function updateAiMemory(id: string, input: AiMemoryUpdateInput) {
  return invoke<AiMemoryConclusion | null>("ai_memory_update", { id, input });
}

export function setAiMemoryStatus(id: string, status: AiMemoryStatus) {
  return invoke<boolean>("ai_memory_set_status", { id, status });
}

export function deleteAiMemory(id: string) {
  return invoke<boolean>("ai_memory_delete", { id });
}
