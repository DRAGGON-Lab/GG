use rusqlite::{types::ValueRef, Batch, Connection};
use serde::Serialize;
use std::time::Instant;

use super::Database;

/// Text cells are capped so a single oversized value (e.g. a stored JSON
/// payload) cannot balloon the IPC response; the full length is reported so
/// the UI can label the truncation.
const MAX_TEXT_CELL_BYTES: usize = 8 * 1024;
const MAX_BLOB_PREVIEW_BYTES: usize = 64;
const MAX_QUERY_ROWS: usize = 10_000;
const DEFAULT_QUERY_ROWS: usize = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseOverview {
    pub path: String,
    pub file_size_bytes: Option<u64>,
    pub page_size: i64,
    pub page_count: i64,
    pub freelist_count: i64,
    pub journal_mode: String,
    pub foreign_keys: bool,
    pub sqlite_version: String,
    pub schema_version: i64,
    pub tables: Vec<TableSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub name: String,
    pub kind: TableKind,
    pub row_count: Option<i64>,
    pub column_count: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TableKind {
    Table,
    View,
    Virtual,
    Shadow,
    Internal,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSchema {
    pub name: String,
    pub kind: TableKind,
    pub ddl: Option<String>,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub triggers: Vec<TriggerInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    pub primary_key: bool,
    pub hidden: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    pub origin: String,
    pub partial: bool,
    pub columns: Vec<String>,
    pub ddl: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub table: String,
    pub from_columns: Vec<String>,
    pub to_columns: Vec<String>,
    pub on_update: String,
    pub on_delete: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub name: String,
    pub ddl: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum CellValue {
    Null,
    Integer {
        value: i64,
    },
    Real {
        value: f64,
    },
    #[serde(rename_all = "camelCase")]
    Text {
        value: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        full_length: Option<usize>,
    },
    Blob {
        length: usize,
        preview: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<CellValue>>,
    pub truncated: bool,
    pub statement_count: usize,
    pub rows_affected: u64,
    pub last_insert_rowid: Option<i64>,
    pub duration_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowsPage {
    pub result: QueryResult,
    /// One rowid per row when the source supports rowid addressing (editing
    /// and deletion); `None` for views and WITHOUT ROWID tables.
    pub row_ids: Option<Vec<i64>>,
    pub total_rows: i64,
    pub limit: i64,
    pub offset: i64,
}

impl Database {
    pub fn inspector_overview(&self) -> Result<DatabaseOverview, String> {
        let connection = self.connection()?;

        let path: String = connection
            .query_row(
                "SELECT file FROM pragma_database_list WHERE name = 'main'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let file_size_bytes = std::fs::metadata(&path).ok().map(|metadata| metadata.len());
        let page_size = pragma_i64(&connection, "page_size")?;
        let page_count = pragma_i64(&connection, "page_count")?;
        let freelist_count = pragma_i64(&connection, "freelist_count")?;
        let journal_mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        let foreign_keys = pragma_i64(&connection, "foreign_keys")? != 0;
        let schema_version: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let mut entries: Vec<(String, String, Option<String>)> = Vec::new();
        {
            let mut statement = connection
                .prepare(
                    "SELECT name, type, sql FROM sqlite_master \
                     WHERE type IN ('table', 'view') ORDER BY name",
                )
                .map_err(|error| error.to_string())?;
            let mut rows = statement.query([]).map_err(|error| error.to_string())?;
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                entries.push((
                    row.get(0).map_err(|error| error.to_string())?,
                    row.get(1).map_err(|error| error.to_string())?,
                    row.get(2).map_err(|error| error.to_string())?,
                ));
            }
        }

        let virtual_tables: Vec<String> = entries
            .iter()
            .filter(|(_, _, sql)| is_virtual_table_sql(sql.as_deref()))
            .map(|(name, _, _)| name.clone())
            .collect();

        let mut tables = Vec::with_capacity(entries.len());
        for (name, entry_type, sql) in entries {
            let kind = classify_table(&name, &entry_type, sql.as_deref(), &virtual_tables);
            let row_count = if kind == TableKind::View {
                None
            } else {
                connection
                    .query_row(
                        &format!("SELECT COUNT(*) FROM {}", quote_identifier(&name)),
                        [],
                        |row| row.get(0),
                    )
                    .ok()
            };
            let column_count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_xinfo(?1)",
                    [&name],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            tables.push(TableSummary {
                name,
                kind,
                row_count,
                column_count,
            });
        }

        Ok(DatabaseOverview {
            path,
            file_size_bytes,
            page_size,
            page_count,
            freelist_count,
            journal_mode,
            foreign_keys,
            sqlite_version: rusqlite::version().to_string(),
            schema_version,
            tables,
        })
    }

    pub fn inspector_table_schema(&self, table: &str) -> Result<TableSchema, String> {
        let connection = self.connection()?;

        let (entry_type, ddl): (String, Option<String>) = connection
            .query_row(
                "SELECT type, sql FROM sqlite_master WHERE name = ?1 AND type IN ('table', 'view')",
                [table],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| format!("no table or view named {table:?}"))?;
        let kind = if entry_type == "view" {
            TableKind::View
        } else if is_virtual_table_sql(ddl.as_deref()) {
            TableKind::Virtual
        } else if table.starts_with("sqlite_") {
            TableKind::Internal
        } else {
            TableKind::Table
        };

        let mut columns = Vec::new();
        {
            let mut statement = connection
                .prepare(
                    "SELECT name, type, \"notnull\", dflt_value, pk, hidden \
                     FROM pragma_table_xinfo(?1)",
                )
                .map_err(|error| error.to_string())?;
            let mut rows = statement
                .query([table])
                .map_err(|error| error.to_string())?;
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                columns.push(ColumnInfo {
                    name: row.get(0).map_err(|error| error.to_string())?,
                    data_type: row.get(1).map_err(|error| error.to_string())?,
                    not_null: row.get::<_, i64>(2).map_err(|error| error.to_string())? != 0,
                    default_value: row.get(3).map_err(|error| error.to_string())?,
                    primary_key: row.get::<_, i64>(4).map_err(|error| error.to_string())? != 0,
                    hidden: row.get::<_, i64>(5).map_err(|error| error.to_string())? != 0,
                });
            }
        }

        let mut indexes = Vec::new();
        {
            let mut statement = connection
                .prepare(
                    "SELECT name, \"unique\", origin, partial \
                     FROM pragma_index_list(?1) ORDER BY seq",
                )
                .map_err(|error| error.to_string())?;
            let mut rows = statement
                .query([table])
                .map_err(|error| error.to_string())?;
            let mut index_headers = Vec::new();
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                index_headers.push((
                    row.get::<_, String>(0).map_err(|error| error.to_string())?,
                    row.get::<_, i64>(1).map_err(|error| error.to_string())? != 0,
                    row.get::<_, String>(2).map_err(|error| error.to_string())?,
                    row.get::<_, i64>(3).map_err(|error| error.to_string())? != 0,
                ));
            }
            drop(rows);
            drop(statement);

            for (name, unique, origin, partial) in index_headers {
                let mut index_columns = Vec::new();
                let mut column_statement = connection
                    .prepare("SELECT name FROM pragma_index_info(?1) ORDER BY seqno")
                    .map_err(|error| error.to_string())?;
                let mut column_rows = column_statement
                    .query([&name])
                    .map_err(|error| error.to_string())?;
                while let Some(row) = column_rows.next().map_err(|error| error.to_string())? {
                    let column: Option<String> = row.get(0).map_err(|error| error.to_string())?;
                    index_columns.push(column.unwrap_or_else(|| "<expression>".to_string()));
                }
                drop(column_rows);
                drop(column_statement);

                let ddl: Option<String> = connection
                    .query_row(
                        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
                        [&name],
                        |row| row.get(0),
                    )
                    .unwrap_or(None);

                indexes.push(IndexInfo {
                    name,
                    unique,
                    origin,
                    partial,
                    columns: index_columns,
                    ddl,
                });
            }
        }

        let mut foreign_keys: Vec<ForeignKeyInfo> = Vec::new();
        {
            let mut statement = connection
                .prepare(
                    "SELECT id, \"table\", \"from\", \"to\", on_update, on_delete \
                     FROM pragma_foreign_key_list(?1) ORDER BY id, seq",
                )
                .map_err(|error| error.to_string())?;
            let mut rows = statement
                .query([table])
                .map_err(|error| error.to_string())?;
            let mut last_id: Option<i64> = None;
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                let id: i64 = row.get(0).map_err(|error| error.to_string())?;
                let from_column: String = row.get(2).map_err(|error| error.to_string())?;
                let to_column: Option<String> = row.get(3).map_err(|error| error.to_string())?;

                if last_id == Some(id) {
                    if let Some(foreign_key) = foreign_keys.last_mut() {
                        foreign_key.from_columns.push(from_column);
                        if let Some(to_column) = to_column {
                            foreign_key.to_columns.push(to_column);
                        }
                    }
                } else {
                    foreign_keys.push(ForeignKeyInfo {
                        table: row.get(1).map_err(|error| error.to_string())?,
                        from_columns: vec![from_column],
                        to_columns: to_column.into_iter().collect(),
                        on_update: row.get(4).map_err(|error| error.to_string())?,
                        on_delete: row.get(5).map_err(|error| error.to_string())?,
                    });
                    last_id = Some(id);
                }
            }
        }

        let mut triggers = Vec::new();
        {
            let mut statement = connection
                .prepare(
                    "SELECT name, sql FROM sqlite_master \
                     WHERE type = 'trigger' AND tbl_name = ?1 ORDER BY name",
                )
                .map_err(|error| error.to_string())?;
            let mut rows = statement
                .query([table])
                .map_err(|error| error.to_string())?;
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                triggers.push(TriggerInfo {
                    name: row.get(0).map_err(|error| error.to_string())?,
                    ddl: row.get(1).map_err(|error| error.to_string())?,
                });
            }
        }

        Ok(TableSchema {
            name: table.to_string(),
            kind,
            ddl,
            columns,
            indexes,
            foreign_keys,
            triggers,
        })
    }

    pub fn inspector_table_rows(
        &self,
        table: &str,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        descending: bool,
    ) -> Result<TableRowsPage, String> {
        let connection = self.connection()?;

        connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE name = ?1 AND type IN ('table', 'view')",
                [table],
                |_| Ok(()),
            )
            .map_err(|_| format!("no table or view named {table:?}"))?;

        if let Some(order_column) = order_by {
            let column_exists: bool = connection
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_xinfo(?1) WHERE name = ?2",
                    [table, order_column],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?
                != 0;
            if !column_exists {
                return Err(format!("no column named {order_column:?} on {table:?}"));
            }
        }

        let limit = limit.clamp(1, MAX_QUERY_ROWS as i64);
        let offset = offset.max(0);
        let total_rows: i64 = connection
            .query_row(
                &format!("SELECT COUNT(*) FROM {}", quote_identifier(table)),
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;

        let order_clause = order_by
            .map(|column| {
                format!(
                    " ORDER BY {} {}",
                    quote_identifier(column),
                    if descending { "DESC" } else { "ASC" }
                )
            })
            .unwrap_or_default();

        // Rows are addressed by rowid so the UI can edit and delete them.
        // Views, WITHOUT ROWID tables, and tables that shadow the name with
        // their own `rowid` column fall back to a read-only page. The rowid
        // probe below is not enough to exclude views on its own: SQLite builds
        // with SQLITE_ALLOW_ROWID_IN_VIEW (e.g. Debian/Ubuntu) let it succeed.
        let is_table: bool = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1 AND type = 'table'",
                [table],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?
            != 0;
        let has_own_rowid_column: bool = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_xinfo(?1) WHERE lower(name) = 'rowid'",
                [table],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?
            != 0;
        let started = Instant::now();
        let rowid_sql = format!(
            "SELECT rowid AS __cg_rowid, * FROM {}{} LIMIT {} OFFSET {}",
            quote_identifier(table),
            order_clause,
            limit,
            offset
        );
        let mut statement = if !is_table || has_own_rowid_column {
            None
        } else {
            connection.prepare(&rowid_sql).ok()
        };
        let mut row_ids = statement.is_some().then(Vec::new);

        let mut statement = match statement.take() {
            Some(statement) => statement,
            None => {
                let sql = format!(
                    "SELECT * FROM {}{} LIMIT {} OFFSET {}",
                    quote_identifier(table),
                    order_clause,
                    limit,
                    offset
                );
                connection
                    .prepare(&sql)
                    .map_err(|error| error.to_string())?
            }
        };

        let mut columns: Vec<String> = statement
            .column_names()
            .into_iter()
            .map(str::to_string)
            .collect();
        let (mut rows, truncated) = collect_rows(&mut statement, limit as usize)?;

        if let Some(row_ids) = row_ids.as_mut() {
            columns.remove(0);
            for row in &mut rows {
                match row.remove(0) {
                    CellValue::Integer { value } => row_ids.push(value),
                    _ => return Err("rowid column returned a non-integer value".to_string()),
                }
            }
        }

        Ok(TableRowsPage {
            result: QueryResult {
                columns,
                rows,
                truncated,
                statement_count: 1,
                rows_affected: 0,
                last_insert_rowid: None,
                duration_ms: started.elapsed().as_secs_f64() * 1000.0,
            },
            row_ids,
            total_rows,
            limit,
            offset,
        })
    }

    pub fn inspector_update_cell(
        &self,
        table: &str,
        row_id: i64,
        column: &str,
        value: serde_json::Value,
    ) -> Result<u64, String> {
        let connection = self.connection()?;
        ensure_table_exists(&connection, table)?;
        ensure_column_exists(&connection, table, column)?;

        let sql = format!(
            "UPDATE {} SET {} = ?1 WHERE rowid = ?2",
            quote_identifier(table),
            quote_identifier(column)
        );
        let value = json_to_sql_value(value)?;
        let changes = connection
            .execute(&sql, rusqlite::params![value, row_id])
            .map_err(|error| error.to_string())?;

        if changes == 0 {
            return Err("no row with that rowid; the table may have changed".to_string());
        }

        Ok(changes as u64)
    }

    pub fn inspector_delete_rows(&self, table: &str, row_ids: &[i64]) -> Result<u64, String> {
        if row_ids.is_empty() {
            return Ok(0);
        }

        let mut connection = self.connection()?;
        ensure_table_exists(&connection, table)?;

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let mut deleted = 0u64;

        // Chunked to stay well under SQLite's bound-parameter limit.
        for chunk in row_ids.chunks(500) {
            let placeholders = (1..=chunk.len())
                .map(|index| format!("?{index}"))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "DELETE FROM {} WHERE rowid IN ({})",
                quote_identifier(table),
                placeholders
            );
            deleted += transaction
                .execute(&sql, rusqlite::params_from_iter(chunk.iter()))
                .map_err(|error| error.to_string())? as u64;
        }

        transaction.commit().map_err(|error| error.to_string())?;
        Ok(deleted)
    }

    /// Runs one or more SQL statements. Statements that would modify the
    /// database are rejected (via `sqlite3_stmt_readonly`) unless
    /// `allow_writes` is set. The rows of the last statement that produced a
    /// result set are returned. Explicit transactions are not supported: the
    /// connection is shared with the rest of the app, so anything left open
    /// is rolled back and reported as an error.
    pub fn inspector_execute(
        &self,
        sql: &str,
        allow_writes: bool,
        max_rows: Option<i64>,
    ) -> Result<QueryResult, String> {
        let max_rows = max_rows
            .map(|value| value.clamp(1, MAX_QUERY_ROWS as i64) as usize)
            .unwrap_or(DEFAULT_QUERY_ROWS);
        let connection = self.connection()?;
        let started = Instant::now();

        let result = execute_script(&connection, sql, allow_writes, max_rows);

        if !connection.is_autocommit() {
            let _ = connection.execute_batch("ROLLBACK");
            return Err(
                "explicit transactions are not supported here; the statement was rolled back"
                    .to_string(),
            );
        }

        let (columns, rows, truncated, statement_count, rows_affected, wrote) = result?;
        Ok(QueryResult {
            columns,
            rows,
            truncated,
            statement_count,
            rows_affected,
            last_insert_rowid: wrote.then(|| connection.last_insert_rowid()),
            duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }
}

type ScriptOutcome = (Vec<String>, Vec<Vec<CellValue>>, bool, usize, u64, bool);

fn execute_script(
    connection: &Connection,
    sql: &str,
    allow_writes: bool,
    max_rows: usize,
) -> Result<ScriptOutcome, String> {
    let mut batch = Batch::new(connection, sql);
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<CellValue>> = Vec::new();
    let mut truncated = false;
    let mut statement_count = 0usize;
    let mut rows_affected = 0u64;
    let mut wrote = false;

    while let Some(mut statement) = batch.next().map_err(|error| error.to_string())? {
        statement_count += 1;

        if !statement.readonly() {
            if !allow_writes {
                return Err(
                    "this statement modifies the database; enable write mode to run it".to_string(),
                );
            }
            wrote = true;
        }

        if statement.column_count() > 0 {
            columns = statement
                .column_names()
                .into_iter()
                .map(str::to_string)
                .collect();
            let readonly = statement.readonly();
            let (statement_rows, statement_truncated) = collect_rows(&mut statement, max_rows)?;
            rows = statement_rows;
            truncated = statement_truncated;
            if !readonly {
                rows_affected += connection.changes();
            }
        } else {
            rows_affected += statement.execute([]).map_err(|error| error.to_string())? as u64;
        }
    }

    if statement_count == 0 {
        return Err("no SQL statement to run".to_string());
    }

    Ok((
        columns,
        rows,
        truncated,
        statement_count,
        rows_affected,
        wrote,
    ))
}

fn collect_rows(
    statement: &mut rusqlite::Statement<'_>,
    max_rows: usize,
) -> Result<(Vec<Vec<CellValue>>, bool), String> {
    let column_count = statement.column_count();
    let mut collected: Vec<Vec<CellValue>> = Vec::new();
    let mut truncated = false;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;

    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        if collected.len() >= max_rows {
            truncated = true;
            break;
        }

        let mut cells = Vec::with_capacity(column_count);
        for index in 0..column_count {
            let value = row.get_ref(index).map_err(|error| error.to_string())?;
            cells.push(cell_value(value));
        }
        collected.push(cells);
    }

    Ok((collected, truncated))
}

fn cell_value(value: ValueRef<'_>) -> CellValue {
    match value {
        ValueRef::Null => CellValue::Null,
        ValueRef::Integer(value) => CellValue::Integer { value },
        ValueRef::Real(value) => CellValue::Real { value },
        ValueRef::Text(bytes) => {
            let text = String::from_utf8_lossy(bytes);
            if text.len() > MAX_TEXT_CELL_BYTES {
                let mut boundary = MAX_TEXT_CELL_BYTES;
                while boundary > 0 && !text.is_char_boundary(boundary) {
                    boundary -= 1;
                }
                CellValue::Text {
                    value: text[..boundary].to_string(),
                    full_length: Some(text.chars().count()),
                }
            } else {
                CellValue::Text {
                    value: text.into_owned(),
                    full_length: None,
                }
            }
        }
        ValueRef::Blob(bytes) => CellValue::Blob {
            length: bytes.len(),
            preview: bytes
                .iter()
                .take(MAX_BLOB_PREVIEW_BYTES)
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(" "),
        },
    }
}

fn ensure_table_exists(connection: &Connection, table: &str) -> Result<(), String> {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE name = ?1 AND type = 'table'",
            [table],
            |_| Ok(()),
        )
        .map_err(|_| format!("no table named {table:?}"))
}

fn ensure_column_exists(connection: &Connection, table: &str, column: &str) -> Result<(), String> {
    let column_exists: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_xinfo(?1) WHERE name = ?2",
            [table, column],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        != 0;

    if column_exists {
        Ok(())
    } else {
        Err(format!("no column named {column:?} on {table:?}"))
    }
}

fn json_to_sql_value(value: serde_json::Value) -> Result<rusqlite::types::Value, String> {
    use rusqlite::types::Value;

    Ok(match value {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(value) => Value::Integer(value as i64),
        serde_json::Value::Number(number) => {
            if let Some(value) = number.as_i64() {
                Value::Integer(value)
            } else if let Some(value) = number.as_f64() {
                Value::Real(value)
            } else {
                return Err("unsupported numeric value".to_string());
            }
        }
        serde_json::Value::String(value) => Value::Text(value),
        other => Value::Text(other.to_string()),
    })
}

fn pragma_i64(connection: &Connection, pragma: &str) -> Result<i64, String> {
    connection
        .pragma_query_value(None, pragma, |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn is_virtual_table_sql(sql: Option<&str>) -> bool {
    sql.map(|sql| {
        sql.trim_start()
            .to_ascii_uppercase()
            .starts_with("CREATE VIRTUAL TABLE")
    })
    .unwrap_or(false)
}

const FTS_SHADOW_SUFFIXES: &[&str] = &[
    "config", "content", "data", "docsize", "idx", "segdir", "segments", "stat",
];

fn classify_table(
    name: &str,
    entry_type: &str,
    sql: Option<&str>,
    virtual_tables: &[String],
) -> TableKind {
    if entry_type == "view" {
        return TableKind::View;
    }
    if is_virtual_table_sql(sql) {
        return TableKind::Virtual;
    }
    if name.starts_with("sqlite_") {
        return TableKind::Internal;
    }
    let is_shadow = virtual_tables.iter().any(|virtual_table| {
        name.strip_prefix(virtual_table.as_str())
            .and_then(|rest| rest.strip_prefix('_'))
            .is_some_and(|suffix| FTS_SHADOW_SUFFIXES.contains(&suffix))
    });
    if is_shadow {
        return TableKind::Shadow;
    }
    TableKind::Table
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, fs, process,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_database(name: &str) -> Database {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = env::temp_dir().join(format!(
            "gg-data-inspector-{name}-{}-{timestamp}.sqlite3",
            process::id()
        ));
        let _ = fs::remove_file(&path);
        Database::open(path).expect("test database should open")
    }

    #[test]
    fn overview_lists_known_tables() {
        let database = test_database("overview");
        let overview = database.inspector_overview().expect("overview should load");

        assert!(overview.schema_version > 0);
        assert!(overview.page_size > 0);
        let settings = overview
            .tables
            .iter()
            .find(|table| table.name == "settings")
            .expect("settings table should be listed");
        assert!(matches!(settings.kind, TableKind::Table));
        let fts = overview
            .tables
            .iter()
            .find(|table| table.name == "ai_memory_conclusions_fts")
            .expect("FTS table should be listed");
        assert!(matches!(fts.kind, TableKind::Virtual));
        let shadow = overview
            .tables
            .iter()
            .find(|table| table.name == "ai_memory_conclusions_fts_data")
            .expect("FTS shadow table should be listed");
        assert!(matches!(shadow.kind, TableKind::Shadow));
    }

    #[test]
    fn table_schema_reports_columns_and_foreign_keys() {
        let database = test_database("schema");
        let schema = database
            .inspector_table_schema("ai_context_attachments")
            .expect("schema should load");

        assert!(schema
            .columns
            .iter()
            .any(|column| column.name == "conversation_id"));
        assert!(!schema.foreign_keys.is_empty());
        assert!(schema.ddl.is_some());
    }

    #[test]
    fn read_only_mode_rejects_writes() {
        let database = test_database("read-only");
        let error = database
            .inspector_execute("DELETE FROM settings", false, None)
            .expect_err("write should be rejected");
        assert!(error.contains("write mode"));

        database
            .inspector_execute("SELECT * FROM schema_migrations", false, None)
            .expect("read should succeed");
    }

    #[test]
    fn write_mode_applies_changes_and_reports_counts() {
        let database = test_database("write");
        let result = database
            .inspector_execute(
                "INSERT INTO settings (key, value) VALUES ('inspector-test', '1');\n\
                 UPDATE settings SET value = '2' WHERE key = 'inspector-test';",
                true,
                None,
            )
            .expect("write script should run");
        assert_eq!(result.statement_count, 2);
        assert_eq!(result.rows_affected, 2);

        let check = database
            .inspector_execute(
                "SELECT value FROM settings WHERE key = 'inspector-test'",
                false,
                None,
            )
            .expect("read-back should succeed");
        assert_eq!(check.rows.len(), 1);
        assert!(matches!(
            &check.rows[0][0],
            CellValue::Text { value, .. } if value == "2"
        ));
    }

    #[test]
    fn open_transactions_are_rolled_back() {
        let database = test_database("transaction");
        let error = database
            .inspector_execute(
                "BEGIN; INSERT INTO settings (key, value) VALUES ('tx-test', '1');",
                true,
                None,
            )
            .expect_err("open transaction should be rejected");
        assert!(error.contains("rolled back"));

        let check = database
            .inspector_execute("SELECT * FROM settings WHERE key = 'tx-test'", false, None)
            .expect("read should succeed");
        assert!(check.rows.is_empty());
    }

    #[test]
    fn table_rows_expose_rowids_and_support_editing() {
        let database = test_database("editing");
        database
            .inspector_execute(
                "INSERT INTO settings (key, value) VALUES ('edit-a', '1'), ('edit-b', '2')",
                true,
                None,
            )
            .expect("seed should run");

        let page = database
            .inspector_table_rows("settings", 10, 0, Some("key"), false)
            .expect("rows should load");
        let row_ids = page.row_ids.expect("settings should be rowid-addressable");
        assert_eq!(row_ids.len(), page.result.rows.len());

        let value_column = page
            .result
            .columns
            .iter()
            .position(|column| column == "value")
            .expect("value column should exist");

        let changes = database
            .inspector_update_cell(
                "settings",
                row_ids[0],
                "value",
                serde_json::Value::String("updated".to_string()),
            )
            .expect("cell update should succeed");
        assert_eq!(changes, 1);

        let reloaded = database
            .inspector_table_rows("settings", 10, 0, Some("key"), false)
            .expect("rows should reload");
        assert!(matches!(
            &reloaded.result.rows[0][value_column],
            CellValue::Text { value, .. } if value == "updated"
        ));

        let constraint = database
            .inspector_update_cell("settings", row_ids[0], "value", serde_json::Value::Null)
            .expect_err("NOT NULL constraint should propagate");
        assert!(constraint.contains("NOT NULL"));

        database
            .inspector_execute(
                "CREATE TABLE inspector_scratch (id INTEGER PRIMARY KEY, note TEXT);\n\
                 INSERT INTO inspector_scratch (note) VALUES ('keep');",
                true,
                None,
            )
            .expect("scratch table should be created");
        let scratch = database
            .inspector_table_rows("inspector_scratch", 10, 0, None, false)
            .expect("scratch rows should load");
        let scratch_row_ids = scratch
            .row_ids
            .expect("scratch should be rowid-addressable");
        database
            .inspector_update_cell(
                "inspector_scratch",
                scratch_row_ids[0],
                "note",
                serde_json::Value::Null,
            )
            .expect("NULL update should succeed on a nullable column");
        let nulled = database
            .inspector_table_rows("inspector_scratch", 10, 0, None, false)
            .expect("scratch rows should reload");
        assert!(matches!(&nulled.result.rows[0][1], CellValue::Null));

        let deleted = database
            .inspector_delete_rows("settings", &row_ids)
            .expect("delete should succeed");
        assert_eq!(deleted, row_ids.len() as u64);
        let emptied = database
            .inspector_table_rows("settings", 10, 0, None, false)
            .expect("rows should reload");
        assert_eq!(emptied.total_rows, 0);

        let missing = database
            .inspector_update_cell(
                "settings",
                row_ids[0],
                "value",
                serde_json::Value::String("x".to_string()),
            )
            .expect_err("updating a deleted row should fail");
        assert!(missing.contains("no row"));
    }

    #[test]
    fn views_are_not_rowid_addressable() {
        let database = test_database("view-rows");
        database
            .inspector_execute(
                "CREATE VIEW settings_view AS SELECT key, value FROM settings",
                true,
                None,
            )
            .expect("view creation should run");

        let page = database
            .inspector_table_rows("settings_view", 10, 0, None, false)
            .expect("view rows should load");
        assert!(page.row_ids.is_none());

        let error = database
            .inspector_delete_rows("settings_view", &[1])
            .expect_err("deleting from a view should fail");
        assert!(error.contains("no table"));
    }

    #[test]
    fn table_rows_paginate_and_sort() {
        let database = test_database("rows");
        database
            .inspector_execute(
                "INSERT INTO settings (key, value) VALUES ('a', '1'), ('b', '2'), ('c', '3')",
                true,
                None,
            )
            .expect("seed should run");

        let page = database
            .inspector_table_rows("settings", 2, 0, Some("key"), true)
            .expect("rows should load");
        assert_eq!(page.total_rows, 3);
        assert_eq!(page.result.rows.len(), 2);
        assert!(matches!(
            &page.result.rows[0][0],
            CellValue::Text { value, .. } if value == "c"
        ));

        let error = database
            .inspector_table_rows("settings", 2, 0, Some("nope"), false)
            .expect_err("unknown order column should be rejected");
        assert!(error.contains("no column"));
    }
}
