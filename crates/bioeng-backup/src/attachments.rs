use std::{
    path::{Component, Path, PathBuf},
    str::FromStr,
};

use walkdir::WalkDir;

use crate::errors::{BackupError, BackupResult};

#[derive(Clone, Debug)]
pub struct AttachmentSource {
    pub relative_path: String,
}

/// Files captured in a snapshot alongside the database. The database is
/// self-contained, but user-authored skills live on disk under
/// `{app_data_dir}/skills/`, so every file there is collected and stored next to
/// the database. Their integrity is recorded in the manifest and re-verified on
/// restore.
pub fn referenced_attachments(app_data_dir: &Path) -> BackupResult<Vec<AttachmentSource>> {
    let skills_dir = app_data_dir.join("skills");
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut attachments = Vec::new();
    for entry in WalkDir::new(&skills_dir).sort_by_file_name() {
        let entry = entry.map_err(|error| BackupError::Io(error.into()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(app_data_dir)
            .map_err(|_| BackupError::unsafe_path(entry.path().to_string_lossy()))?;
        let relative_path = normalize_relative_path(&relative.to_string_lossy())?;
        attachments.push(AttachmentSource { relative_path });
    }

    Ok(attachments)
}

pub fn normalize_relative_path(path: &str) -> BackupResult<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(BackupError::unsafe_path(path));
    }

    let parsed = PathBuf::from_str(trimmed).map_err(|_| BackupError::unsafe_path(path))?;
    if parsed.is_absolute() {
        return Err(BackupError::unsafe_path(path));
    }

    let mut components = Vec::new();
    for component in parsed.components() {
        match component {
            Component::Normal(segment) => components.push(segment.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(BackupError::unsafe_path(path));
            }
        }
    }

    if components.is_empty() {
        return Err(BackupError::unsafe_path(path));
    }

    Ok(components.join("/"))
}

#[cfg(test)]
mod tests {
    use super::{normalize_relative_path, referenced_attachments};
    use std::fs;

    #[test]
    fn normalizes_safe_attachment_paths() {
        assert_eq!(
            normalize_relative_path("./skills/circuit-style/SKILL.md").unwrap(),
            "skills/circuit-style/SKILL.md"
        );
        assert!(normalize_relative_path("../file.md").is_err());
        assert!(normalize_relative_path("/tmp/file.md").is_err());
    }

    #[test]
    fn collects_every_file_under_the_skills_directory() {
        let app_data = tempfile::tempdir().unwrap();
        let skill_dir = app_data.path().join("skills").join("circuit-style");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "body").unwrap();
        fs::write(skill_dir.join("notes.md"), "more").unwrap();
        // A non-skills file in the app data dir is not an attachment.
        fs::write(app_data.path().join("bioeng.sqlite3"), "db").unwrap();

        let paths: Vec<String> = referenced_attachments(app_data.path())
            .unwrap()
            .into_iter()
            .map(|attachment| attachment.relative_path)
            .collect();

        assert_eq!(
            paths,
            vec![
                "skills/circuit-style/SKILL.md".to_string(),
                "skills/circuit-style/notes.md".to_string(),
            ]
        );
    }

    #[test]
    fn returns_empty_when_no_skills_directory_exists() {
        let app_data = tempfile::tempdir().unwrap();
        assert!(referenced_attachments(app_data.path()).unwrap().is_empty());
    }
}
