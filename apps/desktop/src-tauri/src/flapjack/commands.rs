//! Tauri commands for the Flapjack tab. Each wraps a `FlapjackStore` method and
//! returns a camelCase DTO with errors flattened to `String` for the frontend.

use tauri::State;

use super::dto::{
    AssayDto, CharacterizationDetailDto, CharacterizationDto, ImportStudyInput,
    ImportStudyReportDto, MeasurementDto, OverviewDto, SampleDto, SaveCharacterizationInput,
    SchemaDto, SignalDto, SqlResultDto, StudyDetailDto, StudyDto, ValidateDto,
};
use super::state::FlapjackStore;

#[tauri::command]
pub async fn flapjack_overview(store: State<'_, FlapjackStore>) -> Result<OverviewDto, String> {
    store.overview().await
}

#[tauri::command]
pub async fn flapjack_studies_list(
    store: State<'_, FlapjackStore>,
) -> Result<Vec<StudyDto>, String> {
    store.studies(None).await
}

#[tauri::command]
pub async fn flapjack_study_get(
    store: State<'_, FlapjackStore>,
    id: i64,
) -> Result<StudyDetailDto, String> {
    store.study_detail(id).await
}

#[tauri::command]
pub async fn flapjack_assays_list(
    store: State<'_, FlapjackStore>,
    study_id: Option<i64>,
) -> Result<Vec<AssayDto>, String> {
    store.assays(study_id).await
}

#[tauri::command]
pub async fn flapjack_samples_list(
    store: State<'_, FlapjackStore>,
    assay_id: i64,
) -> Result<Vec<SampleDto>, String> {
    store.samples(assay_id).await
}

#[tauri::command]
pub async fn flapjack_signals_list(
    store: State<'_, FlapjackStore>,
) -> Result<Vec<SignalDto>, String> {
    store.signals().await
}

#[tauri::command]
pub async fn flapjack_measurements_query(
    store: State<'_, FlapjackStore>,
    study_id: Option<i64>,
    assay_id: Option<i64>,
    sample_id: Option<i64>,
    signal_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<MeasurementDto>, String> {
    store
        .measurements(study_id, assay_id, sample_id, signal_id, limit)
        .await
}

#[tauri::command]
pub async fn flapjack_characterizations_list(
    store: State<'_, FlapjackStore>,
    analysis_type: Option<String>,
) -> Result<Vec<CharacterizationDto>, String> {
    store.characterizations(analysis_type).await
}

#[tauri::command]
pub async fn flapjack_characterization_get(
    store: State<'_, FlapjackStore>,
    id: i64,
) -> Result<CharacterizationDetailDto, String> {
    store.characterization_detail(id).await
}

#[tauri::command]
pub async fn flapjack_sql_execute(
    store: State<'_, FlapjackStore>,
    query: String,
) -> Result<SqlResultDto, String> {
    store.sql_execute(query).await
}

#[tauri::command]
pub async fn flapjack_sql_validate(
    store: State<'_, FlapjackStore>,
    query: String,
) -> Result<ValidateDto, String> {
    match store.sql_validate(query).await {
        Ok(()) => Ok(ValidateDto::ok()),
        Err(e) => Ok(ValidateDto::err(e, 1, 1)),
    }
}

#[tauri::command]
pub async fn flapjack_schema_sql(store: State<'_, FlapjackStore>) -> Result<SchemaDto, String> {
    store.schema().await
}

#[tauri::command]
pub fn flapjack_db_path(store: State<'_, FlapjackStore>) -> String {
    store.db_path.clone()
}

#[tauri::command]
pub async fn flapjack_import_study(
    store: State<'_, FlapjackStore>,
    manifest: ImportStudyInput,
) -> Result<ImportStudyReportDto, String> {
    store.import_study(manifest).await
}

#[tauri::command]
pub async fn flapjack_save_characterization(
    store: State<'_, FlapjackStore>,
    run: SaveCharacterizationInput,
) -> Result<CharacterizationDto, String> {
    store.save_characterization(run).await
}
