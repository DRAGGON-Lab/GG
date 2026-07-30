import { type GrnWireV1, parseGrnWire } from "@/features/circuit/core/grn-wire";
import {
  isOperator,
  type SbolPartRef,
} from "@/features/circuit/core/loica-model";
import type {
  DesignComponentRole,
  DesignLibraryInventory,
  KineticsEvidence,
} from "@/features/circuit/core/sbol-design-library";

export type DesignDirection = "any" | "up" | "down";

export type DesignRequest = {
  signal: string;
  ec50: number;
  dynamicRange: number;
  direction: DesignDirection;
  inducer: string;
  budget: number;
  threshold: number;
  seed: number;
};

export const DEFAULT_DESIGN_REQUEST: DesignRequest = {
  budget: 60,
  direction: "up",
  dynamicRange: 100,
  ec50: 1,
  inducer: "aTc",
  seed: 0,
  signal: "GFP",
  threshold: 0.5,
};

export type DesignComponentAssignment = {
  nodeId: string;
  part: SbolPartRef;
  role: DesignComponentRole;
  kineticsEvidence: KineticsEvidence;
  kineticsSource: string;
};

export type DesignCandidate = {
  id: string;
  rank: number;
  score: number;
  topologyId: string;
  structuralId: string;
  design: GrnWireV1;
  assignments: DesignComponentAssignment[];
  reportedOperators: number;
  priorOperators: number;
};

export type DesignPortfolio = {
  schemaVersion: 1;
  provider: "quiver";
  engine: {
    name: string;
    version: string;
    evidence: "computed";
  };
  library: DesignLibraryInventory & {
    source: "sbol-db";
  };
  target: DesignRequest;
  candidates: DesignCandidate[];
  elapsedMs: number | null;
  rejectedUngrounded: number;
};

export type DesignRunState =
  | "idle"
  | "preparing"
  | "running"
  | "complete"
  | "error";

export function parseDesignPortfolio(value: unknown): DesignPortfolio {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("The design service returned an unsupported result.");
  }
  if (value.provider !== "quiver") {
    throw new Error("The design service result is not from Quiver.");
  }
  if (!isRecord(value.engine)) {
    throw new Error("The design service result has no engine metadata.");
  }
  const evidence = value.engine.evidence;
  if (evidence !== "computed") {
    throw new Error("Quiver portfolios must be marked as computed evidence.");
  }
  if (!Array.isArray(value.candidates)) {
    throw new Error("The design service result has no candidate portfolio.");
  }
  const library = parseLibrary(value.library);
  const target = parseDesignRequest(value.target);
  const candidates = value.candidates.map((candidate, index) =>
    parseCandidate(candidate, index),
  );
  return {
    candidates,
    elapsedMs:
      value.elapsedMs === null ||
      (typeof value.elapsedMs === "number" && value.elapsedMs >= 0)
        ? value.elapsedMs
        : null,
    engine: {
      evidence,
      name:
        typeof value.engine.name === "string" ? value.engine.name : "quiver",
      version:
        typeof value.engine.version === "string"
          ? value.engine.version
          : "unknown",
    },
    library,
    provider: "quiver",
    rejectedUngrounded: nonNegativeInteger(value.rejectedUngrounded),
    schemaVersion: 1,
    target,
  };
}

export function normalizeDesignRequest(input: DesignRequest): DesignRequest {
  return {
    budget: Number.isFinite(input.budget)
      ? Math.max(8, Math.min(500, Math.round(input.budget)))
      : DEFAULT_DESIGN_REQUEST.budget,
    direction:
      input.direction === "down" || input.direction === "any"
        ? input.direction
        : "up",
    dynamicRange: finitePositive(input.dynamicRange, 100),
    ec50: finitePositive(input.ec50, 1),
    inducer: input.inducer.trim() || "aTc",
    seed: Number.isFinite(input.seed) ? Math.round(input.seed) : 0,
    signal: input.signal.trim() || "GFP",
    threshold: Number.isFinite(input.threshold)
      ? Math.max(0, Math.min(1, input.threshold))
      : DEFAULT_DESIGN_REQUEST.threshold,
  };
}

function parseDesignRequest(value: unknown): DesignRequest {
  if (!isRecord(value)) {
    throw new Error("The design service result has no target metadata.");
  }
  return normalizeDesignRequest({
    budget: numberValue(value.budget, DEFAULT_DESIGN_REQUEST.budget),
    direction:
      value.direction === "down" || value.direction === "any"
        ? value.direction
        : "up",
    dynamicRange: numberValue(
      value.dynamicRange,
      DEFAULT_DESIGN_REQUEST.dynamicRange,
    ),
    ec50: numberValue(value.ec50, DEFAULT_DESIGN_REQUEST.ec50),
    inducer:
      typeof value.inducer === "string"
        ? value.inducer
        : DEFAULT_DESIGN_REQUEST.inducer,
    seed: numberValue(value.seed, DEFAULT_DESIGN_REQUEST.seed),
    signal:
      typeof value.signal === "string"
        ? value.signal
        : DEFAULT_DESIGN_REQUEST.signal,
    threshold: numberValue(value.threshold, DEFAULT_DESIGN_REQUEST.threshold),
  });
}

function parseCandidate(value: unknown, index: number): DesignCandidate {
  if (!isRecord(value)) {
    throw new Error(`Design candidate ${index + 1} is invalid.`);
  }
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    throw new Error(`Design candidate ${index + 1} has no score.`);
  }
  const design = parseGrnWire(value.design);
  if (!Array.isArray(value.assignments)) {
    throw new Error(`Design candidate ${index + 1} has no SBOL assignments.`);
  }
  const assignments = value.assignments.map((assignment, assignmentIndex) =>
    parseAssignment(assignment, index, assignmentIndex),
  );
  const operatorIds = design.nodes
    .filter((node) => isOperator(node.kind))
    .map((node) => node.id);
  const assignedIds = new Set(
    assignments.map((assignment) => assignment.nodeId),
  );
  const operatorIdSet = new Set(operatorIds);
  const missing = operatorIds.filter((id) => !assignedIds.has(id));
  if (
    missing.length > 0 ||
    assignments.length !== operatorIds.length ||
    assignedIds.size !== assignments.length ||
    assignments.some((assignment) => !operatorIdSet.has(assignment.nodeId))
  ) {
    throw new Error(
      `Design candidate ${index + 1} is not fully grounded in SBOL Components.`,
    );
  }
  const reportedOperators = assignments.filter(
    (assignment) => assignment.kineticsEvidence !== "prior",
  ).length;
  return {
    assignments,
    design,
    id: typeof value.id === "string" ? value.id : `candidate-${index + 1}`,
    priorOperators: assignments.length - reportedOperators,
    reportedOperators,
    rank: positiveInteger(value.rank, index + 1),
    score: value.score,
    structuralId:
      typeof value.structuralId === "string"
        ? value.structuralId
        : `structural-${index + 1}`,
    topologyId:
      typeof value.topologyId === "string"
        ? value.topologyId
        : `topology-${index + 1}`,
  };
}

function parseLibrary(value: unknown): DesignPortfolio["library"] {
  if (!isRecord(value) || value.source !== "sbol-db") {
    throw new Error("The design result is not grounded in GG's SBOL database.");
  }
  return {
    characterizedPartCount: nonNegativeInteger(value.characterizedPartCount),
    componentCount: nonNegativeInteger(value.componentCount),
    eligiblePartCount: nonNegativeInteger(value.eligiblePartCount),
    excludedPartCount: nonNegativeInteger(value.excludedPartCount),
    priorPartCount: nonNegativeInteger(value.priorPartCount),
    source: "sbol-db",
  };
}

function parseAssignment(
  value: unknown,
  candidateIndex: number,
  assignmentIndex: number,
): DesignComponentAssignment {
  if (!isRecord(value) || !isRecord(value.part)) {
    throw new Error(
      `Design candidate ${candidateIndex + 1} assignment ${assignmentIndex + 1} is invalid.`,
    );
  }
  const { part } = value;
  if (
    typeof value.nodeId !== "string" ||
    typeof part.iri !== "string" ||
    typeof part.sbolClass !== "string" ||
    !Array.isArray(part.roles) ||
    !part.roles.every((role) => typeof role === "string")
  ) {
    throw new Error(
      `Design candidate ${candidateIndex + 1} has an invalid SBOL assignment.`,
    );
  }
  const role = value.role;
  if (role !== "sensor" && role !== "repressor" && role !== "activator") {
    throw new Error(
      "The design result contains an unsupported component role.",
    );
  }
  const kineticsEvidence = value.kineticsEvidence;
  if (
    kineticsEvidence !== "measured" &&
    kineticsEvidence !== "reported" &&
    kineticsEvidence !== "prior"
  ) {
    throw new Error("The design result has invalid kinetics provenance.");
  }
  return {
    kineticsEvidence,
    kineticsSource:
      typeof value.kineticsSource === "string"
        ? value.kineticsSource
        : "unknown",
    nodeId: value.nodeId,
    part: {
      displayId: typeof part.displayId === "string" ? part.displayId : null,
      graphId: typeof part.graphId === "string" ? part.graphId : null,
      iri: part.iri,
      name: typeof part.name === "string" ? part.name : null,
      roleHint:
        typeof part.roleHint === "string" ? part.roleHint : "design component",
      roles: part.roles,
      sbolClass: part.sbolClass,
    },
    role,
  };
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
