import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";

import {
  type LspCompletionItem,
  type LspCompletionList,
  type LspDefinitionResult,
  type LspDiagnostic,
  type LspHover,
  type LspLocation,
  type LspLocationLink,
  type LspMarkupContent,
  type LspRange,
  type LspReferencesResult,
  pythonLspCompletions,
  pythonLspDefinition,
  pythonLspHover,
  pythonLspReferences,
} from "@/features/editor/core/python-service";
import { configureMonaco } from "@/ui/editor/monaco";

let registered = false;

/// Worker + themes via the shared bootstrap, plus the Python contribution and
/// the LSP-backed providers. Safe to call from every editor instance; the heavy
/// registration runs once.
export function configurePythonMonaco(monaco: typeof Monaco) {
  configureMonaco(monaco);

  if (registered) {
    return;
  }

  registered = true;

  monaco.languages.registerHoverProvider("python", {
    provideHover: async (model, position) => {
      const uri = model.uri.toString();

      if (!uri.startsWith("file://")) {
        return null;
      }

      try {
        const hover = await pythonLspHover(
          uri,
          position.lineNumber - 1,
          position.column - 1,
        );

        return hoverToMonaco(monaco, hover);
      } catch {
        return null;
      }
    },
  });

  monaco.languages.registerCompletionItemProvider("python", {
    provideCompletionItems: async (model, position) => {
      const uri = model.uri.toString();

      if (!uri.startsWith("file://")) {
        return { suggestions: [] };
      }

      try {
        const result = await pythonLspCompletions(
          uri,
          position.lineNumber - 1,
          position.column - 1,
        );
        const items = completionItems(result);
        const word = model.getWordUntilPosition(position);
        const fallbackRange = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );

        return {
          suggestions: items.map((item) =>
            completionItemToSuggestion(monaco, item, fallbackRange),
          ),
        };
      } catch {
        return { suggestions: [] };
      }
    },
    triggerCharacters: ["."],
  });

  monaco.languages.registerDefinitionProvider("python", {
    provideDefinition: async (model, position) => {
      const uri = model.uri.toString();

      if (!uri.startsWith("file://")) {
        return null;
      }

      try {
        const definition = await pythonLspDefinition(
          uri,
          position.lineNumber - 1,
          position.column - 1,
        );
        const locations = definitionLocations(monaco, definition);

        return locations.length ? locations : null;
      } catch {
        return null;
      }
    },
  });

  monaco.languages.registerReferenceProvider("python", {
    provideReferences: async (model, position) => {
      const uri = model.uri.toString();

      if (!uri.startsWith("file://")) {
        return null;
      }

      try {
        const references = await pythonLspReferences(
          uri,
          position.lineNumber - 1,
          position.column - 1,
        );
        const locations = definitionLocations(monaco, references);

        return locations.length ? locations : null;
      } catch {
        return null;
      }
    },
  });
}

/// Paint published diagnostics for `uri` as model markers. No-ops when no model
/// exists for the document yet.
export function applyPythonDiagnostics(
  monaco: typeof Monaco,
  uri: string,
  diagnostics: LspDiagnostic[],
) {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));

  if (!model) {
    return;
  }

  monaco.editor.setModelMarkers(
    model,
    "python",
    diagnostics.map((diagnostic) => diagnosticToMarker(monaco, diagnostic)),
  );
}

function lspRangeToMonaco(monaco: typeof Monaco, range: LspRange) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function diagnosticToMarker(
  monaco: typeof Monaco,
  diagnostic: LspDiagnostic,
): Monaco.editor.IMarkerData {
  return {
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    message: diagnostic.message,
    severity: markerSeverity(monaco, diagnostic.severity),
    source: diagnostic.source,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
  };
}

function markerSeverity(
  monaco: typeof Monaco,
  severity: LspDiagnostic["severity"],
): Monaco.MarkerSeverity {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function hoverToMonaco(
  monaco: typeof Monaco,
  hover: LspHover,
): Monaco.languages.Hover | null {
  if (!hover) {
    return null;
  }

  const value = markupToString(hover.contents).trim();

  if (!value) {
    return null;
  }

  return {
    contents: [{ value }],
    range: hover.range ? lspRangeToMonaco(monaco, hover.range) : undefined,
  };
}

function markupToString(contents: NonNullable<LspHover>["contents"]): string {
  if (typeof contents === "string") {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents
      .map((entry) =>
        typeof entry === "string" ? entry : (entry as LspMarkupContent).value,
      )
      .filter(Boolean)
      .join("\n\n");
  }

  return contents.value;
}

function completionItems(
  result: LspCompletionList | LspCompletionItem[] | null,
): LspCompletionItem[] {
  if (!result) {
    return [];
  }

  return Array.isArray(result) ? result : result.items;
}

function completionItemToSuggestion(
  monaco: typeof Monaco,
  item: LspCompletionItem,
  fallbackRange: Monaco.IRange,
): Monaco.languages.CompletionItem {
  const insertText = item.textEdit?.newText ?? item.insertText ?? item.label;
  const range = item.textEdit
    ? lspRangeToMonaco(monaco, item.textEdit.range)
    : fallbackRange;
  const isSnippet = item.insertTextFormat === 2;

  return {
    label: item.label,
    kind: completionKind(monaco, item.kind),
    detail: item.detail,
    documentation: item.documentation
      ? { value: markupToString(item.documentation) }
      : undefined,
    insertText,
    insertTextRules: isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    filterText: item.filterText,
    sortText: item.sortText,
    range,
  };
}

function completionKind(
  monaco: typeof Monaco,
  kind: number | null | undefined,
): Monaco.languages.CompletionItemKind {
  const Kind = monaco.languages.CompletionItemKind;

  switch (kind) {
    case 2:
      return Kind.Method;
    case 3:
      return Kind.Function;
    case 4:
      return Kind.Constructor;
    case 5:
      return Kind.Field;
    case 6:
      return Kind.Variable;
    case 7:
      return Kind.Class;
    case 8:
      return Kind.Interface;
    case 9:
      return Kind.Module;
    case 10:
      return Kind.Property;
    case 14:
      return Kind.Keyword;
    case 21:
      return Kind.Constant;
    default:
      return Kind.Text;
  }
}

function definitionLocations(
  monaco: typeof Monaco,
  value: LspDefinitionResult | LspReferencesResult,
): Monaco.languages.Location[] {
  return definitionItems(value).flatMap((item) => {
    const link = item as LspLocationLink;
    const location = item as LspLocation;
    const uri = location.uri ?? link.targetUri;
    const range =
      link.targetSelectionRange ?? link.targetRange ?? location.range;

    if (!uri || !range) {
      return [];
    }

    return [
      {
        uri: monaco.Uri.parse(uri),
        range: lspRangeToMonaco(monaco, range),
      },
    ];
  });
}

function definitionItems(
  value: LspDefinitionResult | LspReferencesResult,
): Array<LspLocation | LspLocationLink> {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
