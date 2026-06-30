import { invoke } from "@tauri-apps/api/core";

import type {
  BatchSequenceMatch,
  ExportFormat,
  Graph,
  GraphList,
  GraphTriples,
  ImportReport,
  ObjectList,
  Overview,
  SbolObject,
  Schema,
  SequenceMatch,
  SparqlResult,
  SqlResult,
  Validate,
} from "@/features/data/core/data-types";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function desktopOnlyError() {
  return Promise.reject(
    new Error("The Data tab is only available in the desktop app."),
  );
}

export function loadOverview() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<Overview>("data_overview");
}

export function loadGraphs(options: {
  kind?: string | null;
  limit?: number;
  offset?: number;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<GraphList>("data_graphs_list", {
    kind: options.kind ?? null,
    limit: options.limit ?? null,
    offset: options.offset ?? null,
  });
}

export function loadGraph(id: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<Graph>("data_graph_get", { id });
}

export function loadGraphTriples(options: {
  id: string;
  limit?: number;
  offset?: number;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<GraphTriples>("data_graph_triples", {
    id: options.id,
    limit: options.limit ?? null,
    offset: options.offset ?? null,
  });
}

export function loadObjects(options: {
  after?: string | null;
  graphId?: string | null;
  limit?: number;
  role?: string | null;
  sbolClass?: string | null;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<ObjectList>("data_objects_list", {
    after: options.after ?? null,
    graphId: options.graphId ?? null,
    limit: options.limit ?? null,
    role: options.role ?? null,
    sbolClass: options.sbolClass ?? null,
  });
}

export function loadObject(iri: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<SbolObject>("data_object_get", { iri });
}

export function exportObject(iri: string, format: ExportFormat) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<string>("data_object_export", { format, iri });
}

export function searchSequence(options: {
  forwardOnly?: boolean;
  maxHits?: number;
  pattern: string;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<SequenceMatch[]>("data_sequence_search", {
    forwardOnly: options.forwardOnly ?? null,
    maxHits: options.maxHits ?? null,
    pattern: options.pattern,
  });
}

export function searchSequenceBatch(options: {
  forwardOnly?: boolean;
  maxHits?: number;
  patterns: string[];
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<BatchSequenceMatch[]>("data_sequence_search_batch", {
    forwardOnly: options.forwardOnly ?? null,
    maxHits: options.maxHits ?? null,
    patterns: options.patterns,
  });
}

export function executeSparql(query: string, format?: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<SparqlResult>("data_sparql_execute", {
    format: format ?? null,
    query,
  });
}

export function validateSparql(query: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<Validate>("data_sparql_validate", { query });
}

export function executeSql(options: {
  query: string;
  rowLimit?: number;
  timeoutMs?: number;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<SqlResult>("data_sql_execute", {
    query: options.query,
    rowLimit: options.rowLimit ?? null,
    timeoutMs: options.timeoutMs ?? null,
  });
}

export function validateSql(query: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<Validate>("data_sql_validate", { query });
}

export function loadSqlSchema() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<Schema>("data_schema_sql");
}

export function importDocument(options: {
  body: string;
  description?: string | null;
  format: string;
  name?: string | null;
  sourceUri?: string | null;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<ImportReport>("data_import", {
    body: options.body,
    description: options.description ?? null,
    format: options.format,
    name: options.name ?? null,
    sourceUri: options.sourceUri ?? null,
  });
}
