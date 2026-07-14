//! Tauri commands for the Data tab. Each wraps an `sbol-db` store/engine call
//! and returns a camelCase DTO (or `Vec`/`String`) with errors flattened to
//! `String` for the frontend.

use std::time::Instant;

use gg_data::sbol::SbolObjectSearch;
use sbol_db_core::GraphId;
use sbol_db_core::SerializationFormat;
use sbol_db_sparql::{parse_query, ResultFormat, SparqlOptions};
use sbol_db_storage::{
    DbStats, ImportInput, LabStore, ObjectStore, SbolStore, SequenceSearchOptions,
    SequenceSearchStore, SqlConsole, SqlExecuteRequest,
};
use tauri::State;
use uuid::Uuid;

use super::dto::{
    triple_to_row, BatchSequenceMatchDto, GraphDto, GraphListDto, GraphTriplesDto, ImportItemInput,
    ImportReportDto, ObjectDto, ObjectListDto, OverviewDto, SchemaDto, SequenceMatchDto,
    SparqlResultDto, SqlResultDto, ValidateDto,
};
use super::state::DataStore;

const GRAPH_DEFAULT_LIMIT: i64 = 50;
const GRAPH_MAX_LIMIT: i64 = 500;
const TRIPLE_DEFAULT_LIMIT: i64 = 100;
const TRIPLE_MAX_LIMIT: i64 = 1000;
const OBJECT_DEFAULT_LIMIT: u32 = 100;
const OBJECT_MAX_LIMIT: u32 = 1000;
const SEQUENCE_DEFAULT_MAX_HITS: u32 = 1024;
const SEQUENCE_MAX_PATTERNS: usize = 256;
const SQL_DEFAULT_TIMEOUT_MS: u64 = 15_000;
const SQL_MAX_TIMEOUT_MS: u64 = 60_000;
const SQL_DEFAULT_ROW_LIMIT: u32 = 1_000;
const SQL_MAX_ROW_LIMIT: u32 = 10_000;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Parse the export format string, restricted to the RDF graph formats the
/// single-object export supports.
fn parse_export_format(s: &str) -> Result<SerializationFormat, String> {
    match s.to_ascii_lowercase().as_str() {
        "turtle" | "ttl" => Ok(SerializationFormat::Turtle),
        "jsonld" | "json-ld" => Ok(SerializationFormat::JsonLd),
        "ntriples" | "nt" => Ok(SerializationFormat::NTriples),
        "rdfxml" | "rdf-xml" | "rdf" => Ok(SerializationFormat::RdfXml),
        other => Err(format!("unsupported export format: {other}")),
    }
}

/// Parse an import format string across every format `sbol-db` ingests.
fn parse_import_format(s: &str) -> Result<SerializationFormat, String> {
    match s.to_ascii_lowercase().as_str() {
        "json" => Ok(SerializationFormat::Json),
        "jsonld" | "json-ld" => Ok(SerializationFormat::JsonLd),
        "rdfxml" | "rdf-xml" | "rdf" | "xml" => Ok(SerializationFormat::RdfXml),
        "turtle" | "ttl" => Ok(SerializationFormat::Turtle),
        "trig" => Ok(SerializationFormat::TriG),
        "ntriples" | "nt" => Ok(SerializationFormat::NTriples),
        "nquads" | "nq" => Ok(SerializationFormat::NQuads),
        "genbank" | "gb" | "gbk" => Ok(SerializationFormat::GenBank),
        "fasta" | "fa" | "fna" | "faa" => Ok(SerializationFormat::Fasta),
        other => Err(format!("unsupported import format: {other}")),
    }
}

#[tauri::command]
pub async fn data_overview(data: State<'_, DataStore>) -> Result<OverviewDto, String> {
    let counts = data.store.corpus_counts().await.map_err(err)?;
    let recent = data.store.recent_graphs(5).await.map_err(err)?;
    let classes = data.store.top_classes(10).await.map_err(err)?;
    Ok(OverviewDto {
        counts: counts.into(),
        recent_graphs: recent.into_iter().map(Into::into).collect(),
        top_classes: classes.into_iter().map(Into::into).collect(),
    })
}

#[tauri::command]
pub async fn data_graphs_list(
    data: State<'_, DataStore>,
    kind: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<GraphListDto, String> {
    let limit = limit
        .unwrap_or(GRAPH_DEFAULT_LIMIT)
        .clamp(1, GRAPH_MAX_LIMIT);
    let offset = offset.unwrap_or(0).max(0);
    let kind_ref = kind.as_deref();
    let total = data.store.count_graphs(kind_ref).await.map_err(err)?;
    let graphs = data
        .store
        .list_graph_overviews(kind_ref, limit, offset)
        .await
        .map_err(err)?;
    Ok(GraphListDto {
        total,
        limit,
        offset,
        graphs: graphs.into_iter().map(Into::into).collect(),
    })
}

#[tauri::command]
pub async fn data_graph_get(data: State<'_, DataStore>, id: Uuid) -> Result<GraphDto, String> {
    data.store
        .get_graph_overview(GraphId(id))
        .await
        .map_err(err)?
        .map(Into::into)
        .ok_or_else(|| format!("graph {id} not found"))
}

#[tauri::command]
pub async fn data_graph_triples(
    data: State<'_, DataStore>,
    id: Uuid,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<GraphTriplesDto, String> {
    let limit = limit
        .unwrap_or(TRIPLE_DEFAULT_LIMIT)
        .clamp(1, TRIPLE_MAX_LIMIT);
    let offset = offset.unwrap_or(0).max(0);
    match data
        .store
        .graph_triples(GraphId(id), limit, offset)
        .await
        .map_err(err)?
    {
        None => Err(format!("graph {id} not found")),
        Some(page) => Ok(GraphTriplesDto {
            total: page.total,
            limit,
            offset,
            triples: page.triples.into_iter().map(triple_to_row).collect(),
        }),
    }
}

#[tauri::command]
pub async fn data_objects_list(
    data: State<'_, DataStore>,
    sbol_class: Option<String>,
    role: Option<String>,
    iri_query: Option<String>,
    after: Option<String>,
    limit: Option<u32>,
) -> Result<ObjectListDto, String> {
    let limit = limit
        .unwrap_or(OBJECT_DEFAULT_LIMIT)
        .clamp(1, OBJECT_MAX_LIMIT);
    let iri_query = iri_query
        .as_deref()
        .map(str::trim)
        .filter(|query| !query.is_empty());
    let objects = data.objects.list(SbolObjectSearch {
        sbol_class: sbol_class.as_deref(),
        role: role.as_deref(),
        iri_query,
        after_iri: after.as_deref(),
        limit,
    })?;
    let next_cursor = if objects.len() as u32 >= limit {
        objects.last().map(|o| o.iri.to_owned())
    } else {
        None
    };
    Ok(ObjectListDto {
        objects: objects.into_iter().map(Into::into).collect(),
        next_cursor,
    })
}

#[tauri::command]
pub async fn data_object_get(data: State<'_, DataStore>, iri: String) -> Result<ObjectDto, String> {
    data.store
        .get_object_by_iri(&iri)
        .await
        .map_err(err)?
        .map(Into::into)
        .ok_or_else(|| format!("object {iri} not found"))
}

#[tauri::command]
pub async fn data_object_export(
    data: State<'_, DataStore>,
    iri: String,
    format: String,
) -> Result<String, String> {
    let fmt = parse_export_format(&format)?;
    let triples = data.store.triples_for_subject(&iri).await.map_err(err)?;
    if triples.is_empty() {
        return Err(format!("object {iri} not found"));
    }
    sbol_db_rdf::triples_to_rdf(&triples, fmt).map_err(err)
}

#[tauri::command]
pub async fn data_sequence_search(
    data: State<'_, DataStore>,
    pattern: String,
    max_hits: Option<u32>,
    forward_only: Option<bool>,
) -> Result<Vec<SequenceMatchDto>, String> {
    let options = SequenceSearchOptions {
        max_hits: Some(max_hits.unwrap_or(SEQUENCE_DEFAULT_MAX_HITS)),
        forward_only: forward_only.filter(|&f| f).map(|_| true),
    };
    let matches = data.store.search(&pattern, options).await.map_err(err)?;
    Ok(matches.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn data_sequence_search_batch(
    data: State<'_, DataStore>,
    patterns: Vec<String>,
    max_hits: Option<u32>,
    forward_only: Option<bool>,
) -> Result<Vec<BatchSequenceMatchDto>, String> {
    if patterns.is_empty() {
        return Ok(Vec::new());
    }
    if patterns.len() > SEQUENCE_MAX_PATTERNS {
        return Err(format!(
            "request exceeds maximum of {SEQUENCE_MAX_PATTERNS} patterns per call"
        ));
    }
    let options = SequenceSearchOptions {
        max_hits: Some(max_hits.unwrap_or(SEQUENCE_DEFAULT_MAX_HITS)),
        forward_only: forward_only.filter(|&f| f).map(|_| true),
    };
    let results = data
        .store
        .search_many(&patterns, options)
        .await
        .map_err(err)?;
    Ok(results.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn data_sparql_execute(
    data: State<'_, DataStore>,
    query: String,
    format: Option<String>,
) -> Result<SparqlResultDto, String> {
    if query.trim().is_empty() {
        return Err("empty query".to_string());
    }
    let requested_format = match format.as_deref() {
        None => None,
        Some(s) => Some(s.parse::<ResultFormat>().map_err(err)?),
    };
    let options = SparqlOptions::default();

    let started = Instant::now();
    let outcome = data
        .sparql
        .execute(&query, requested_format, &options)
        .await
        .map_err(err)?;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let content_type = outcome.payload.content_type.to_string();
    let body = if content_type.contains("application/sparql-results+json")
        || content_type.contains("application/json")
    {
        serde_json::from_slice::<serde_json::Value>(&outcome.payload.body).unwrap_or_else(|_| {
            serde_json::Value::String(String::from_utf8_lossy(&outcome.payload.body).into_owned())
        })
    } else {
        serde_json::Value::String(String::from_utf8_lossy(&outcome.payload.body).into_owned())
    };

    Ok(SparqlResultDto {
        content_type,
        body,
        elapsed_ms,
        truncated: outcome.payload.truncated,
    })
}

#[tauri::command]
pub fn data_sparql_validate(query: String) -> ValidateDto {
    if query.trim().is_empty() {
        return ValidateDto::ok();
    }
    match parse_query(&query) {
        Ok(_) => ValidateDto::ok(),
        Err(e) => ValidateDto::err(e.to_string(), 1, 1),
    }
}

#[tauri::command]
pub async fn data_sql_execute(
    data: State<'_, DataStore>,
    query: String,
    timeout_ms: Option<u64>,
    row_limit: Option<u32>,
) -> Result<SqlResultDto, String> {
    let request = SqlExecuteRequest {
        query,
        timeout_ms: timeout_ms
            .unwrap_or(SQL_DEFAULT_TIMEOUT_MS)
            .clamp(1, SQL_MAX_TIMEOUT_MS),
        row_limit: row_limit
            .unwrap_or(SQL_DEFAULT_ROW_LIMIT)
            .clamp(1, SQL_MAX_ROW_LIMIT),
    };
    data.sql_console
        .execute(request)
        .await
        .map(Into::into)
        .map_err(err)
}

#[tauri::command]
pub async fn data_sql_validate(
    data: State<'_, DataStore>,
    query: String,
) -> Result<ValidateDto, String> {
    match data.sql_console.validate(&query).await.map_err(err)? {
        None => Ok(ValidateDto::ok()),
        Some(e) => Ok(ValidateDto::err(e.message, e.line, e.column)),
    }
}

#[tauri::command]
pub async fn data_schema_sql(data: State<'_, DataStore>) -> Result<SchemaDto, String> {
    data.stats
        .schema_overview()
        .await
        .map(Into::into)
        .map_err(err)
}

#[tauri::command]
pub async fn data_import(
    data: State<'_, DataStore>,
    body: String,
    format: String,
    name: Option<String>,
    description: Option<String>,
    source_uri: Option<String>,
) -> Result<ImportReportDto, String> {
    let input = ImportInput {
        body,
        format: parse_import_format(&format)?,
        namespace: None,
        source_uri,
        document_iri: None,
        created_by: None,
        name,
        description,
    };
    data.store
        .import_document(input)
        .await
        .map(Into::into)
        .map_err(err)
}

#[tauri::command]
pub async fn data_import_many(
    data: State<'_, DataStore>,
    items: Vec<ImportItemInput>,
) -> Result<Vec<ImportReportDto>, String> {
    let mut inputs = Vec::with_capacity(items.len());
    for item in items {
        inputs.push(ImportInput {
            body: item.body,
            format: parse_import_format(&item.format)?,
            namespace: None,
            source_uri: item.source_uri,
            document_iri: None,
            created_by: None,
            name: item.name,
            description: item.description,
        });
    }
    data.store
        .import_documents(inputs)
        .await
        .map(|reports| reports.into_iter().map(Into::into).collect())
        .map_err(err)
}
