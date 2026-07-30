pub mod commands;

use std::path::{Path, PathBuf};

/// The formal analyzer is a separate, immutable executable. Packaged builds
/// place it under `runtime/grn-lean/analyze`; development also discovers the
/// sibling checkout used by this workspace. `GG_GRN_LEAN_BIN` is an explicit
/// override for contributors with another layout.
pub struct GrnLeanState {
    analyzer: Option<PathBuf>,
    source: Option<&'static str>,
}

impl GrnLeanState {
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        let environment = std::env::var_os("GG_GRN_LEAN_BIN").map(PathBuf::from);
        if let Some(path) = environment.filter(|path| executable_file(path)) {
            return Self {
                analyzer: Some(path),
                source: Some("environment"),
            };
        }

        let bundled = resource_dir.map(|root| root.join("runtime/grn-lean/analyze"));
        if let Some(path) = bundled.filter(|path| executable_file(path)) {
            return Self {
                analyzer: Some(path),
                source: Some("bundled"),
            };
        }

        if cfg!(debug_assertions) {
            let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let candidates = [
                manifest.join("../../../../../marpaia/grn-lean/.lake/build/bin/analyze"),
                manifest.join("../../../../../grn-lean/.lake/build/bin/analyze"),
            ];
            if let Some(path) = candidates.into_iter().find(|path| executable_file(path)) {
                return Self {
                    analyzer: Some(path),
                    source: Some("development"),
                };
            }
        }

        Self {
            analyzer: None,
            source: None,
        }
    }

    pub fn analyzer(&self) -> Option<&Path> {
        self.analyzer.as_deref()
    }

    pub fn source(&self) -> Option<&str> {
        self.source
    }
}

fn executable_file(path: &Path) -> bool {
    path.is_file()
}
