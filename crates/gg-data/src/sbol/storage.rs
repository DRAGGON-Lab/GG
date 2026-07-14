use std::{path::PathBuf, sync::Mutex};

use rusqlite::{params, Connection, OpenFlags};
use serde_json::Value;

/// Read-only SQLite access to the SBOL object index.
pub struct SbolObjectStorage {
    connection: Mutex<Connection>,
}

/// Filters and pagination for the SBOL object browser.
pub struct SbolObjectSearch<'a> {
    pub sbol_class: Option<&'a str>,
    pub role: Option<&'a str>,
    pub iri_query: Option<&'a str>,
    pub after_iri: Option<&'a str>,
    pub limit: u32,
}

/// A row from the SBOL object index, ready for the desktop wire DTO.
pub struct SbolObject {
    pub id: String,
    pub iri: String,
    pub sbol_class: String,
    pub display_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub graph_id: Option<String>,
    pub types: Vec<String>,
    pub roles: Vec<String>,
    pub data: Value,
}

impl SbolObjectStorage {
    /// Open the SBOL database after its schema has been created by `sbol-db`.
    pub fn open(db_path: PathBuf) -> Result<Self, String> {
        let connection = Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| error.to_string())?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn list(&self, search: SbolObjectSearch<'_>) -> Result<Vec<SbolObject>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SBOL object storage connection lock poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, iri, sbol_class, display_id, name, description,
                       graph_id, types, roles, data
                FROM sbol_objects
                WHERE is_deleted = 0
                  AND (?1 IS NULL OR sbol_class = ?1)
                  AND (?2 IS NULL OR EXISTS (SELECT 1 FROM json_each(roles) WHERE value = ?2))
                  AND (?3 IS NULL OR instr(lower(iri), lower(?3)) > 0)
                  AND (?4 IS NULL OR iri > ?4)
                ORDER BY iri ASC
                LIMIT ?5
                "#,
            )
            .map_err(|error| error.to_string())?;
        let objects = statement
            .query_map(
                params![
                    search.sbol_class,
                    search.role,
                    search.iri_query,
                    search.after_iri,
                    search.limit as i64,
                ],
                row_to_object,
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(objects)
    }
}

fn row_to_object(row: &rusqlite::Row<'_>) -> rusqlite::Result<SbolObject> {
    let types: String = row.get("types")?;
    let roles: String = row.get("roles")?;
    let data: String = row.get("data")?;
    Ok(SbolObject {
        id: row.get("id")?,
        iri: row.get("iri")?,
        sbol_class: row.get("sbol_class")?,
        display_id: row.get("display_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        graph_id: row.get("graph_id")?,
        types: serde_json::from_str(&types).map_err(json_error)?,
        roles: serde_json::from_str(&roles).map_err(json_error)?,
        data: serde_json::from_str(&data).map_err(json_error)?,
    })
}

fn json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_filters_iris_with_existing_object_filters() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("sbol.sqlite3");
        let connection = Connection::open(&path).expect("create test database");
        connection
            .execute_batch(
                r#"
                CREATE TABLE sbol_objects (
                    id TEXT NOT NULL,
                    iri TEXT NOT NULL,
                    sbol_class TEXT NOT NULL,
                    display_id TEXT,
                    name TEXT,
                    description TEXT,
                    graph_id TEXT,
                    types TEXT NOT NULL,
                    roles TEXT NOT NULL,
                    data TEXT NOT NULL,
                    is_deleted INTEGER NOT NULL DEFAULT 0
                );
                "#,
            )
            .expect("create SBOL objects table");
        connection
            .execute(
                r#"
                INSERT INTO sbol_objects
                    (id, iri, sbol_class, types, roles, data, is_deleted)
                VALUES
                    ('1', 'https://example.org/GFP_promoter', 'Component', '["Component"]', '["promoter"]', '{}', 0),
                    ('2', 'https://example.org/GFP_cds', 'Component', '["Component"]', '["coding"]', '{}', 0),
                    ('3', 'https://example.org/deleted_GFP', 'Component', '["Component"]', '["promoter"]', '{}', 1)
                "#,
                [],
            )
            .expect("insert SBOL objects");
        drop(connection);

        let storage = SbolObjectStorage::open(path).expect("open object storage");
        let objects = storage
            .list(SbolObjectSearch {
                sbol_class: Some("Component"),
                role: Some("promoter"),
                iri_query: Some("gfp"),
                after_iri: None,
                limit: 100,
            })
            .expect("search objects");

        assert_eq!(objects.len(), 1);
        assert_eq!(objects[0].iri, "https://example.org/GFP_promoter");
    }
}
