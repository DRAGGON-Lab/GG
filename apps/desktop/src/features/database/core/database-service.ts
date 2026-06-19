import { invoke } from "@tauri-apps/api/core";

import type {
  DatabaseOverview,
  QueryHistoryEntry,
  QueryResult,
  TableRowsPage,
  TableSchema,
} from "@/features/database/types";

const QUERY_HISTORY_STORAGE_KEY = "bioeng.database.query-history";
const QUERY_HISTORY_LIMIT = 50;

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function desktopOnlyError() {
  return Promise.reject(
    new Error("The database inspector is only available in the desktop app."),
  );
}

export function loadDatabaseOverview() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<DatabaseOverview>("database_inspector_overview");
}

export function loadTableSchema(table: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<TableSchema>("database_inspector_table_schema", { table });
}

export function loadTableRows(options: {
  descending?: boolean;
  limit: number;
  offset: number;
  orderBy?: string | null;
  table: string;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<TableRowsPage>("database_inspector_table_rows", {
    descending: options.descending ?? false,
    limit: options.limit,
    offset: options.offset,
    orderBy: options.orderBy ?? null,
    table: options.table,
  });
}

export function updateTableCell(options: {
  column: string;
  rowId: number;
  table: string;
  value: string | number | null;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<number>("database_inspector_cell_update", {
    column: options.column,
    rowId: options.rowId,
    table: options.table,
    value: options.value,
  });
}

export function deleteTableRows(options: { rowIds: number[]; table: string }) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<number>("database_inspector_rows_delete", {
    rowIds: options.rowIds,
    table: options.table,
  });
}

export function runDatabaseQuery(options: {
  allowWrites: boolean;
  maxRows?: number;
  sql: string;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }

  return invoke<QueryResult>("database_inspector_query", {
    allowWrites: options.allowWrites,
    maxRows: options.maxRows ?? null,
    sql: options.sql,
  });
}

export function readQueryHistory(): QueryHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(QUERY_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is QueryHistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as QueryHistoryEntry).sql === "string" &&
        typeof (entry as QueryHistoryEntry).ranAt === "number",
    );
  } catch {
    return [];
  }
}

export function appendQueryHistory(
  entry: QueryHistoryEntry,
): QueryHistoryEntry[] {
  const next = [
    entry,
    ...readQueryHistory().filter((existing) => existing.sql !== entry.sql),
  ].slice(0, QUERY_HISTORY_LIMIT);

  try {
    window.localStorage.setItem(
      QUERY_HISTORY_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // History persistence is best-effort.
  }

  return next;
}

export function clearQueryHistory(): QueryHistoryEntry[] {
  try {
    window.localStorage.removeItem(QUERY_HISTORY_STORAGE_KEY);
  } catch {
    // History persistence is best-effort.
  }

  return [];
}
