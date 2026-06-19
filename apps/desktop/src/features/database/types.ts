export type TableKind = "table" | "view" | "virtual" | "shadow" | "internal";

export type TableSummary = {
  name: string;
  kind: TableKind;
  rowCount: number | null;
  columnCount: number;
};

export type DatabaseOverview = {
  path: string;
  fileSizeBytes: number | null;
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  journalMode: string;
  foreignKeys: boolean;
  sqliteVersion: string;
  schemaVersion: number;
  tables: TableSummary[];
};

export type ColumnInfo = {
  name: string;
  dataType: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  hidden: boolean;
};

export type IndexInfo = {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
  ddl: string | null;
};

export type ForeignKeyInfo = {
  table: string;
  fromColumns: string[];
  toColumns: string[];
  onUpdate: string;
  onDelete: string;
};

export type TriggerInfo = {
  name: string;
  ddl: string | null;
};

export type TableSchema = {
  name: string;
  kind: TableKind;
  ddl: string | null;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  triggers: TriggerInfo[];
};

export type CellValue =
  | { type: "null" }
  | { type: "integer"; value: number }
  | { type: "real"; value: number }
  | { type: "text"; value: string; fullLength?: number }
  | { type: "blob"; length: number; preview: string };

export type QueryResult = {
  columns: string[];
  rows: CellValue[][];
  truncated: boolean;
  statementCount: number;
  rowsAffected: number;
  lastInsertRowid: number | null;
  durationMs: number;
};

export type TableRowsPage = {
  result: QueryResult;
  /// One rowid per row when the source supports rowid addressing (editing
  /// and deletion); null for views and WITHOUT ROWID tables.
  rowIds: number[] | null;
  totalRows: number;
  limit: number;
  offset: number;
};

export type QueryHistoryEntry = {
  durationMs: number;
  ok: boolean;
  ranAt: number;
  sql: string;
};

export type TableSort = {
  column: string;
  descending: boolean;
};
