//! Wire types for the Flapjack tab — the camelCase shapes returned by the
//! `flapjack_*` Tauri commands (see `src-tauri/src/flapjack/dto.rs`).

export type Study = {
  id: number;
  name: string;
  description: string;
  public: boolean;
};

export type Assay = {
  id: number;
  studyId: number;
  name: string;
  machine: string;
  description: string;
  temperature: number;
  sampleCount: number;
};

export type Signal = {
  id: number;
  name: string;
  description: string;
  color: string;
  kind: string | null;
};

export type SampleSupplement = {
  chemical: string;
  concentration: number;
};

export type Sample = {
  id: number;
  assayId: number;
  row: number;
  col: number;
  media: string | null;
  strain: string | null;
  vector: string | null;
  supplements: SampleSupplement[];
};

export type Measurement = {
  id: number;
  sampleId: number;
  signalId: number;
  signal: string;
  value: number;
  time: number;
};

export type Characterization = {
  id: number;
  analysisType: string;
  name: string;
  paramsHash: string;
  spec: unknown;
};

export type CharacterizationDatum = {
  id: number;
  characterizationId: number;
  sampleId: number;
  signalId: number;
  metric: string;
  value: number;
  time: number | null;
  concentration: number | null;
  concentration2: number | null;
};

export type Counts = {
  studies: number;
  assays: number;
  samples: number;
  signals: number;
  measurements: number;
  characterizations: number;
};

export type Overview = {
  counts: Counts;
  recentStudies: Study[];
};

export type StudyDetail = {
  study: Study;
  assays: Assay[];
};

export type CharacterizationDetail = {
  characterization: Characterization;
  data: CharacterizationDatum[];
};

export type SqlColumn = { name: string; columnType: string };

export type SqlResult = {
  columns: SqlColumn[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

export type Validate = {
  ok: boolean;
  message?: string;
  line: number;
  column: number;
};

export type SchemaColumn = {
  name: string;
  columnType: string;
  nullable: boolean;
};
export type SchemaTable = { name: string; columns: SchemaColumn[] };
export type Schema = { tables: SchemaTable[] };

// --- Import manifest (must match ImportStudyInput in dto.rs) ---------------

/// MIME type a circuit simulation emits its experiment manifest under, via the
/// display protocol. Diverted from the visible output and imported into the
/// store on demand.
export const FLAPJACK_MANIFEST_MIME = "application/vnd.bioeng.flapjack+json";

/// MIME type the analysis runner emits a computed characterization under, via
/// the display protocol, for the frontend to render and persist.
export const FLAPJACK_CHARACTERIZATION_MIME =
  "application/vnd.bioeng.flapjack-characterization+json";

export type SignalManifest = {
  name: string;
  kind?: string | null;
  color?: string;
  description?: string;
};

export type SupplementManifest = { chemical: string; concentration: number };

export type SampleManifest = {
  row: number;
  col: number;
  media?: string | null;
  strain?: string | null;
  vector?: string | null;
  supplements?: SupplementManifest[];
};

export type MeasurementManifest = {
  sampleIndex: number;
  signal: string;
  value: number;
  time: number;
};

export type ExperimentManifest = {
  study: { name: string; description?: string };
  assay: {
    name: string;
    machine?: string;
    description?: string;
    temperature?: number;
  };
  signals: SignalManifest[];
  samples: SampleManifest[];
  measurements: MeasurementManifest[];
};

export type ImportStudyReport = {
  studyId: number;
  assayId: number;
  sampleCount: number;
  measurementCount: number;
  signalCount: number;
};

// --- Saving a characterization (must match SaveCharacterizationInput) -------

export type CharacterizationDatumInput = {
  sampleId: number;
  signalId: number;
  metric: string;
  value: number;
  time?: number | null;
  concentration?: number | null;
  concentration2?: number | null;
};

export type SaveCharacterizationInput = {
  analysisType: string;
  name?: string;
  paramsHash?: string;
  spec?: unknown;
  data: CharacterizationDatumInput[];
};
