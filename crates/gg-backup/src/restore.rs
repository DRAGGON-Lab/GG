use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    errors::{BackupError, BackupResult},
    stores::filesystem::safe_join,
};

#[derive(Clone, Debug)]
pub struct RestoreInstallResult {
    pub previous_app_data_dir: Option<PathBuf>,
    pub installed_app_data_dir: PathBuf,
}

pub fn install_staged_restore(
    app_data_dir: &Path,
    staging_dir: &Path,
) -> BackupResult<RestoreInstallResult> {
    if !staging_dir.is_dir() {
        return Err(BackupError::restore_install(format!(
            "staging directory does not exist: {}",
            staging_dir.display()
        )));
    }

    let parent = app_data_dir.parent().ok_or_else(|| {
        BackupError::restore_install(format!(
            "app data directory has no parent: {}",
            app_data_dir.display()
        ))
    })?;
    fs::create_dir_all(parent)?;

    let previous_app_data_dir = if app_data_dir.exists() {
        let backup_path = timestamped_previous_app_data_dir(app_data_dir)?;
        fs::rename(app_data_dir, &backup_path).map_err(|error| {
            BackupError::restore_install(format!("could not move current app data aside: {error}"))
        })?;
        Some(backup_path)
    } else {
        None
    };

    if let Err(error) = fs::rename(staging_dir, app_data_dir) {
        if let Some(previous_app_data_dir) = previous_app_data_dir.as_ref() {
            let _ = fs::rename(previous_app_data_dir, app_data_dir);
        }
        return Err(BackupError::restore_install(format!(
            "could not install staged restore: {error}"
        )));
    }

    Ok(RestoreInstallResult {
        previous_app_data_dir,
        installed_app_data_dir: app_data_dir.to_path_buf(),
    })
}

pub(crate) fn write_staged_file(
    staging_dir: &Path,
    relative_path: &str,
    bytes: &[u8],
) -> BackupResult<PathBuf> {
    let destination = safe_join(staging_dir, relative_path)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&destination, bytes)?;
    Ok(destination)
}

fn timestamped_previous_app_data_dir(app_data_dir: &Path) -> BackupResult<PathBuf> {
    let parent = app_data_dir.parent().ok_or_else(|| {
        BackupError::restore_install(format!(
            "app data directory has no parent: {}",
            app_data_dir.display()
        ))
    })?;
    let name = app_data_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("gg-app-data");
    let timestamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| BackupError::restore_install(error.to_string()))?
        .replace(':', "-");

    for counter in 0.. {
        let suffix = if counter == 0 {
            String::new()
        } else {
            format!("-{counter}")
        };
        let candidate = parent.join(format!("{name}.before-restore.{timestamp}{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    unreachable!("unbounded counter should always find a restore backup path")
}
