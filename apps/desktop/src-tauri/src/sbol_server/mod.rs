//! An sbol-db HTTP server bound to loopback, over the same `sbol.sqlite3` the
//! Data tab reads. It gives locally-run Python — the circuit's LOICA scripts —
//! access to the SBOL corpus through the `sbol-db` client library, hitting the
//! same REST surface the sbol-db CLI serves.
//!
//! The server opens its own connection pool against the database file. SQLite's
//! WAL mode makes that safe alongside the Data tab's pool: reads run
//! concurrently and the single writer serializes, so a graph imported through
//! either path is immediately visible to the other.

pub mod commands;

use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;

use sbol_db_backend::Backend;
use sbol_db_jobs::{default_registry, Worker, WorkerConfig};
use sbol_db_server::{router, AppState, Metrics, SchemaCache, ServerConfig};
use sbol_db_sparql::{SparqlEngine, SparqlUpdateEngine};
use tokio_util::sync::CancellationToken;

/// The running server's loopback base URL, held as Tauri managed state so the
/// frontend can hand it to the Python runtime.
pub struct SbolServer {
    pub base_url: String,
}

/// Open the SBOL database, mount the sbol-db router, and serve it on an
/// ephemeral loopback port. Also starts the embedded job worker so
/// job-backed endpoints (bulk and remote imports) complete. Returns once the
/// listener is bound; the server and worker run on the shared async runtime for
/// the lifetime of the process.
pub async fn start(sbol_db_path: &Path) -> Result<SbolServer, String> {
    let url = format!("sqlite://{}", sbol_db_path.display());
    let backend = Backend::open(&url).await.map_err(|e| e.to_string())?;

    let sparql = Arc::new(SparqlEngine::new(backend.triple_source.clone()));
    let sparql_update = Arc::new(SparqlUpdateEngine::new(
        backend.triple_source.clone(),
        backend.triple_writer.clone(),
    ));
    let metrics =
        Metrics::install(None, env!("CARGO_PKG_VERSION")).with_jobs_repo(backend.jobs.clone());

    let config = ServerConfig::default();
    let state = AppState {
        service: backend.store.clone(),
        sparql,
        sparql_update,
        metrics,
        jobs: backend.jobs.clone(),
        lab: backend.lab.clone(),
        config: config.clone(),
        backend_kind: backend.kind,
        sql_console: backend.sql_console.clone(),
        db_stats: backend.db_stats.clone(),
        lsm_stats: backend.lsm_stats.clone(),
        schema_cache: Arc::new(SchemaCache::new()),
    };
    let app = router(state, config);

    // The embedded worker reuses the API's already-open store and job queue;
    // SQLite needs no dedicated worker pool. It runs for the whole process, so
    // its cancellation token is never fired.
    let worker = Worker::new(
        backend.jobs.clone(),
        backend.store.clone(),
        None,
        Arc::new(default_registry()),
        WorkerConfig::default(),
    );
    tauri::async_runtime::spawn(async move {
        if let Err(error) = worker.run(CancellationToken::new()).await {
            eprintln!("embedded sbol-db worker exited: {error}");
        }
    });

    let bind = SocketAddr::from((Ipv4Addr::LOCALHOST, 0));
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let base_url = format!("http://{addr}");

    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            eprintln!("sbol-db server stopped: {error}");
        }
    });

    Ok(SbolServer { base_url })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The embedded server boots against a fresh SQLite file and answers its
    /// operational probes over the loopback port — the same surface the
    /// `sbol-db` Python client talks to.
    #[tokio::test]
    async fn serves_health_probes_over_loopback() {
        let dir = tempfile::tempdir().unwrap();
        let server = start(&dir.path().join("sbol.sqlite3"))
            .await
            .expect("server starts");

        assert!(server.base_url.starts_with("http://127.0.0.1:"));

        let client = reqwest::Client::new();
        let health = client
            .get(format!("{}/healthz", server.base_url))
            .send()
            .await
            .expect("healthz reachable");
        assert!(health.status().is_success());
        assert_eq!(health.text().await.unwrap().trim(), "ok");

        let ready = client
            .get(format!("{}/readyz", server.base_url))
            .send()
            .await
            .expect("readyz reachable")
            .text()
            .await
            .unwrap();
        assert!(ready.contains("ready"), "readyz body = {ready}");
    }
}
