import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";

import { useEffect, useEffectEvent, useRef } from "react";

import type { TextEditorSettings } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";
import {
  configureMonaco,
  getEditorTheme,
  getTextEditorLineHeight,
} from "@/ui/editor/monaco";

export type EditorMarker = {
  message: string;
  line: number;
  column: number;
};

type SbolCodeEditorProps = {
  ariaLabel: string;
  disabled?: boolean;
  marker?: EditorMarker | null;
  modelUri: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;
  value: string;
};

const MARKER_OWNER = "sbol-editor";

/// A Monaco editor for the SQL / SPARQL workbench. SPARQL reuses the SQL
/// grammar for highlighting — close enough for keyword/string coloring without
/// a bespoke language contribution.
export function SbolCodeEditor({
  ariaLabel,
  disabled = false,
  marker,
  modelUri,
  onChange,
  onSubmit,
  resolvedTheme,
  textEditorSettings,
  value,
}: SbolCodeEditorProps) {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const suppressChangeRef = useRef(false);
  const { fontFamily, fontSize, theme } = textEditorSettings;
  const initialEditorStateRef = useRef({
    disabled,
    fontFamily,
    fontSize,
    modelUri,
    resolvedTheme,
    theme,
    value,
  });

  const emitChange = useEffectEvent(onChange);
  const emitSubmit = useEffectEvent(onSubmit);

  useEffect(() => {
    configureMonaco(monaco);

    if (!editorHostRef.current || editorRef.current) {
      return;
    }

    const initial = initialEditorStateRef.current;
    const model = monaco.editor.createModel(
      initial.value,
      "sql",
      monaco.Uri.parse(initial.modelUri),
    );
    const editor = monaco.editor.create(editorHostRef.current, {
      automaticLayout: true,
      contextmenu: false,
      cursorBlinking: "smooth",
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      lineDecorationsWidth: 12,
      lineHeight: getTextEditorLineHeight(initial.fontSize),
      lineNumbers: "on",
      minimap: { enabled: false },
      model,
      overviewRulerLanes: 0,
      padding: { bottom: 9, top: 9 },
      readOnly: initial.disabled,
      renderLineHighlight: "none",
      scrollBeyondLastLine: false,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        horizontal: "auto",
        vertical: "auto",
      },
      theme: getEditorTheme(initial.theme, initial.resolvedTheme),
      wordWrap: "on",
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      emitSubmit();
    });

    const disposable = editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) {
        return;
      }
      emitChange(editor.getValue());
    });

    editorRef.current = editor;
    modelRef.current = model;

    return () => {
      disposable.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || model.getValue() === value) {
      return;
    }
    suppressChangeRef.current = true;
    model.setValue(value);
    suppressChangeRef.current = false;
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(getEditorTheme(theme, resolvedTheme));
    editorRef.current?.updateOptions({
      fontFamily,
      fontSize,
      lineHeight: getTextEditorLineHeight(fontSize),
      readOnly: disabled,
    });
  }, [disabled, fontFamily, fontSize, resolvedTheme, theme]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) {
      return;
    }
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      marker
        ? [
            {
              endColumn: marker.column + 1,
              endLineNumber: marker.line,
              message: marker.message,
              severity: monaco.MarkerSeverity.Error,
              startColumn: marker.column,
              startLineNumber: marker.line,
            },
          ]
        : [],
    );
  }, [marker]);

  return (
    <div
      aria-label={ariaLabel}
      className="min-h-[140px] min-w-0 flex-1 overflow-hidden rounded-[7px] border border-cg-border bg-cg-editor focus-within:border-cg-focus"
      ref={editorHostRef}
    />
  );
}
