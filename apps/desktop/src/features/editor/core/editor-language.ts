import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";

const PLAINTEXT = "plaintext";

/// Maps a file extension to the Monaco language id used for its model. Only
/// `.py`/`.pyi` resolve to `python`; `.json` uses Monaco's built-in JSON
/// language service (its own worker), and everything else uses a syntax-only
/// tokenizer (or plaintext) — so non-Python files never reach the Python LSP.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".py": "python",
  ".pyi": "python",
  ".json": "json",
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

/// The Monaco language ids that format-on-save can reformat. Only languages
/// with a registered document formatter belong here; add new file types as
/// their formatters are wired up.
const FORMAT_ON_SAVE_LANGUAGES = new Set<string>(["json"]);

/// Whether format-on-save applies to a Monaco language id.
export function canFormatOnSave(languageId: string): boolean {
  return FORMAT_ON_SAVE_LANGUAGES.has(languageId);
}
