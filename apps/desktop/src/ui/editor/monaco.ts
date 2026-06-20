import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

import type { TextEditorTheme } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";

// The syntax palette maps to fluorophore emission channels — green keywords
// (GFP), magenta strings (a second channel), amber numbers, mint operators —
// against the warm-bone / microscopy-black editor grounds.
const bioengEditorLightTheme: Monaco.editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8a8377", fontStyle: "italic" },
    { token: "keyword", foreground: "0f7d38", fontStyle: "bold" },
    { token: "number", foreground: "9a6b1f" },
    { token: "operator", foreground: "0f7d38" },
    { token: "string", foreground: "b3327f" },
  ],
  colors: {
    "editor.background": "#fdfcf9",
    "editor.foreground": "#1a1714",
    "editor.lineHighlightBackground": "#f2efe8",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#12833f26",
    "editorCursor.foreground": "#128a3e",
    "editorLineNumber.activeForeground": "#128a3e",
    "editorLineNumber.foreground": "#b3ab9e",
    "editorOverviewRuler.border": "#e4ded3",
    "editorUnicodeHighlight.background": "#00000000",
    "editorUnicodeHighlight.border": "#00000000",
    "editorWidget.background": "#faf9f6",
  },
};

const bioengEditorDarkTheme: Monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7066", fontStyle: "italic" },
    { token: "keyword", foreground: "56b87d", fontStyle: "bold" },
    { token: "number", foreground: "d6a85a" },
    { token: "operator", foreground: "74c4a4" },
    { token: "string", foreground: "f0abfc" },
  ],
  colors: {
    "editor.background": "#0a0b0d",
    "editor.foreground": "#e9e8e3",
    "editor.lineHighlightBackground": "#15181a",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#2ecc6340",
    "editorCursor.foreground": "#2ecc63",
    "editorLineNumber.activeForeground": "#2ecc63",
    "editorLineNumber.foreground": "#5b605c",
    "editorOverviewRuler.border": "#262a2e",
    "editorUnicodeHighlight.background": "#00000000",
    "editorUnicodeHighlight.border": "#00000000",
    "editorWidget.background": "#141618",
  },
};

let configured = false;

export const editorUnicodeHighlightOptions = {
  ambiguousCharacters: false,
  includeComments: false,
  includeStrings: false,
  invisibleCharacters: false,
  nonBasicASCII: false,
};

/// Worker bootstrap plus the Bio Eng Studio light/dark editor themes. Safe to call from
/// every Monaco-backed surface; the heavy work runs once.
export function configureMonaco(monaco: typeof Monaco) {
  if (!globalThis.MonacoEnvironment) {
    globalThis.MonacoEnvironment = {
      getWorker: () => new editorWorker(),
    };
  }

  if (configured) {
    return;
  }

  configured = true;

  monaco.editor.defineTheme("bioengEditorLight", bioengEditorLightTheme);
  monaco.editor.defineTheme("bioengEditorDark", bioengEditorDarkTheme);
}

export function getEditorTheme(
  textEditorTheme: TextEditorTheme,
  resolvedTheme: ResolvedTheme,
) {
  const effectiveTheme =
    textEditorTheme === "matchApp" ? resolvedTheme : textEditorTheme;

  return effectiveTheme === "dark" ? "bioengEditorDark" : "bioengEditorLight";
}

export function getTextEditorLineHeight(fontSize: number) {
  return Math.round(fontSize * 1.62);
}
