//! User-authored skills in the Agent Skills format: one folder per skill under
//! `{app_data_dir}/skills/{slug}/SKILL.md`, with frontmatter (`name:`, `description:`)
//! followed by the markdown instruction body, plus optional supporting files beside it.
//! Agents see an index of names and descriptions in their system prompt and load a
//! skill's full body on demand through the `skill` tool.
//!
//! Frontmatter is parsed by hand: the format accepts exactly two known keys between
//! `---` fences, which does not justify a YAML dependency.

pub mod commands;

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// Supporting files are returned to the model whole; anything bigger than this
/// is more likely an asset than instructions.
const MAX_SKILL_FILE_BYTES: u64 = 64 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub slug: String,
    pub name: String,
    pub description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub body: String,
    pub files: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillWriteInput {
    pub slug: Option<String>,
    pub name: String,
    pub description: String,
    pub body: String,
}

pub fn skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("skills"))
}

pub fn list_skills(app: &AppHandle) -> Result<Vec<SkillMeta>, String> {
    let dir = skills_dir(app)?;
    let mut skills = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(skills);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(slug) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Ok(content) = fs::read_to_string(path.join("SKILL.md")) else {
            continue;
        };
        if let Some((meta, _)) = parse_skill(slug, &content) {
            skills.push(meta);
        }
    }
    skills.sort_by_key(|a| a.name.to_lowercase());
    Ok(skills)
}

pub fn load_skill(app: &AppHandle, slug: &str) -> Result<Skill, String> {
    validate_slug(slug)?;
    let dir = skills_dir(app)?.join(slug);
    let content =
        fs::read_to_string(dir.join("SKILL.md")).map_err(|_| format!("Unknown skill: {slug}"))?;
    let (meta, body) = parse_skill(slug, &content)
        .ok_or_else(|| format!("Skill `{slug}` has no valid frontmatter"))?;
    let mut files = Vec::new();
    collect_files(&dir, &dir, &mut files);
    files.sort();
    Ok(Skill {
        slug: meta.slug,
        name: meta.name,
        description: meta.description,
        body,
        files,
    })
}

pub fn write_skill(app: &AppHandle, input: SkillWriteInput) -> Result<SkillMeta, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("A skill needs a name".to_string());
    }
    let slug = match input.slug {
        Some(slug) => {
            validate_slug(&slug)?;
            slug
        }
        None => {
            let slug = kebab_case(name);
            validate_slug(&slug)
                .map_err(|_| format!("Cannot derive a folder name from `{name}`"))?;
            slug
        }
    };
    let dir = skills_dir(app)?.join(&slug);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let description = input.description.trim().replace(['\r', '\n'], " ");
    let manifest = format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        name.replace(['\r', '\n'], " "),
        description,
        input.body.trim()
    );
    fs::write(dir.join("SKILL.md"), manifest).map_err(|error| error.to_string())?;
    Ok(SkillMeta {
        slug,
        name: name.to_string(),
        description,
    })
}

pub fn delete_skill(app: &AppHandle, slug: &str) -> Result<bool, String> {
    validate_slug(slug)?;
    let dir = skills_dir(app)?.join(slug);
    if !dir.is_dir() {
        return Ok(false);
    }
    fs::remove_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(true)
}

/// The `skill` tool: load a skill's full instructions by its listed name (or slug),
/// or one of its supporting files when `file` is given.
pub fn capability_load(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "skill requires `name`".to_string())?;
    let skill = find_skill(app, name)?;
    let Some(rel_path) = args.get("file").and_then(Value::as_str) else {
        return Ok(json!({
            "name": skill.name,
            "description": skill.description,
            "instructions": skill.body,
            "files": skill.files,
        }));
    };
    let dir = skills_dir(app)?.join(&skill.slug);
    let path = resolve_skill_file(&dir, rel_path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_SKILL_FILE_BYTES {
        return Err(format!("`{rel_path}` is larger than 64 KB"));
    }
    let content = fs::read_to_string(&path)
        .map_err(|_| format!("`{rel_path}` is not a readable text file"))?;
    Ok(json!({ "skill": skill.name, "file": rel_path, "content": content }))
}

fn find_skill(app: &AppHandle, query: &str) -> Result<Skill, String> {
    if validate_slug(query).is_ok() {
        if let Ok(skill) = load_skill(app, query) {
            return Ok(skill);
        }
    }
    let matched = list_skills(app)?
        .into_iter()
        .find(|meta| meta.name.eq_ignore_ascii_case(query))
        .ok_or_else(|| format!("Unknown skill: {query}"))?;
    load_skill(app, &matched.slug)
}

/// Confine a skill-relative path to the skill's own folder (no `..`, no symlink
/// escapes), so the tool cannot read arbitrary files.
fn resolve_skill_file(skill_dir: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let root = skill_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let resolved = skill_dir
        .join(rel_path)
        .canonicalize()
        .map_err(|_| format!("No file `{rel_path}` in this skill"))?;
    if !resolved.starts_with(&root) {
        return Err(format!("`{rel_path}` is outside the skill folder"));
    }
    Ok(resolved)
}

fn collect_files(root: &Path, dir: &Path, files: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files(root, &path, files);
        } else if name != "SKILL.md" || dir != root {
            if let Ok(rel) = path.strip_prefix(root) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

fn parse_skill(slug: &str, content: &str) -> Option<(SkillMeta, String)> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut name = None;
    let mut description = None;
    loop {
        let line = lines.next()?;
        if line.trim() == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            name = Some(unquote(value));
        } else if let Some(value) = line.strip_prefix("description:") {
            description = Some(unquote(value));
        }
    }
    let body = lines.collect::<Vec<_>>().join("\n").trim().to_string();
    let name = name.filter(|name| !name.is_empty())?;
    Some((
        SkillMeta {
            slug: slug.to_string(),
            name,
            description: description.unwrap_or_default(),
        },
        body,
    ))
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|inner| inner.strip_suffix('\''))
        })
        .unwrap_or(value)
        .to_string()
}

fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty()
        || slug.starts_with('-')
        || slug.ends_with('-')
        || !slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!(
            "Skill folder names use lowercase letters, digits, and dashes: `{slug}`"
        ));
    }
    Ok(())
}

fn kebab_case(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    slug.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_and_body() {
        let content = "---\nname: Circuit Style\ndescription: \"House style for genetic circuits\"\n---\n\nKeep circuits modular.\n";
        let (meta, body) = parse_skill("circuit-style", content).expect("parses");
        assert_eq!(meta.slug, "circuit-style");
        assert_eq!(meta.name, "Circuit Style");
        assert_eq!(meta.description, "House style for genetic circuits");
        assert_eq!(body, "Keep circuits modular.");
    }

    #[test]
    fn rejects_missing_fence_or_name() {
        assert!(parse_skill("x", "no frontmatter").is_none());
        assert!(parse_skill("x", "---\ndescription: only\n---\nbody").is_none());
        assert!(parse_skill("x", "---\nname: unterminated\n").is_none());
    }

    #[test]
    fn kebab_case_slugs() {
        assert_eq!(kebab_case("Circuit Style"), "circuit-style");
        assert_eq!(kebab_case("  Déjà -- vu 2 "), "d-j-vu-2");
        assert!(validate_slug(&kebab_case("Circuit Style")).is_ok());
        assert!(validate_slug("../escape").is_err());
        assert!(validate_slug("UPPER").is_err());
        assert!(validate_slug("").is_err());
    }

    #[test]
    fn skill_files_stay_inside_the_skill_folder() {
        let root = std::env::temp_dir().join(format!("bioeng-skill-test-{}", std::process::id()));
        let skill_dir = root.join("skills").join("demo");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(root.join("secret.txt"), "secret").unwrap();
        fs::write(skill_dir.join("notes.md"), "ok").unwrap();

        assert!(resolve_skill_file(&skill_dir, "notes.md").is_ok());
        assert!(resolve_skill_file(&skill_dir, "../../secret.txt").is_err());
        assert!(resolve_skill_file(&skill_dir, "missing.md").is_err());

        fs::remove_dir_all(&root).unwrap();
    }
}
