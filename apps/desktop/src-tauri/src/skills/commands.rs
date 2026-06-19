use tauri::AppHandle;

use super::{Skill, SkillMeta, SkillWriteInput};

#[tauri::command]
pub fn skills_list(app: AppHandle) -> Result<Vec<SkillMeta>, String> {
    super::list_skills(&app)
}

#[tauri::command]
pub fn skill_read(app: AppHandle, slug: String) -> Result<Skill, String> {
    super::load_skill(&app, &slug)
}

#[tauri::command]
pub fn skill_write(app: AppHandle, input: SkillWriteInput) -> Result<SkillMeta, String> {
    super::write_skill(&app, input)
}

#[tauri::command]
pub fn skill_delete(app: AppHandle, slug: String) -> Result<bool, String> {
    super::delete_skill(&app, &slug)
}
