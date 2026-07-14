//! The SBOL data store for the Data tab: the SQLite-backed SBOL store, a
//! dedicated read-only SQL console, schema introspection, and the SPARQL engine
//! over the store's triple source. All clones share the underlying pools.

use std::path::Path;
use std::str::FromStr;

use gg_data::sbol::SbolObjectStorage;
use sbol_db_sparql::SparqlEngine;
use sbol_db_sqlite::{connect_and_migrate, SqliteSqlConsole, SqliteStats, SqliteStore};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;

/// Everything the Data tab's commands read from. Cheap to clone; held as Tauri
/// managed state.
pub struct DataStore {
    pub store: SqliteStore,
    pub objects: SbolObjectStorage,
    /// SQL console bound to a read-only connection so ad-hoc SQL can never
    /// mutate the corpus, regardless of the statement.
    pub sql_console: SqliteSqlConsole,
    pub stats: SqliteStats,
    pub sparql: SparqlEngine,
}

impl DataStore {
    /// Open (creating and migrating if needed) the SBOL database at `db_path`.
    pub async fn open(db_path: &Path) -> Result<Self, String> {
        let url = format!("sqlite://{}", db_path.display());

        let pool = connect_and_migrate(&url).await.map_err(|e| e.to_string())?;
        let store = SqliteStore::new(pool.clone());
        let objects = SbolObjectStorage::open(db_path.to_path_buf())?;
        let sparql = SparqlEngine::new(store.triple_source());
        let stats = SqliteStats::new(pool.clone());

        // A second connection opened read-only: SQLite refuses writes on it at
        // the engine level, so the SQL workbench is read-only by construction.
        let ro_options = SqliteConnectOptions::from_str(&url)
            .map_err(|e| e.to_string())?
            .read_only(true);
        let ro_pool = SqlitePool::connect_with(ro_options)
            .await
            .map_err(|e| e.to_string())?;
        let sql_console = SqliteSqlConsole::new(ro_pool);

        Ok(Self {
            store,
            objects,
            sql_console,
            stats,
            sparql,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use sbol_db_sparql::SparqlOptions;
    use sbol_db_storage::{DbStats, LabStore, SqlConsole, SqlExecuteRequest};

    fn sql(query: &str) -> SqlExecuteRequest {
        SqlExecuteRequest {
            query: query.to_string(),
            timeout_ms: 5_000,
            row_limit: 100,
        }
    }

    #[tokio::test]
    async fn open_migrates_and_serves_reads() {
        let dir = tempfile::tempdir().unwrap();
        let store = DataStore::open(&dir.path().join("sbol.sqlite3"))
            .await
            .expect("open");

        // Migrations ran: the core tables exist.
        let schema = store.stats.schema_overview().await.unwrap();
        assert!(schema.tables.iter().any(|t| t.name == "sbol_objects"));

        // A fresh store reports an empty corpus.
        let counts = store.store.corpus_counts().await.unwrap();
        assert_eq!(counts.objects, 0);
        assert_eq!(counts.graphs, 0);

        // The SQL console reads,
        let read = store
            .sql_console
            .execute(sql("SELECT 1 AS one"))
            .await
            .unwrap();
        assert_eq!(read.row_count, 1);

        // a SPARQL query against the empty store succeeds,
        store
            .sparql
            .execute(
                "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1",
                None,
                &SparqlOptions::default(),
            )
            .await
            .expect("sparql");
    }

    #[tokio::test]
    async fn sql_console_is_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let store = DataStore::open(&dir.path().join("sbol.sqlite3"))
            .await
            .expect("open");

        // Writes through the console are refused at the connection level.
        assert!(store
            .sql_console
            .execute(sql("CREATE TABLE scratch (x INTEGER)"))
            .await
            .is_err());
    }
}
