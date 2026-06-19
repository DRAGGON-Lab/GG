use bioeng_data::Database;
use std::{collections::BTreeSet, sync::OnceLock};
use tauri::State;

use super::AppSettings;

/// Installed monospace families, scanned once per app run — `load_system_fonts`
/// reads every font file on the system, far too slow to repeat or to run on
/// the main thread.
static MONOSPACE_FONTS: OnceLock<Vec<String>> = OnceLock::new();

#[tauri::command]
pub fn settings_get(database: State<'_, Database>) -> Result<AppSettings, String> {
    database.load_app_settings()
}

#[tauri::command]
pub fn settings_save(
    database: State<'_, Database>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    database.save_app_settings(&settings)?;
    database.load_app_settings()
}

#[tauri::command]
pub async fn settings_list_monospace_fonts() -> Result<Vec<String>, String> {
    if let Some(families) = MONOSPACE_FONTS.get() {
        return Ok(families.clone());
    }

    let families = tauri::async_runtime::spawn_blocking(list_monospace_font_families)
        .await
        .map_err(|error| error.to_string())?;

    Ok(MONOSPACE_FONTS.get_or_init(|| families).clone())
}

fn list_monospace_font_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut families = BTreeSet::new();

    for face in database.faces().filter(|face| face.monospaced) {
        if let Some((family, _language)) = face.families.first() {
            families.insert(family.clone());
        }
    }

    families.into_iter().collect()
}
