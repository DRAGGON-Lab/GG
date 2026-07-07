import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";

const PLAINTEXT = "plaintext";

/// Maps a file extension to the Monaco language id used for its model. Only
/// `.py`/`.pyi` resolve to `python`; JSON files use Monaco's full JSON
/// language service; everything else uses a syntax-only tokenizer (or plaintext)
/// so non-Python files never reach the Python LSP.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".py": "python",
  ".pyi": "python",
  ".json": "json",
  ".jsonc": "json",
  ".code-workspace": "json",
  ".md": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".ini": "ini",
  ".cfg": "ini",
  ".toml": "ini",
  ".sh": "shell",
};

const LANGUAGE_EXTENSIONS = Object.keys(LANGUAGE_BY_EXTENSION).sort(
  (left, right) => right.length - left.length,
);

/// The Monaco language id for a file, derived from its name's extension.
export function languageForName(name: string): string {
  const lowerName = name.toLowerCase();
  const extension = LANGUAGE_EXTENSIONS.find((candidate) =>
    lowerName.endsWith(candidate),
  );

  return extension === undefined ? PLAINTEXT : LANGUAGE_BY_EXTENSION[extension];
}

/// Whether the file should be handled by the Python language server.
export function isPythonName(name: string): boolean {
  return languageForName(name) === "python";
}
