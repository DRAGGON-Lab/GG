//! camelCase wire types for the Flapjack tab. The SQLite store mirrors the
//! `flapjack-data` model (study → assay → sample → measurement plus the
//! registry entities); these DTOs give the frontend a uniform camelCase
//! surface. Read DTOs derive `FromRow` where the SQL column names line up with
//! the (snake_case) Rust field names; nested shapes are assembled by hand.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Entity read DTOs
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StudyDto {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub public: bool,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AssayDto {
    pub id: i64,
    pub study_id: i64,
    pub name: String,
    pub machine: String,
    pub description: String,
    pub temperature: f64,
    /// Number of samples in the assay (populated by list queries).
    #[serde(default)]
    pub sample_count: i64,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SignalDto {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub color: String,
    pub kind: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleSupplementDto {
    pub chemical: String,
    pub concentration: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleDto {
    pub id: i64,
    pub assay_id: i64,
    pub row: i64,
    pub col: i64,
    pub media: Option<String>,
    pub strain: Option<String>,
    pub vector: Option<String>,
    pub supplements: Vec<SampleSupplementDto>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementDto {
    pub id: i64,
    pub sample_id: i64,
    pub signal_id: i64,
    pub signal: String,
    pub value: f64,
    pub time: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterizationDto {
    pub id: i64,
    pub analysis_type: String,
    pub name: String,
    pub params_hash: String,
    pub spec: serde_json::Value,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CharacterizationDatumDto {
    pub id: i64,
    pub characterization_id: i64,
    pub sample_id: i64,
    pub signal_id: i64,
    pub metric: String,
    pub value: f64,
    pub time: Option<f64>,
    pub concentration: Option<f64>,
    pub concentration2: Option<f64>,
}

// ---------------------------------------------------------------------------
// Aggregate read DTOs
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CountsDto {
    pub studies: i64,
    pub assays: i64,
    pub samples: i64,
    pub signals: i64,
    pub measurements: i64,
    pub characterizations: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewDto {
    pub counts: CountsDto,
    pub recent_studies: Vec<StudyDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyDetailDto {
    pub study: StudyDto,
    pub assays: Vec<AssayDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterizationDetailDto {
    pub characterization: CharacterizationDto,
    pub data: Vec<CharacterizationDatumDto>,
}

// ---------------------------------------------------------------------------
// SQL console DTOs (mirror the Data tab shapes)
// ---------------------------------------------------------------------------

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

/// A parse-validation result for the SQL editor. `line`/`column` are 1-indexed
/// so Monaco can place a marker.
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

// ---------------------------------------------------------------------------
// Write DTOs — the experiment-import manifest
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssayInput {
    pub name: String,
    #[serde(default)]
    pub machine: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub temperature: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalInput {
    pub name: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplementInput {
    pub chemical: String,
    pub concentration: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleInput {
    pub row: i64,
    pub col: i64,
    #[serde(default)]
    pub media: Option<String>,
    #[serde(default)]
    pub strain: Option<String>,
    #[serde(default)]
    pub vector: Option<String>,
    #[serde(default)]
    pub supplements: Vec<SupplementInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementInput {
    /// Index into the manifest's `samples` array (0-based).
    pub sample_index: usize,
    /// Signal name (resolved to a signal id on import).
    pub signal: String,
    pub value: f64,
    pub time: f64,
}

/// A whole experiment (study → assay → samples → measurements plus the signals
/// and registry entities they reference), imported in one transaction.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStudyInput {
    pub study: StudyInput,
    pub assay: AssayInput,
    #[serde(default)]
    pub signals: Vec<SignalInput>,
    #[serde(default)]
    pub samples: Vec<SampleInput>,
    #[serde(default)]
    pub measurements: Vec<MeasurementInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStudyReportDto {
    pub study_id: i64,
    pub assay_id: i64,
    pub sample_count: i64,
    pub measurement_count: i64,
    pub signal_count: i64,
}

// ---------------------------------------------------------------------------
// Write DTOs — persisting a characterization run
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterizationDatumInput {
    pub sample_id: i64,
    pub signal_id: i64,
    pub metric: String,
    pub value: f64,
    #[serde(default)]
    pub time: Option<f64>,
    #[serde(default)]
    pub concentration: Option<f64>,
    #[serde(default)]
    pub concentration2: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCharacterizationInput {
    pub analysis_type: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub params_hash: String,
    #[serde(default)]
    pub spec: serde_json::Value,
    #[serde(default)]
    pub data: Vec<CharacterizationDatumInput>,
}
