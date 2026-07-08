import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";

import { useEffect, useEffectEvent, useRef } from "react";

import type { TextEditorSettings } from "@/features/settings";
import type { ResolvedTheme } from "@/ui";
import {
  configureMonaco,
  getEditorTheme,
  getTextEditorLineHeight,
} from "@/ui/editor/monaco";

type LoicaCodeEditorProps = {
  ariaLabel: string;
  lineNumbers?: boolean;
  modelUri: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;
  value: string;
};

/// A Monaco editor configured for Loica Python — used for the per-node snippet
/// editor and the read-only generated-script view.
export function LoicaCodeEditor({
  ariaLabel,
  lineNumbers = true,
  modelUri,
  onChange,
  readOnly = false,
  resolvedTheme,
  textEditorSettings,
  value,
}: LoicaCodeEditorProps) {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const suppressChangeRef = useRef(false);
  const { fontFamily, fontSize, theme } = textEditorSettings;
  const initialRef = useRef({
    fontFamily,
    fontSize,
    lineNumbers,
    modelUri,
    readOnly,
    resolvedTheme,
    theme,
    value,
  });

  const emitChange = useEffectEvent((next: string) => onChange?.(next));

  useEffect(() => {
    configureMonaco(monaco);

    if (!editorHostRef.current || editorRef.current) {
      return;
    }

    const initial = initialRef.current;
    const model = monaco.editor.createModel(
      initial.value,
      "python",
      monaco.Uri.parse(initial.modelUri),
    );
    const editor = monaco.editor.create(editorHostRef.current, {
      automaticLayout: true,
      contextmenu: false,
      cursorBlinking: "smooth",
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      lineDecorationsWidth: 8,
      lineHeight: getTextEditorLineHeight(initial.fontSize),
      lineNumbers: initial.lineNumbers ? "on" : "off",
      minimap: { enabled: false },
      model,
      overviewRulerLanes: 0,
      padding: { bottom: 8, top: 8 },
      readOnly: initial.readOnly,
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
      lineNumbers: lineNumbers ? "on" : "off",
      readOnly,
    });
  }, [fontFamily, fontSize, lineNumbers, readOnly, resolvedTheme, theme]);

  return (
    <div
      aria-label={ariaLabel}
      className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-[7px] border border-cg-border bg-cg-editor focus-within:border-cg-focus"
      ref={editorHostRef}
    />
  );
}
