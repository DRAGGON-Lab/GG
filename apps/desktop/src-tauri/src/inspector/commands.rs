use bioeng_data::database::inspector::{DatabaseOverview, QueryResult, TableRowsPage, TableSchema};
use bioeng_data::Database;
use tauri::State;

#[tauri::command]
pub fn database_inspector_overview(
    database: State<'_, Database>,
) -> Result<DatabaseOverview, String> {
    database.inspector_overview()
}

#[tauri::command]
pub fn database_inspector_table_schema(
    database: State<'_, Database>,
    table: String,
) -> Result<TableSchema, String> {
    database.inspector_table_schema(&table)
}

#[tauri::command]
pub fn database_inspector_table_rows(
    database: State<'_, Database>,
    table: String,
    limit: i64,
    offset: i64,
    order_by: Option<String>,
    descending: Option<bool>,
) -> Result<TableRowsPage, String> {
    database.inspector_table_rows(
        &table,
        limit,
        offset,
        order_by.as_deref(),
        descending.unwrap_or(false),
    )
}

#[tauri::command]
pub fn database_inspector_cell_update(
    database: State<'_, Database>,
    table: String,
    row_id: i64,
    column: String,
    value: serde_json::Value,
) -> Result<u64, String> {
    database.inspector_update_cell(&table, row_id, &column, value)
}

#[tauri::command]
pub fn database_inspector_rows_delete(
    database: State<'_, Database>,
    table: String,
    row_ids: Vec<i64>,
) -> Result<u64, String> {
    database.inspector_delete_rows(&table, &row_ids)
}

#[tauri::command]
pub fn database_inspector_query(
    database: State<'_, Database>,
    sql: String,
    allow_writes: bool,
    max_rows: Option<i64>,
) -> Result<QueryResult, String> {
    database.inspector_execute(&sql, allow_writes, max_rows)
}
