//! Resolution and execution for Bio Eng Studio's bundled relocatable CPython
//! runtime and the `uv` package manager.
//!
//! One interpreter powers both the editor's Python LSP (`pylsp`) and script
//! execution. The bundled `uv` binary creates and manages each workspace's
//! own `.venv` (sitting in the project directory, like `.git`) and installs
//! packages into it. This crate locates those binaries across dev and
//! bundled-prod layouts and streams process output line-by-line.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Path from a `src-tauri` directory to the interpreter, e.g.
/// `runtime/python/bin/python3` on Unix.
#[cfg(not(windows))]
const INTERPRETER_RELATIVE: &[&str] = &["runtime", "python", "bin", "python3"];
#[cfg(windows)]
const INTERPRETER_RELATIVE: &[&str] = &["runtime", "python", "python.exe"];

/// Path from a `src-tauri` directory to the bundled `uv` binary.
#[cfg(not(windows))]
const UV_RELATIVE: &[&str] = &["runtime", "uv", "uv"];
#[cfg(windows)]
const UV_RELATIVE: &[&str] = &["runtime", "uv", "uv.exe"];

/// The per-workspace virtual environment directory name, created in the project
/// root alongside its sources.
pub const VENV_DIR: &str = ".venv";

/// Path from a workspace root to the venv's Python interpreter.
#[cfg(not(windows))]
const VENV_PYTHON_RELATIVE: &[&str] = &[VENV_DIR, "bin", "python3"];
#[cfg(windows)]
const VENV_PYTHON_RELATIVE: &[&str] = &[VENV_DIR, "Scripts", "python.exe"];

fn join_segments(base: &Path, segments: &[&str]) -> PathBuf {
    let mut path = base.to_path_buf();
    for segment in segments {
        path.push(segment);
    }
    path
}

fn join_interpreter(base: &Path) -> PathBuf {
    join_segments(base, INTERPRETER_RELATIVE)
}

/// The dev `src-tauri` directory, derived from this crate's location in the
/// workspace: `<workspace>/apps/desktop/src-tauri`.
///
/// `CARGO_MANIFEST_DIR` is `<workspace>/crates/bioeng-pyenv` at build time; the
/// workspace root is two levels up.
fn dev_src_tauri() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .unwrap_or(manifest_dir);
    workspace_root.join("apps/desktop/src-tauri")
}

/// The dev interpreter path:
/// `<workspace>/apps/desktop/src-tauri/runtime/python/bin/python3`.
fn dev_interpreter() -> PathBuf {
    join_interpreter(&dev_src_tauri())
}

/// Resolve the runtime interpreter, preferring the bundled-prod resource layout
/// when a `resource_dir` is provided, then falling back to the dev layout.
/// Returns the first path that exists, or `None` if neither does.
pub fn python_executable(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(resource_dir) = resource_dir {
        let prod = join_interpreter(resource_dir);
        if prod.exists() {
            return Some(prod);
        }
    }

    let dev = dev_interpreter();
    if dev.exists() {
        return Some(dev);
    }

    None
}

/// The interpreter path relative to a caller-supplied `src-tauri` base
/// directory. Used by callers that already know their `src-tauri` location and
/// want the dev path without relying on this crate's compile-time location.
pub fn python_executable_in(src_tauri_dir: &Path) -> Option<PathBuf> {
    let path = join_interpreter(src_tauri_dir);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Resolve the bundled `uv` binary, preferring the bundled-prod resource layout
/// when a `resource_dir` is provided, then falling back to the dev layout.
/// Returns the first path that exists, or `None` if neither does.
pub fn uv_executable(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(resource_dir) = resource_dir {
        let prod = join_segments(resource_dir, UV_RELATIVE);
        if prod.exists() {
            return Some(prod);
        }
    }

    let dev = join_segments(&dev_src_tauri(), UV_RELATIVE);
    if dev.exists() {
        return Some(dev);
    }

    None
}

/// The Python interpreter inside a workspace's `.venv`, whether or not it
/// exists yet.
pub fn venv_python_path(workspace_root: &Path) -> PathBuf {
    join_segments(workspace_root, VENV_PYTHON_RELATIVE)
}

/// The workspace's `.venv` interpreter if it exists. This is the interpreter
/// scripts run with and packages install into; a missing `.venv` means the
/// workspace has no environment yet.
pub fn workspace_venv_python(workspace_root: &Path) -> Option<PathBuf> {
    let path = venv_python_path(workspace_root);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Which standard stream a line of output came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

/// A single line of process output, tagged by its source stream. The trailing
/// newline is stripped.
#[derive(Debug, Clone, Serialize)]
pub struct OutputLine {
    pub stream: Stream,
    pub line: String,
}

/// Spawn `command` with piped stdio, streaming each stdout and stderr line to
/// `on_line` as it arrives, and resolve to the process exit code (`None` if the
/// process was terminated by a signal without an exit code). Stdin is closed
/// and the child is killed if the run future is dropped (e.g. cancelled).
async fn stream_command<F>(mut command: Command, on_line: F) -> Result<Option<i32>, String>
where
    F: Fn(OutputLine) + Send + Sync + 'static,
{
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("failed to spawn process: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "could not capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "could not capture stderr".to_string())?;

    let on_line = std::sync::Arc::new(on_line);

    let stdout_handle = {
        let on_line = on_line.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                on_line(OutputLine {
                    stream: Stream::Stdout,
                    line,
                });
            }
        })
    };

    let stderr_handle = {
        let on_line = on_line.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                on_line(OutputLine {
                    stream: Stream::Stderr,
                    line,
                });
            }
        })
    };

    let status = child
        .wait()
        .await
        .map_err(|error| format!("failed to wait for process: {error}"))?;

    // Drain both readers so no buffered lines are dropped after exit.
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    Ok(status.code())
}

/// Source of the run wrapper that executes a user script as `__main__` and
/// captures matplotlib figures. Write it to disk and pass its path to
/// [`run_script_with_capture`].
pub const RUNNER_SOURCE: &str = include_str!("bioeng_runner.py");

/// Prefix the run wrapper prints on stdout before a rich display's JSON MIME
/// bundle. A line starting with this marker is a displayable object (figure,
/// table, HTML, SVG, …), not text. The wrapper produces these from matplotlib
/// figures and from `display(obj)` via the object's standard rich-repr methods.
pub const DISPLAY_SENTINEL: &str = "\u{1f}BIOENG_DISPLAY\u{1f}";

/// Run a Python script with the given interpreter, streaming each stdout and
/// stderr line to `on_line` as it arrives, and resolve to the process exit
/// code (`None` if the process was terminated by a signal without an exit
/// code). `cwd` is the working directory for the child.
pub async fn run_script<F>(
    python: &Path,
    script_path: &Path,
    cwd: &Path,
    on_line: F,
) -> Result<Option<i32>, String>
where
    F: Fn(OutputLine) + Send + Sync + 'static,
{
    let mut command = Command::new(python);
    command
        .arg(script_path)
        .current_dir(cwd)
        // Unbuffered stdio so prints surface line-by-line rather than at exit.
        .env("PYTHONUNBUFFERED", "1");
    stream_command(command, on_line).await
}

/// Run a Python script through the output-capturing wrapper at `runner_path`
/// (whose contents are [`RUNNER_SOURCE`]). Identical to [`run_script`] except
/// rich output (matplotlib figures, `display(obj)`) surfaces as stdout lines
/// prefixed with [`DISPLAY_SENTINEL`], each carrying a JSON MIME bundle.
pub async fn run_script_with_capture<F>(
    python: &Path,
    runner_path: &Path,
    script_path: &Path,
    cwd: &Path,
    on_line: F,
) -> Result<Option<i32>, String>
where
    F: Fn(OutputLine) + Send + Sync + 'static,
{
    let mut command = Command::new(python);
    command
        .arg(runner_path)
        .arg(script_path)
        .current_dir(cwd)
        .env("PYTHONUNBUFFERED", "1");
    stream_command(command, on_line).await
}

/// A package installed in a workspace's `.venv`. `direct` is true when the
/// package is declared in `pyproject.toml` (one the user added), as opposed to
/// a transitive dependency pulled in to satisfy a direct one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPackage {
    pub name: String,
    pub version: String,
    // `uv pip list` JSON has no `direct` field; default it, then fill it in.
    #[serde(default)]
    pub direct: bool,
}

/// The state of a workspace's `.venv`: whether it exists, where, its Python
/// version, and how many packages it holds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvStatus {
    pub has_venv: bool,
    pub venv_path: Option<String>,
    pub python_version: Option<String>,
    pub package_count: Option<usize>,
}

/// A `uv` command scoped to a workspace: run from the workspace root with the
/// bundled binary. `extra` args follow the subcommand.
fn uv_command(uv: &Path, workspace_root: &Path) -> Command {
    let mut command = Command::new(uv);
    command
        .current_dir(workspace_root)
        // Surface uv's progress promptly and without ANSI styling, which the
        // line-based output panel renders verbatim.
        .env("NO_COLOR", "1")
        // Pin to the bundled interpreter; never let uv fetch its own Python.
        .env("UV_PYTHON_DOWNLOADS", "never");
    command
}

/// The interpreter's `(major, minor)` version, read by running it. None when it
/// can't be launched or its output doesn't parse.
async fn interpreter_minor(python: &Path) -> Option<(u32, u32)> {
    let output = Command::new(python)
        .arg("-c")
        .arg("import sys; print(sys.version_info.major, sys.version_info.minor)")
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

/// Bound an open-ended `requires-python` in the workspace manifest to the bundled
/// interpreter's minor version (e.g. `>=3.12,<3.13`).
///
/// uv builds a *universal* lock that must satisfy every Python in
/// `requires-python`. Left open-ended (uv init writes `>=3.12`), it also has to
/// resolve for future Pythons where some dependencies have no compatible release
/// — e.g. on 3.14 only newer matplotlib ships wheels, and that pulls `pyparsing>=3`,
/// which conflicts with `loica -> tyto -> pyparsing<3` and fails resolution. The
/// app ships and runs exactly one interpreter, so locking for any other version
/// is both meaningless and the source of these phantom conflicts.
///
/// Best-effort and conservative: only an unbounded spec is tightened; an explicit
/// range the user wrote is left untouched. Any read/parse failure is left for uv
/// to surface.
async fn bound_requires_python(workspace_root: &Path, base_python: &Path) {
    let path = workspace_root.join("pyproject.toml");
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return;
    };
    let Some((major, minor)) = interpreter_minor(base_python).await else {
        return;
    };
    let bound = format!(">={major}.{minor},<{major}.{}", minor + 1);
    if let Some(updated) = rewrite_requires_python(&contents, &bound) {
        let _ = std::fs::write(&path, updated);
    }
}

/// Replace an unbounded `requires-python` value with `bound`, returning the new
/// file contents. None when there's nothing to change: no such field, or a spec
/// that already carries an upper bound (`<`, `==`, or `~=`).
fn rewrite_requires_python(contents: &str, bound: &str) -> Option<String> {
    let mut result = String::with_capacity(contents.len() + bound.len());
    let mut changed = false;
    for line in contents.lines() {
        let trimmed = line.trim_start();
        if !changed && trimmed.starts_with("requires-python") {
            if let Some(value) = field_string_value(trimmed) {
                let already_bounded =
                    value.contains('<') || value.contains("==") || value.contains("~=");
                if !already_bounded {
                    let indent = &line[..line.len() - trimmed.len()];
                    result.push_str(indent);
                    result.push_str(&format!("requires-python = \"{bound}\""));
                    result.push('\n');
                    changed = true;
                    continue;
                }
            }
        }
        result.push_str(line);
        result.push('\n');
    }
    changed.then_some(result)
}

/// The double-quoted value from a `key = "value"` TOML line, ignoring anything
/// after the closing quote (e.g. a comment).
fn field_string_value(line: &str) -> Option<&str> {
    let start = line.find('"')? + 1;
    let end = line[start..].find('"')? + start;
    Some(&line[start..end])
}

/// Initialize the workspace as a uv project (creating `pyproject.toml` if
/// absent) and sync its `.venv` and `uv.lock` from `base_python`, streaming
/// uv's progress to `on_line`. Idempotent: an existing project is left intact
/// and uv reuses a matching venv.
pub async fn create_venv<F>(
    uv: &Path,
    base_python: &Path,
    workspace_root: &Path,
    on_line: F,
) -> Result<Option<i32>, String>
where
    F: Fn(OutputLine) + Send + Sync + 'static,
{
    let on_line = std::sync::Arc::new(on_line);

    // Keep the venv out of version control, whether or not git is set up yet.
    if let Err(error) = ensure_venv_gitignored(workspace_root) {
        on_line(OutputLine {
            stream: Stream::Stderr,
            line: format!("warning: could not update .gitignore: {error}"),
        });
    }

    // `uv init --bare` creates only a `pyproject.toml`; skip it when the
    // workspace is already a project so an existing manifest is preserved.
    if !workspace_root.join("pyproject.toml").exists() {
        let mut init = uv_command(uv, workspace_root);
        init.arg("init")
            .arg("--bare")
            .arg("--python")
            .arg(base_python)
            .arg(workspace_root);
        let callback = on_line.clone();
        let code = stream_command(init, move |line| callback(line)).await?;
        if code != Some(0) {
            return Ok(code);
        }
    }

    // Keep the lock scoped to the one interpreter the app runs, so resolution
    // never has to satisfy a future Python where the dependency set conflicts.
    bound_requires_python(workspace_root, base_python).await;

    // `uv sync` creates the `.venv` and writes `uv.lock` from the manifest.
    let mut sync = uv_command(uv, workspace_root);
    sync.arg("sync")
        .arg("--python")
        .arg(base_python)
        .arg("--project")
        .arg(workspace_root);
    let callback = on_line.clone();
    stream_command(sync, move |line| callback(line)).await
}

/// Add `packages` to the workspace project, updating `pyproject.toml`,
/// `uv.lock`, and the `.venv`. Streams uv's progress to `on_line`. `base_python`
/// is the bundled interpreter, used to keep `requires-python` bound to the one
/// Python the app runs before resolving (see [`bound_requires_python`]).
pub async fn install_packages<F>(
    uv: &Path,
    base_python: &Path,
    workspace_root: &Path,
    packages: &[String],
    on_line: F,
) -> Result<Option<i32>, String>
where
    F: Fn(OutputLine) + Send + Sync + 'static,
{
    bound_requires_python(workspace_root, base_python).await;

    let mut command = uv_command(uv, workspace_root);
    command.arg("add").arg("--project").arg(workspace_root);
    for package in packages {
        command.arg(package);
    }
    stream_command(command, on_line).await
}

/// Remove `packages` from the workspace project, updating `pyproject.toml`,
/// `uv.lock`, and the `.venv`. Streams uv's progress to `on_line`.
pub async fn uninstall_packages<F>(
    uv: &Path,
    workspace_root: &Path,
    packages: &[String],
    on_line: F,
) -> Result<Option<i32>, String>
where
    F: Fn(OutputLine) + Send + Sync + 'static,
{
    let mut command = uv_command(uv, workspace_root);
    command.arg("remove").arg("--project").arg(workspace_root);
    for package in packages {
        command.arg(package);
    }
    stream_command(command, on_line).await
}

/// List packages installed in the workspace's `.venv`. Returns an empty list
/// when no `.venv` exists yet.
pub async fn list_packages(
    uv: &Path,
    workspace_root: &Path,
) -> Result<Vec<InstalledPackage>, String> {
    if workspace_venv_python(workspace_root).is_none() {
        return Ok(Vec::new());
    }

    let output = uv_command(uv, workspace_root)
        .arg("pip")
        .arg("list")
        .arg("--python")
        .arg(venv_python_path(workspace_root))
        .arg("--format")
        .arg("json")
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("failed to run uv pip list: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut packages: Vec<InstalledPackage> = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("failed to parse uv pip list output: {error}"))?;

    // Flag the packages declared in `pyproject.toml` as direct; the rest are
    // transitive dependencies pulled in to satisfy them.
    let direct = direct_dependency_names(workspace_root);
    for package in &mut packages {
        package.direct = direct.contains(&normalize_package_name(&package.name));
    }

    Ok(packages)
}

/// The normalized names of the project's direct dependencies, read from
/// `pyproject.toml`'s `[project].dependencies`. Empty when the file is absent
/// or unparseable.
fn direct_dependency_names(workspace_root: &Path) -> std::collections::HashSet<String> {
    #[derive(Deserialize)]
    struct PyProject {
        project: Option<Project>,
    }
    #[derive(Deserialize)]
    struct Project {
        #[serde(default)]
        dependencies: Vec<String>,
    }

    let Ok(contents) = std::fs::read_to_string(workspace_root.join("pyproject.toml")) else {
        return std::collections::HashSet::new();
    };
    let Ok(parsed) = toml::from_str::<PyProject>(&contents) else {
        return std::collections::HashSet::new();
    };

    parsed
        .project
        .map(|project| project.dependencies)
        .unwrap_or_default()
        .iter()
        .map(|requirement| normalize_package_name(&requirement_name(requirement)))
        .collect()
}

/// The bare package name from a PEP 508 requirement string, e.g.
/// `"scikit-learn>=1.4; python_version>'3.8'"` → `"scikit-learn"`.
fn requirement_name(requirement: &str) -> String {
    let end = requirement
        .find(|c: char| c.is_whitespace() || "<>=!~;[@(".contains(c))
        .unwrap_or(requirement.len());
    requirement[..end].trim().to_string()
}

/// Normalize a package name for comparison per PEP 503: lowercase, with any run
/// of `-`, `_`, or `.` collapsed to a single `-`.
fn normalize_package_name(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    let mut last_was_separator = false;
    for ch in name.trim().chars() {
        if matches!(ch, '-' | '_' | '.') {
            if !last_was_separator && !normalized.is_empty() {
                normalized.push('-');
            }
            last_was_separator = true;
        } else {
            normalized.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        }
    }
    normalized
}

/// Report the workspace's `.venv` status without mutating anything.
pub async fn env_status(workspace_root: &Path, uv: &Path) -> EnvStatus {
    let Some(venv_python) = workspace_venv_python(workspace_root) else {
        return EnvStatus {
            has_venv: false,
            venv_path: None,
            python_version: None,
            package_count: None,
        };
    };

    let python_version = python_version(&venv_python).await.ok();
    let package_count = list_packages(uv, workspace_root)
        .await
        .ok()
        .map(|p| p.len());

    EnvStatus {
        has_venv: true,
        venv_path: Some(venv_dir(workspace_root).to_string_lossy().into_owned()),
        python_version,
        package_count,
    }
}

/// The workspace's `.venv` directory path (whether or not it exists).
fn venv_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(VENV_DIR)
}

/// Ensure the workspace's `.gitignore` ignores `.venv/`, creating the file if
/// absent and appending the entry only when it isn't already present. Done
/// regardless of whether the directory is a git repository yet.
fn ensure_venv_gitignored(workspace_root: &Path) -> std::io::Result<()> {
    let gitignore = workspace_root.join(".gitignore");
    let entry = format!("{VENV_DIR}/");

    let existing = match std::fs::read_to_string(&gitignore) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error),
    };

    // Already ignored, with or without the trailing slash? Nothing to do.
    let already = existing
        .lines()
        .map(str::trim)
        .any(|line| line == entry || line == VENV_DIR);
    if already {
        return Ok(());
    }

    let mut updated = existing;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(&entry);
    updated.push('\n');
    std::fs::write(&gitignore, updated)
}

/// Run `python --version` and return the trimmed version string (e.g.
/// `"Python 3.12.13"`). Newer CPython prints to stdout; older to stderr, so
/// both are consulted.
///
/// The probe is attempted twice: macOS kills the interpreter's first exec after
/// it is copied into place (exit 137, no output) while assessing its code
/// signature, then caches the verdict so the immediate retry succeeds.
pub async fn python_version(python: &Path) -> Result<String, String> {
    let mut last_error = String::new();

    for _ in 0..2 {
        let output = Command::new(python)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .await
            .map_err(|error| format!("failed to run python --version: {error}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let version = if stdout.trim().is_empty() {
            stderr.trim()
        } else {
            stdout.trim()
        };

        if !version.is_empty() {
            return Ok(version.to_string());
        }

        last_error = format!(
            "python --version produced no output (status {})",
            output.status,
        );
    }

    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn resolved_python() -> Option<PathBuf> {
        python_executable(None)
    }

    #[test]
    fn parses_requirement_names() {
        assert_eq!(requirement_name("numpy"), "numpy");
        assert_eq!(requirement_name("numpy>=2.4.6"), "numpy");
        assert_eq!(requirement_name("scikit-learn >= 1.4"), "scikit-learn");
        assert_eq!(
            requirement_name("uvicorn[standard]==0.30; python_version>'3.8'"),
            "uvicorn"
        );
    }

    #[test]
    fn bounds_open_ended_requires_python() {
        let manifest =
            "[project]\nname = \"demo\"\nrequires-python = \">=3.12\"\ndependencies = []\n";
        let updated = rewrite_requires_python(manifest, ">=3.12,<3.13").expect("should rewrite");
        assert!(updated.contains("requires-python = \">=3.12,<3.13\""));
        assert!(updated.contains("name = \"demo\""));
        assert!(updated.contains("dependencies = []"));
    }

    #[test]
    fn leaves_already_bounded_requires_python() {
        // An explicit upper bound, an exact pin, and a compatible-release pin are
        // all left untouched.
        for spec in [">=3.12,<3.13", "==3.12.*", "~=3.12"] {
            let manifest = format!("[project]\nrequires-python = \"{spec}\"\n");
            assert_eq!(rewrite_requires_python(&manifest, ">=3.12,<3.13"), None);
        }
    }

    #[test]
    fn ignores_manifest_without_requires_python() {
        let manifest = "[project]\nname = \"demo\"\ndependencies = []\n";
        assert_eq!(rewrite_requires_python(manifest, ">=3.12,<3.13"), None);
    }

    #[test]
    fn normalizes_names_per_pep503() {
        assert_eq!(normalize_package_name("scikit-learn"), "scikit-learn");
        assert_eq!(normalize_package_name("scikit_learn"), "scikit-learn");
        assert_eq!(normalize_package_name("Jinja2"), "jinja2");
        assert_eq!(
            normalize_package_name("ruamel.yaml.clib"),
            "ruamel-yaml-clib"
        );
    }

    #[test]
    fn reads_direct_dependencies_from_pyproject() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("pyproject.toml"),
            "[project]\nname = \"x\"\ndependencies = [\"numpy>=2\", \"scikit-learn\"]\n",
        )
        .unwrap();

        let direct = direct_dependency_names(dir.path());
        assert!(direct.contains("numpy"));
        assert!(direct.contains("scikit-learn"));
        assert!(!direct.contains("pillow"));
    }

    #[test]
    fn gitignore_created_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        ensure_venv_gitignored(dir.path()).unwrap();
        let contents = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert_eq!(contents, ".venv/\n");
    }

    #[test]
    fn gitignore_appends_without_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        let gitignore = dir.path().join(".gitignore");
        std::fs::write(&gitignore, "build/\n").unwrap();

        ensure_venv_gitignored(dir.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(&gitignore).unwrap(),
            "build/\n.venv/\n"
        );

        // Idempotent: a second call (and a bare `.venv` form) adds nothing.
        ensure_venv_gitignored(dir.path()).unwrap();
        std::fs::write(&gitignore, ".venv\n").unwrap();
        ensure_venv_gitignored(dir.path()).unwrap();
        assert_eq!(std::fs::read_to_string(&gitignore).unwrap(), ".venv\n");
    }

    #[tokio::test]
    async fn streams_stdout_and_reports_exit_code() {
        let Some(python) = resolved_python() else {
            eprintln!("skipping: runtime interpreter not found");
            return;
        };

        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("hello.py");
        std::fs::write(
            &script,
            "import sys\nprint('hello stdout')\nprint('hello stderr', file=sys.stderr)\n",
        )
        .unwrap();

        let collected = Arc::new(Mutex::new(Vec::new()));
        let sink = collected.clone();
        let code = run_script(&python, &script, dir.path(), move |line| {
            sink.lock().unwrap().push(line);
        })
        .await
        .unwrap();

        assert_eq!(code, Some(0));
        let lines = collected.lock().unwrap();
        assert!(lines
            .iter()
            .any(|l| l.stream == Stream::Stdout && l.line == "hello stdout"));
        assert!(lines
            .iter()
            .any(|l| l.stream == Stream::Stderr && l.line == "hello stderr"));
    }

    #[tokio::test]
    async fn reports_version() {
        let Some(python) = resolved_python() else {
            eprintln!("skipping: runtime interpreter not found");
            return;
        };
        let version = python_version(&python).await.unwrap();
        assert!(version.starts_with("Python 3"), "got: {version}");
    }
}
