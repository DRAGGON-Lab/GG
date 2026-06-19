import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";

import { type CSSProperties, useEffect, useRef } from "react";

import "@/features/settings/styles.css";

import type { TextEditorSettings } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";
import {
  configureMonaco,
  editorUnicodeHighlightOptions,
  getEditorTheme,
  getTextEditorLineHeight,
} from "@/ui/editor/monaco";

const previewText = [
  "def fold_protein(sequence: str) -> float:",
  '    """Estimate folding free energy (kcal/mol)."""',
  "    energy = 0.0",
  "    for residue in sequence:",
  "        energy += HYDROPHOBICITY.get(residue, 0.0)",
  "    return energy",
].join("\n");

type TextEditorPreviewProps = {
  resolvedTheme: ResolvedTheme;
  settings: TextEditorSettings;
};

export function TextEditorPreview({
  resolvedTheme,
  settings,
}: TextEditorPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const { fontFamily, fontSize, theme } = settings;
  const initialEditorStateRef = useRef({
    fontFamily,
    fontSize,
    resolvedTheme,
    theme,
  });
  const previewStyle = {
    "--app-settings-preview-height": `${Math.max(
      132,
      getTextEditorLineHeight(fontSize) * 4 + 32,
    )}px`,
  } as CSSProperties;

  useEffect(() => {
    configureMonaco(monaco);

    if (!hostRef.current || editorRef.current) {
      return;
    }

    const initial = initialEditorStateRef.current;
    const model = monaco.editor.createModel(
      previewText,
      "python",
      monaco.Uri.parse("inmemory://settings/text-editor-preview.py"),
    );
    const editor = monaco.editor.create(hostRef.current, {
      automaticLayout: true,
      contextmenu: false,
      cursorBlinking: "solid",
      folding: false,
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      glyphMargin: false,
      lineDecorationsWidth: 12,
      lineHeight: getTextEditorLineHeight(initial.fontSize),
      lineNumbers: "off",
      minimap: { enabled: false },
      model,
      overviewRulerLanes: 0,
      padding: { bottom: 12, top: 12 },
      readOnly: true,
      renderLineHighlight: "none",
      scrollBeyondLastLine: false,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        horizontal: "auto",
        vertical: "hidden",
      },
      theme: getEditorTheme(initial.theme, initial.resolvedTheme),
      unicodeHighlight: editorUnicodeHighlightOptions,
      wordWrap: "off",
    });

    modelRef.current = model;
    editorRef.current = editor;

    return () => {
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(getEditorTheme(theme, resolvedTheme));
    editorRef.current?.updateOptions({
      fontFamily,
      fontSize,
      lineHeight: getTextEditorLineHeight(fontSize),
      unicodeHighlight: editorUnicodeHighlightOptions,
    });
    window.requestAnimationFrame(() => editorRef.current?.layout());
  }, [fontFamily, fontSize, resolvedTheme, theme]);

  return (
    <div
      aria-label="Text editor preview"
      className="app-settings-editor-preview mt-0.5 h-[var(--app-settings-preview-height,132px)] min-w-0 overflow-hidden rounded-[7px] border border-cg-border bg-cg-surface"
      ref={hostRef}
      style={previewStyle}
    />
  );
}
