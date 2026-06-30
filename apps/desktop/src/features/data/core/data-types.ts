/// TypeScript mirrors of the camelCase DTOs returned by the `data_*` Tauri
/// commands (see apps/desktop/src-tauri/src/data/dto.rs).

export type Counts = {
  objects: number;
  graphs: number;
  triples: number;
  sequences: number;
  validationRuns: number;
  ontologies: number;
};

export type Graph = {
  id: string;
  iri: string;
  kind: string;
  name: string | null;
  sourceUri: string | null;
  serializationFormat: string | null;
  createdAt: string;
  objectCount: number;
  tripleCount: number;
};

export type ClassCount = {
  iri: string;
  count: number;
};

export type Overview = {
  counts: Counts;
  recentGraphs: Graph[];
  topClasses: ClassCount[];
};

export type GraphList = {
  total: number;
  limit: number;
  offset: number;
  graphs: Graph[];
};

export type Term = {
  type: "uri" | "bnode" | "literal";
  value: string;
  datatype?: string;
  language?: string;
};

export type TripleRow = {
  subject: Term;
  predicate: Term;
  object: Term;
};

export type GraphTriples = {
  total: number;
  limit: number;
  offset: number;
  triples: TripleRow[];
};

export type SbolObject = {
  id: string;
  iri: string;
  sbolClass: string;
  displayId: string | null;
  name: string | null;
  description: string | null;
  graphId: string | null;
  types: string[];
  roles: string[];
  data: unknown;
};

export type ObjectList = {
  objects: SbolObject[];
  nextCursor: string | null;
};

export type SequenceMatch = {
  sequenceIri: string;
  start: number;
  length: number;
  strand: string;
};

export type BatchSequenceMatch = {
  pattern: string;
  matches: SequenceMatch[];
};

export type SqlColumn = {
  name: string;
  columnType: string;
};

export type SqlResult = {
  columns: SqlColumn[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

export type SparqlResult = {
  contentType: string;
  body: unknown;
  elapsedMs: number;
  truncated: boolean;
};

export type SchemaColumn = {
  name: string;
  columnType: string;
  nullable: boolean;
};

export type SchemaTable = {
  name: string;
  columns: SchemaColumn[];
};

export type Schema = {
  tables: SchemaTable[];
};

export type Validate = {
  ok: boolean;
  message?: string;
  line: number;
  column: number;
};

export type ImportReport = {
  graphId: string;
  objectCount: number;
  tripleCount: number;
  validationStatus: string;
  validationIssueCount: number;
};

/// The subset of the SPARQL-results+JSON shape the workbench renders.
export type SparqlBindingValue = {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
};

export type SparqlJsonResults = {
  head: { vars?: string[] };
  results?: { bindings: Record<string, SparqlBindingValue>[] };
  boolean?: boolean;
};

export type ExportFormat = "turtle" | "jsonld" | "ntriples" | "rdfxml";
