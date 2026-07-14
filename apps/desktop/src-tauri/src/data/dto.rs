//! camelCase wire types for the Data tab. The `sbol-db` records serialize
//! snake_case; these DTOs give the frontend a uniform camelCase surface and
//! drop fields the UI never reads (content hashes, the always-`None` SQLite
//! backend pid).

use gg_data::sbol::SbolObject;
use sbol_db_core::{ImportReport, ObjectTerm, SbolObjectRecord, SubjectTerm, Triple};
use sbol_db_storage::{
    BatchSequenceMatch, ClassCount, CorpusCounts, GraphOverview, RelationalSchema, SequenceMatch,
    SqlExecuteResult,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountsDto {
    pub objects: i64,
    pub graphs: i64,
    pub triples: i64,
    pub sequences: i64,
    pub validation_runs: i64,
    pub ontologies: i64,
}

impl From<CorpusCounts> for CountsDto {
    fn from(c: CorpusCounts) -> Self {
        Self {
            objects: c.objects,
            graphs: c.graphs,
            triples: c.triples,
            sequences: c.sequences,
            validation_runs: c.validation_runs,
            ontologies: c.ontologies,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDto {
    pub id: String,
    pub iri: String,
    pub kind: String,
    pub name: Option<String>,
    pub source_uri: Option<String>,
    pub serialization_format: Option<String>,
    pub created_at: String,
    pub object_count: i64,
    pub triple_count: i64,
}

impl From<GraphOverview> for GraphDto {
    fn from(g: GraphOverview) -> Self {
        Self {
            id: g.id.0.to_string(),
            iri: g.iri,
            kind: g.kind,
            name: g.name,
            source_uri: g.source_uri,
            serialization_format: g.serialization_format,
            created_at: g.created_at.to_rfc3339(),
            object_count: g.object_count,
            triple_count: g.triple_count,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassCountDto {
    pub iri: String,
    pub count: i64,
}

impl From<ClassCount> for ClassCountDto {
    fn from(c: ClassCount) -> Self {
        Self {
            iri: c.iri,
            count: c.count,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewDto {
    pub counts: CountsDto,
    pub recent_graphs: Vec<GraphDto>,
    pub top_classes: Vec<ClassCountDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphListDto {
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub graphs: Vec<GraphDto>,
}

/// One RDF term, shaped like a SPARQL-results JSON binding so the UI renders
/// graph triples and query rows the same way.
#[derive(Serialize)]
pub struct TermDto {
    #[serde(rename = "type")]
    pub term_type: &'static str,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub datatype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

impl TermDto {
    fn uri(value: String) -> Self {
        Self {
            term_type: "uri",
            value,
            datatype: None,
            language: None,
        }
    }

    fn bnode(value: String) -> Self {
        Self {
            term_type: "bnode",
            value,
            datatype: None,
            language: None,
        }
    }

    fn literal(value: String, datatype: Option<String>, language: Option<String>) -> Self {
        Self {
            term_type: "literal",
            value,
            datatype,
            language,
        }
    }
}

#[derive(Serialize)]
pub struct TripleRowDto {
    pub subject: TermDto,
    pub predicate: TermDto,
    pub object: TermDto,
}

pub fn triple_to_row(triple: Triple) -> TripleRowDto {
    let subject = match triple.subject {
        SubjectTerm::Iri(iri) => TermDto::uri(iri.into_inner()),
        SubjectTerm::BlankNode(node) => TermDto::bnode(node),
    };
    let object = match triple.object {
        ObjectTerm::Iri(iri) => TermDto::uri(iri.into_inner()),
        ObjectTerm::BlankNode(node) => TermDto::bnode(node),
        ObjectTerm::Literal {
            value,
            datatype,
            language,
        } => TermDto::literal(value, Some(datatype.into_inner()), language),
    };
    TripleRowDto {
        subject,
        predicate: TermDto::uri(triple.predicate.into_inner()),
        object,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTriplesDto {
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub triples: Vec<TripleRowDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDto {
    pub id: String,
    pub iri: String,
    pub sbol_class: String,
    pub display_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub graph_id: Option<String>,
    pub types: Vec<String>,
    pub roles: Vec<String>,
    pub data: serde_json::Value,
}

impl From<SbolObjectRecord> for ObjectDto {
    fn from(o: SbolObjectRecord) -> Self {
        Self {
            id: o.id.0.to_string(),
            iri: o.iri.into_inner(),
            sbol_class: o.sbol_class,
            display_id: o.display_id,
            name: o.name,
            description: o.description,
            graph_id: o.graph_id.map(|g| g.0.to_string()),
            types: o.types,
            roles: o.roles,
            data: o.data,
        }
    }
}

impl From<SbolObject> for ObjectDto {
    fn from(o: SbolObject) -> Self {
        Self {
            id: o.id,
            iri: o.iri,
            sbol_class: o.sbol_class,
            display_id: o.display_id,
            name: o.name,
            description: o.description,
            graph_id: o.graph_id,
            types: o.types,
            roles: o.roles,
            data: o.data,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectListDto {
    pub objects: Vec<ObjectDto>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceMatchDto {
    pub sequence_iri: String,
    pub start: i32,
    pub length: i32,
    pub strand: String,
}

impl From<SequenceMatch> for SequenceMatchDto {
    fn from(m: SequenceMatch) -> Self {
        Self {
            sequence_iri: m.sequence_iri,
            start: m.start,
            length: m.length,
            strand: m.strand.to_string(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSequenceMatchDto {
    pub pattern: String,
    pub matches: Vec<SequenceMatchDto>,
}

impl From<BatchSequenceMatch> for BatchSequenceMatchDto {
    fn from(b: BatchSequenceMatch) -> Self {
        Self {
            pattern: b.pattern,
            matches: b.matches.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlColumnDto {
    pub name: String,
    pub column_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlResultDto {
    pub columns: Vec<SqlColumnDto>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

impl From<SqlExecuteResult> for SqlResultDto {
    fn from(r: SqlExecuteResult) -> Self {
        Self {
            columns: r
                .columns
                .into_iter()
                .map(|c| SqlColumnDto {
                    name: c.name,
                    column_type: c.column_type,
                })
                .collect(),
            rows: r.rows,
            row_count: r.row_count,
            truncated: r.truncated,
            elapsed_ms: r.elapsed_ms,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparqlResultDto {
    pub content_type: String,
    pub body: serde_json::Value,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumnDto {
    pub name: String,
    pub column_type: String,
    pub nullable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaTableDto {
    pub name: String,
    pub columns: Vec<SchemaColumnDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDto {
    pub tables: Vec<SchemaTableDto>,
}

impl From<RelationalSchema> for SchemaDto {
    fn from(s: RelationalSchema) -> Self {
        Self {
            tables: s
                .tables
                .into_iter()
                .map(|t| SchemaTableDto {
                    name: t.name,
                    columns: t
                        .columns
                        .into_iter()
                        .map(|c| SchemaColumnDto {
                            name: c.name,
                            column_type: c.column_type,
                            nullable: c.nullable,
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

/// A parse-validation result for the SQL/SPARQL editors. `line`/`column` are
/// 1-indexed so Monaco can place a marker.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateDto {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub line: u32,
    pub column: u32,
}

impl ValidateDto {
    pub fn ok() -> Self {
        Self {
            ok: true,
            message: None,
            line: 1,
            column: 1,
        }
    }

    pub fn err(message: String, line: u32, column: u32) -> Self {
        Self {
            ok: false,
            message: Some(message),
            line,
            column,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReportDto {
    pub graph_id: String,
    pub object_count: usize,
    pub triple_count: usize,
    pub validation_status: String,
    pub validation_issue_count: usize,
}

impl From<ImportReport> for ImportReportDto {
    fn from(r: ImportReport) -> Self {
        Self {
            graph_id: r.graph_id.0.to_string(),
            object_count: r.object_count,
            triple_count: r.triple_count,
            validation_status: r.validation_status.as_db_str().to_string(),
            validation_issue_count: r.validation_issue_count,
        }
    }
}

/// One document in a batch import request.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItemInput {
    pub body: String,
    pub format: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub source_uri: Option<String>,
}
