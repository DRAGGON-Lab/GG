import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import {
  type CircuitDocument,
  type CircuitEdge,
  type CircuitNode,
  DEFAULT_SIMULATION,
  defaultParams,
  emptyDocument,
  exampleDocument,
  NODE_SPECS,
  type NodeKind,
  type ParamValue,
  type SbolPartRef,
  type SimulationConfig,
} from "@/features/circuit/core/loica-model";

const STORAGE_KEY_DOC = "gg.circuit.document";
const STORAGE_KEY_PATH = "gg.circuit.path";
const STORAGE_KEY_SEEDED = "gg.circuit.seeded";

export const CIRCUIT_FILE_EXTENSION = "circuit";

/// Serialize a document to the on-disk `.circuit` JSON (pretty-printed so it
/// diffs cleanly under the workspace history).
export function serializeDocument(document: CircuitDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/// Parse and defensively validate a `.circuit` JSON payload. Unknown fields are
/// dropped and missing ones defaulted, so a hand-edited or older file still
/// loads instead of throwing.
export function parseDocument(json: string): CircuitDocument {
  const raw = JSON.parse(json) as unknown;
  if (!raw || typeof raw !== "object") {
    return emptyDocument();
  }
  const value = raw as Record<string, unknown>;
  return {
    edges: parseEdges(value.edges),
    nodes: parseNodes(value.nodes),
    simulation: parseSimulation(value.simulation),
    version: 1,
  };
}

function parseNodes(value: unknown): CircuitNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const nodes: CircuitNode[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind !== "string" || !(kind in NODE_SPECS)) {
      continue;
    }
    const id = typeof record.id === "string" ? record.id : null;
    if (!id) {
      continue;
    }
    const position = record.position as
      | { x?: unknown; y?: unknown }
      | undefined;
    const nodeKind = kind as NodeKind;
    const node: CircuitNode = {
      id,
      kind: nodeKind,
      name: typeof record.name === "string" ? record.name : kind,
      params: { ...defaultParams(nodeKind), ...parseParams(record.params) },
      position: {
        x: typeof position?.x === "number" ? position.x : 0,
        y: typeof position?.y === "number" ? position.y : 0,
      },
    };
    const sbolParts = parseSbolParts(record.sbolParts);
    if (sbolParts.length > 0) {
      node.sbolParts = sbolParts;
    }
    if (typeof record.inputCount === "number") {
      node.inputCount = Math.max(1, Math.round(record.inputCount));
    }
    nodes.push(node);
  }
  return nodes;
}

function parseParams(value: unknown): Record<string, ParamValue> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const params: Record<string, ParamValue> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof raw === "number" ||
      typeof raw === "string" ||
      isNumberArray(raw) ||
      isNumberMatrix(raw)
    ) {
      params[key] = raw as ParamValue;
    }
  }
  return params;
}

function parseSbolParts(value: unknown): SbolPartRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parts: SbolPartRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.iri !== "string" || record.iri.trim() === "") {
      continue;
    }
    const roles = Array.isArray(record.roles)
      ? record.roles.filter((role): role is string => typeof role === "string")
      : [];
    parts.push({
      displayId:
        typeof record.displayId === "string" ? record.displayId : undefined,
      graphId: typeof record.graphId === "string" ? record.graphId : undefined,
      iri: record.iri,
      name: typeof record.name === "string" ? record.name : undefined,
      roleHint:
        typeof record.roleHint === "string" ? record.roleHint : undefined,
      roles,
      sbolClass:
        typeof record.sbolClass === "string" ? record.sbolClass : "SBOL",
    });
  }
  return parts;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "number")
  );
}

function isNumberMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every(isNumberArray);
}

function parseEdges(value: unknown): CircuitEdge[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const edges: CircuitEdge[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const source = record.source;
    const target = record.target;
    if (typeof source !== "string" || typeof target !== "string") {
      continue;
    }
    edges.push({
      id:
        typeof record.id === "string"
          ? record.id
          : `${source}:${target}:${edges.length}`,
      source,
      sourceHandle:
        typeof record.sourceHandle === "string" ? record.sourceHandle : "out",
      target,
      targetHandle:
        typeof record.targetHandle === "string" ? record.targetHandle : "in",
    });
  }
  return edges;
}

function parseSimulation(value: unknown): SimulationConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SIMULATION };
  }
  const record = value as Record<string, unknown>;
  const num = (key: keyof SimulationConfig, fallback: number) =>
    typeof record[key] === "number" ? (record[key] as number) : fallback;
  const method = record.method === "ssa" ? "ssa" : DEFAULT_SIMULATION.method;
  const biomass = isNumberArray(record.biomass)
    ? record.biomass
    : DEFAULT_SIMULATION.biomass;
  return {
    biomass: [
      biomass[0] ?? DEFAULT_SIMULATION.biomass[0],
      biomass[1] ?? DEFAULT_SIMULATION.biomass[1],
      biomass[2] ?? DEFAULT_SIMULATION.biomass[2],
      biomass[3] ?? DEFAULT_SIMULATION.biomass[3],
    ],
    doseMax: num("doseMax", DEFAULT_SIMULATION.doseMax),
    doseMin: num("doseMin", DEFAULT_SIMULATION.doseMin),
    dosePoints: Math.max(
      1,
      Math.round(num("dosePoints", DEFAULT_SIMULATION.dosePoints)),
    ),
    interval: num("interval", DEFAULT_SIMULATION.interval),
    method,
    nMeasurements: Math.max(
      1,
      Math.round(num("nMeasurements", DEFAULT_SIMULATION.nMeasurements)),
    ),
    nsr: Math.max(0, num("nsr", DEFAULT_SIMULATION.nsr)),
  };
}

export async function loadCircuitFile(path: string): Promise<CircuitDocument> {
  const text = await readTextFile(path);
  return parseDocument(text);
}

export async function saveCircuitFile(
  path: string,
  document: CircuitDocument,
): Promise<void> {
  await writeTextFile(path, serializeDocument(document));
}

// --- Session persistence (survives reload even without an on-disk file) ---

/// The document to open on load: the user's saved circuit when it has content,
/// otherwise the example template on first launch. A one-time "seeded" marker
/// makes a deliberately-emptied board (via New) persist across reloads instead
/// of reverting to the example — the template only fills a never-used canvas.
export function loadInitialDocument(): CircuitDocument {
  const stored = loadStoredDocument();
  const seeded = window.localStorage.getItem(STORAGE_KEY_SEEDED) === "1";
  window.localStorage.setItem(STORAGE_KEY_SEEDED, "1");

  if (stored && (stored.nodes.length > 0 || seeded)) {
    return stored;
  }
  return exampleDocument();
}

export function loadStoredDocument(): CircuitDocument | null {
  const stored = window.localStorage.getItem(STORAGE_KEY_DOC);
  if (!stored) {
    return null;
  }
  try {
    return parseDocument(stored);
  } catch {
    return null;
  }
}

export function storeDocument(document: CircuitDocument): void {
  window.localStorage.setItem(STORAGE_KEY_DOC, serializeDocument(document));
}

export function loadStoredPath(): string | null {
  return window.localStorage.getItem(STORAGE_KEY_PATH);
}

export function storePath(path: string | null): void {
  if (path) {
    window.localStorage.setItem(STORAGE_KEY_PATH, path);
  } else {
    window.localStorage.removeItem(STORAGE_KEY_PATH);
  }
}
