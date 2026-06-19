import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

import type { TextEditorTheme } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";

const bioengEditorLightTheme: Monaco.editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "5f6b65", fontStyle: "italic" },
    { token: "keyword", foreground: "255f75", fontStyle: "bold" },
    { token: "number", foreground: "8b5e34" },
    { token: "operator", foreground: "255f75" },
    { token: "string", foreground: "7b4c85" },
  ],
  colors: {
    "editor.background": "#fcfdfb",
    "editor.foreground": "#111827",
    "editor.lineHighlightBackground": "#eef2ec",
    "editorLineNumber.activeForeground": "#255f75",
    "editorLineNumber.foreground": "#8b958f",
    "editorOverviewRuler.border": "#d8ded8",
    "editorUnicodeHighlight.background": "#00000000",
    "editorUnicodeHighlight.border": "#00000000",
    "editorWidget.background": "#fbfcfa",
  },
};

const bioengEditorDarkTheme: Monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "a2aaa0", fontStyle: "italic" },
    { token: "keyword", foreground: "75a8b8", fontStyle: "bold" },
    { token: "number", foreground: "d6a86f" },
    { token: "operator", foreground: "8ec3d4" },
    { token: "string", foreground: "c993d1" },
  ],
  colors: {
    "editor.background": "#0f110e",
    "editor.foreground": "#e7e9df",
    "editor.lineHighlightBackground": "#20251e",
    "editorLineNumber.activeForeground": "#75a8b8",
    "editorLineNumber.foreground": "#737d70",
    "editorOverviewRuler.border": "#30352d",
    "editorUnicodeHighlight.background": "#00000000",
    "editorUnicodeHighlight.border": "#00000000",
    "editorWidget.background": "#171a16",
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
