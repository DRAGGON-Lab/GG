import type { SbolPartRef } from "@/features/circuit/core/loica-model";
import { loadObjects } from "@/features/data/core/data-service";
import type { SbolObject } from "@/features/data/core/data-types";

const SBOL_COMPONENT_CLASS = "https://sbols.org/v3#Component";
const PAGE_SIZE = 1_000;

export type DesignComponentRole = "sensor" | "repressor" | "activator";
export type KineticsEvidence = "measured" | "reported" | "prior";

export type DesignLibraryComponent = {
  variantId: string;
  part: SbolPartRef;
  role: DesignComponentRole;
  regulator: string;
  family: string;
  organism: string;
  ymax: number | null;
  ymin: number | null;
  k: number | null;
  n: number | null;
  dynamicRange: number | null;
  source: string;
  kineticsEvidence: KineticsEvidence;
};

export type DesignLibraryInventory = {
  componentCount: number;
  eligiblePartCount: number;
  excludedPartCount: number;
  characterizedPartCount: number;
  priorPartCount: number;
};

export type SbolDesignLibrary = {
  components: DesignLibraryComponent[];
  inventory: DesignLibraryInventory;
};

/**
 * Build Quiver's mandatory part vocabulary from GG's configured SBOL store.
 * SBOL identity and functional role are required. Missing kinetic values are
 * left null so the Python runner can apply an explicit population prior.
 */
export async function loadSbolDesignLibrary(
  inducer: string,
): Promise<SbolDesignLibrary> {
  const objects = await loadAllComponents();
  if (objects.length === 0) {
    throw new Error(
      "No SBOL Components are available for design. Import a characterized or role-annotated part library in Data before running Quiver.",
    );
  }

  const components = objects.flatMap((object) =>
    componentVariants(object, inducer),
  );
  const eligibleIris = new Set(
    components.map((component) => component.part.iri),
  );
  const sensor = components.some(
    (component) =>
      component.role === "sensor" && sameToken(component.regulator, inducer),
  );
  if (!sensor) {
    throw new Error(
      `The SBOL database has no sensor Component for ${inducer}. Add a Component with a sensor role and regulator/inducer annotation before running Quiver.`,
    );
  }
  if (
    !components.some(
      (component) =>
        component.role === "repressor" || component.role === "activator",
    )
  ) {
    throw new Error(
      "The SBOL database has no promoter or regulatory gate Components eligible for Quiver design.",
    );
  }

  const evidenceByIri = new Map<string, KineticsEvidence>();
  for (const component of components) {
    const existing = evidenceByIri.get(component.part.iri);
    if (
      !existing ||
      evidenceRank(component.kineticsEvidence) > evidenceRank(existing)
    ) {
      evidenceByIri.set(component.part.iri, component.kineticsEvidence);
    }
  }
  const characterizedPartCount = [...evidenceByIri.values()].filter(
    (evidence) => evidence !== "prior",
  ).length;

  return {
    components,
    inventory: {
      characterizedPartCount,
      componentCount: objects.length,
      eligiblePartCount: eligibleIris.size,
      excludedPartCount: objects.length - eligibleIris.size,
      priorPartCount: eligibleIris.size - characterizedPartCount,
    },
  };
}

async function loadAllComponents(): Promise<SbolObject[]> {
  const objects: SbolObject[] = [];
  let after: string | null = null;
  do {
    const page = await loadObjects({
      after,
      limit: PAGE_SIZE,
      sbolClass: SBOL_COMPONENT_CLASS,
    });
    objects.push(...page.objects);
    after = page.nextCursor;
  } while (after);
  return objects;
}

function componentVariants(
  object: SbolObject,
  inducer: string,
): DesignLibraryComponent[] {
  const searchable = objectText(object);
  const roles = inferFunctionalRoles(object, searchable);
  if (roles.length === 0) {
    return [];
  }

  const ymax = numericAnnotation(object.data, ["ymax", "maximumexpression"]);
  const ymin = numericAnnotation(object.data, ["ymin", "minimumexpression"]);
  const dynamicRange = numericAnnotation(object.data, [
    "dynamicrange",
    "foldchange",
  ]);
  const k = numericAnnotation(object.data, [
    "k",
    "ec50",
    "halfmaximum",
    "dissociationconstant",
  ]);
  const n = numericAnnotation(object.data, [
    "n",
    "hillcoefficient",
    "cooperativity",
  ]);
  const reportedQuality = textAnnotation(object.data, [
    "kineticsquality",
    "quality",
  ]);
  const hasLevels =
    ymax !== null && ymin !== null && ymax > 0 && ymin >= 0 && ymax !== ymin;
  const kineticsEvidence = inferKineticsEvidence(
    reportedQuality,
    hasLevels,
    dynamicRange,
  );
  const annotatedRegulator = textAnnotation(object.data, [
    "regulator",
    "transcriptionfactor",
    "inducer",
    "ligand",
  ]);
  const family = textAnnotation(object.data, ["family"]) ?? "";
  const organism = textAnnotation(object.data, ["organism", "host"]) ?? "";

  return roles.map((role) => {
    const regulator =
      annotatedRegulator ??
      (role === "sensor" && containsToken(searchable, inducer)
        ? inducer
        : object.iri);
    return {
      dynamicRange:
        dynamicRange ??
        (hasLevels && ymin !== null && ymin > 0 && ymax !== null
          ? ymax / ymin
          : null),
      family,
      k,
      kineticsEvidence,
      n,
      organism,
      part: toPartRef(object),
      regulator,
      role,
      source: `gg-sbol-db:${object.graphId ?? object.iri}`,
      variantId: `${object.iri}#gg-quiver-${role}`,
      ymax: hasLevels ? ymax : null,
      ymin: hasLevels ? ymin : null,
    };
  });
}

function inferFunctionalRoles(
  object: SbolObject,
  searchable: string,
): DesignComponentRole[] {
  const explicit = textAnnotation(object.data, [
    "quiverrole",
    "functionalrole",
    "regulatoryrole",
    "componentrole",
  ])?.toLowerCase();
  if (explicit?.includes("sensor") || explicit?.includes("receiver")) {
    return ["sensor"];
  }
  if (explicit?.includes("repress") || explicit?.includes("inhibit")) {
    return ["repressor"];
  }
  if (explicit?.includes("activat") || explicit?.includes("stimulat")) {
    return ["activator"];
  }

  if (
    searchable.includes("sensor") ||
    searchable.includes("inducible") ||
    searchable.includes("receiver")
  ) {
    return ["sensor"];
  }
  if (
    searchable.includes("repressor") ||
    searchable.includes("repression") ||
    searchable.includes("inhibitor") ||
    searchable.includes("inverter")
  ) {
    return ["repressor"];
  }
  if (
    searchable.includes("activator") ||
    searchable.includes("activation") ||
    searchable.includes("stimulator")
  ) {
    return ["activator"];
  }

  const promoter =
    searchable.includes("promoter") || searchable.includes("0000167");
  // A promoter without regulatory-sign metadata remains usable under two
  // explicit functional hypotheses. Both carry prior kinetics, share one
  // physical identity, and Quiver's regulator mask prevents duplicate use.
  return promoter ? ["repressor", "activator"] : [];
}

function inferKineticsEvidence(
  quality: string | null,
  hasLevels: boolean,
  dynamicRange: number | null,
): KineticsEvidence {
  const normalized = quality?.toLowerCase() ?? "";
  if (
    hasLevels &&
    (normalized.includes("measur") || normalized.includes("fit"))
  ) {
    return "measured";
  }
  if (hasLevels || (dynamicRange !== null && dynamicRange > 0)) {
    return "reported";
  }
  return "prior";
}

function numericAnnotation(value: unknown, names: string[]): number | null {
  const candidate = annotation(value, new Set(names.map(normalizeKey)));
  const parsed =
    typeof candidate === "number"
      ? candidate
      : typeof candidate === "string"
        ? Number(candidate)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function textAnnotation(value: unknown, names: string[]): string | null {
  const candidate = annotation(value, new Set(names.map(normalizeKey)));
  if (typeof candidate === "string" && candidate.trim() !== "") {
    return candidate.trim();
  }
  return null;
}

function annotation(value: unknown, names: Set<string>): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = annotation(entry, names);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (names.has(normalizeKey(key))) {
      return scalarValue(entry);
    }
  }
  for (const entry of Object.values(value)) {
    const found = annotation(entry, names);
    if (found !== undefined) return found;
  }
  return undefined;
}

function scalarValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 0 ? scalarValue(value[0]) : undefined;
  }
  if (isRecord(value)) {
    for (const key of ["@value", "value", "@id", "id"]) {
      if (key in value) return scalarValue(value[key]);
    }
  }
  return value;
}

function objectText(object: SbolObject): string {
  return [
    object.displayId,
    object.name,
    object.description,
    object.iri,
    object.sbolClass,
    ...object.roles,
    ...object.types,
    ...primitiveStrings(object.data),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function primitiveStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(primitiveStrings);
  if (isRecord(value)) return Object.values(value).flatMap(primitiveStrings);
  return [];
}

function toPartRef(object: SbolObject): SbolPartRef {
  return {
    displayId: object.displayId,
    graphId: object.graphId,
    iri: object.iri,
    name: object.name,
    roleHint: "design component",
    roles: object.roles,
    sbolClass: object.sbolClass,
  };
}

function evidenceRank(evidence: KineticsEvidence): number {
  return evidence === "measured" ? 2 : evidence === "reported" ? 1 : 0;
}

function normalizeKey(value: string): string {
  const local = value.split(/[/#:]/).pop() ?? value;
  return local.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function containsToken(text: string, token: string): boolean {
  return text.includes(token.trim().toLowerCase());
}

function sameToken(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
