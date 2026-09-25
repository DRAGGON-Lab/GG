//! The SBOL data store for the Data tab: the SQLite-backed SBOL store, a
//! dedicated read-only SQL console, schema introspection, and the SPARQL engine
//! over the store's triple source. All clones share the underlying pools.

use std::path::Path;
use std::str::FromStr;

use sbol_db_sparql::SparqlEngine;
use sbol_db_sqlite::{connect_and_migrate, SqliteSqlConsole, SqliteStats, SqliteStore};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;

/// Everything the Data tab's commands read from. Cheap to clone; held as Tauri
/// managed state.
pub struct DataStore {
    pub store: SqliteStore,
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
            sql_console,
            stats,
            sparql,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use sbol_db_core::{GraphId, SerializationFormat};
    use sbol_db_sparql::SparqlOptions;
    use sbol_db_storage::{
        DbStats, ImportInput, ImportOverwrite, LabStore, ListObjectsFilter, ObjectStore,
        SqlConsole, SqlExecuteRequest,
    };

    const SYNBIOHUB_SBOL2_RDF_XML: &str = r#"<?xml version="1.0" ?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:sbh="http://wiki.synbiohub.org/wiki/Terms/synbiohub#"
         xmlns:sbol="http://sbols.org/v2#"
         xmlns:dcterms="http://purl.org/dc/terms/"
         xmlns:ns0="http://purl.obolibrary.org/obo/"
         xmlns:ns1="https://wiki.synbiohub.org/wiki/Terms/synbiohub#">
  <sbol:ComponentDefinition rdf:about="https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR/1">
    <sbol:persistentIdentity rdf:resource="https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR"/>
    <sbol:displayId>R0063_pLuxR_pR</sbol:displayId>
    <sbol:version>1</sbol:version>
    <dcterms:title>R0063_pLuxR-pR</dcterms:title>
    <dcterms:description>MoClo Basic Part: Controllable promoter - pLuxR(pR)</dcterms:description>
    <ns0:OBI_0001617>26479688</ns0:OBI_0001617>
    <sbh:ownedBy rdf:resource="https://synbiohub.org/user/Gon"/>
    <sbh:topLevel rdf:resource="https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR/1"/>
    <ns1:sourceOrganism rdf:resource="http://purl.obolibrary.org/obo/NCBITaxon_562"/>
    <sbol:type rdf:resource="http://www.biopax.org/release/biopax-level3.owl#DnaRegion"/>
    <sbol:role rdf:resource="http://identifiers.org/so/SO:0000167"/>
    <sbol:sequence rdf:resource="https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR_sequence/1"/>
  </sbol:ComponentDefinition>
  <sbol:Sequence rdf:about="https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR_sequence/1">
    <sbol:persistentIdentity rdf:resource="https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR_sequence"/>
    <sbol:displayId>R0063_pLuxR_pR_sequence</sbol:displayId>
    <sbol:version>1</sbol:version>
    <dcterms:title>R0063_pLuxR-pR Sequence</dcterms:title>
    <sbh:ownedBy rdf:resource="https://synbiohub.org/user/Gon"/>
    <sbh:topLevel rdf:resource="https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR_sequence/1"/>
    <sbol:elements>ACCTGTACGATCCTACAGGTGCTTATGTTAAGTAATTGTATTCCCAGCGATACAATAGTGTGACAAAAATCCAATTTATTAGAATCAAATGTCAATCCATTACCGTTTTAATGATATATAACACGCAAAACTTGCGACAAACAATAGGTAA</sbol:elements>
    <sbol:encoding rdf:resource="http://www.chem.qmul.ac.uk/iubmb/misc/naseq.html"/>
  </sbol:Sequence>
</rdf:RDF>"#;

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

    #[tokio::test]
    async fn synbiohub_sbol2_objects_remain_visible_in_every_imported_graph() {
        let dir = tempfile::tempdir().unwrap();
        let data = DataStore::open(&dir.path().join("sbol.sqlite3"))
            .await
            .expect("open");

        let import = || ImportInput {
            body: SYNBIOHUB_SBOL2_RDF_XML.to_owned(),
            format: SerializationFormat::RdfXml,
            namespace: None,
            source_uri: Some(
                "https://synbiohub.org/user/Gon/CIDARMoCloParts/R0063_pLuxR_pR/1".to_owned(),
            ),
            document_iri: None,
            created_by: None,
            name: Some("R0063_pLuxR_pR.xml".to_owned()),
            description: None,
            overwrite: ImportOverwrite::Fail,
        };
        let first = data
            .store
            .import_document(import())
            .await
            .expect("import SynBioHub SBOL2");
        let second = data
            .store
            .import_document(import())
            .await
            .expect("reimport SynBioHub SBOL2");

        assert_eq!(first.object_count, 2);
        assert_eq!(second.object_count, 2);

        for graph_id in [first.graph_id, second.graph_id] {
            let graph = data
                .store
                .get_graph_overview(graph_id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(graph.object_count, Some(2));
            let search = ListObjectsFilter {
                graph_id: Some(graph_id),
                limit: 100,
                ..ListObjectsFilter::default()
            };
            let objects = data.store.list_objects(&search).await.unwrap();
            assert_eq!(objects.len(), 2);
            // SBOL2-to-3 conversion places the version before the display ID.
            assert!(objects.iter().any(|object| {
                object.iri.as_str()
                    == "https://synbiohub.org/user/Gon/CIDARMoCloParts/1/R0063_pLuxR_pR"
            }));

            // IRI filtering applies before the page limit and remains scoped to
            // either imported graph, even though the index holds one global row.
            let matching = data
                .store
                .list_objects(&ListObjectsFilter {
                    graph_id: Some(graph_id),
                    iri_contains: Some("_SEQUENCE".to_owned()),
                    after_iri: Some(objects[0].iri.as_str().to_owned()),
                    limit: 1,
                    ..ListObjectsFilter::default()
                })
                .await
                .unwrap();
            assert_eq!(matching.len(), 1);
            assert_eq!(matching[0].iri, objects[1].iri);
        }
        let absent_graph = data
            .store
            .list_objects(&ListObjectsFilter {
                graph_id: Some(GraphId(uuid::Uuid::nil())),
                iri_contains: Some("_sequence".to_owned()),
                limit: 100,
                ..ListObjectsFilter::default()
            })
            .await
            .unwrap();
        assert!(absent_graph.is_empty());
    }
}
