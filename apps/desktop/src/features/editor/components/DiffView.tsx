import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { type ReactNode, useEffect, useRef } from "react";

import type { CheckpointFileDiff } from "@/features/editor/core/history-service";
import { configurePythonMonaco } from "@/features/editor/core/monaco-python";
import type { TextEditorSettings } from "@/features/settings";
import { LoaderCircle, type ResolvedTheme } from "@/ui";
import {
  editorUnicodeHighlightOptions,
  getEditorTheme,
  getTextEditorLineHeight,
} from "@/ui/editor/monaco";

type DiffViewProps = {
  /// The "before" side. Pass "" for an added file (the whole file reads as new).
  original: string;
  /// The "after" side. Pass "" for a deleted file (the whole file reads as gone).
  modified: string;
  /// Worktree-relative path; drives the model filename + language pick.
  path: string;
  /// Side-by-side (true) vs. inline/unified (false).
  sideBySide: boolean;
  resolvedTheme: ResolvedTheme;
  settings: TextEditorSettings;
};

// Monaco models are keyed globally by URI, so each view instance needs its own
// namespace and each (re)bind a fresh version — disposing the previous models
// only after the new ones are attached avoids a same-URI collision.
let diffInstanceCounter = 0;

/// A read-only Monaco diff editor that reuses the Python language registration
/// and editor theme, so diffs render with the exact syntax highlighting, font,
/// and colors as the main editor. Used by the review surface and past-checkpoint
/// diff tabs.
export function DiffView({
  original,
  modified,
  path,
  sideBySide,
  resolvedTheme,
  settings,
}: DiffViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const instanceIdRef = useRef<number>(diffInstanceCounter++);
  const bindVersionRef = useRef(0);
  const { fontFamily, fontSize, theme } = settings;
  const initialEditorStateRef = useRef({
    fontFamily,
    fontSize,
    resolvedTheme,
    sideBySide,
    theme,
  });

  useEffect(() => {
    configurePythonMonaco(monaco);

    if (!hostRef.current || editorRef.current) {
      return;
    }

    const initial = initialEditorStateRef.current;
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      automaticLayout: true,
      contextmenu: false,
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      ignoreTrimWhitespace: false,
      lineHeight: getTextEditorLineHeight(initial.fontSize),
      minimap: { enabled: false },
      originalEditable: false,
      readOnly: true,
      renderOverviewRuler: false,
      renderSideBySide: initial.sideBySide,
      scrollBeyondLastLine: false,
      theme: getEditorTheme(initial.theme, initial.resolvedTheme),
      unicodeHighlight: editorUnicodeHighlightOptions,
    });
    editorRef.current = editor;

    return () => {
      editor.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      editorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, []);

  // Rebind models whenever the diff content or file changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const previousOriginal = originalModelRef.current;
    const previousModified = modifiedModelRef.current;
    const version = (bindVersionRef.current += 1);
    const language = languageForPath(path);
    const base = `inmemory://history/${instanceIdRef.current}/${version}`;
    const originalModel = monaco.editor.createModel(
      original,
      language,
      monaco.Uri.parse(`${base}/original`),
    );
    const modifiedModel = monaco.editor.createModel(
      modified,
      language,
      monaco.Uri.parse(`${base}/modified`),
    );

    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    editor.setModel({ modified: modifiedModel, original: originalModel });

    previousOriginal?.dispose();
    previousModified?.dispose();
  }, [modified, original, path]);

  // Keep theme, font, and layout in sync with settings.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    monaco.editor.setTheme(getEditorTheme(theme, resolvedTheme));
    editor.updateOptions({
      fontFamily,
      fontSize,
      lineHeight: getTextEditorLineHeight(fontSize),
      renderSideBySide: sideBySide,
    });
    window.requestAnimationFrame(() => editor.layout());
  }, [fontFamily, fontSize, resolvedTheme, sideBySide, theme]);

  return (
    <div
      aria-label={`Diff of ${path}`}
      className="h-full min-h-0 min-w-0 overflow-hidden bg-cg-editor"
      ref={hostRef}
    />
  );
}

const PYTHON_EXTENSIONS = /\.(py|pyi)$/i;

function languageForPath(path: string) {
  return PYTHON_EXTENSIONS.test(path) ? "python" : "plaintext";
}

/// Split (side-by-side) vs. unified diff layout.
export function DiffLayoutToggle({
  sideBySide,
  onChange,
}: {
  sideBySide: boolean;
  onChange: (sideBySide: boolean) => void;
}) {
  return (
    <div className="flex flex-none items-center gap-0.5 rounded-[6px] border border-cg-border bg-cg-editor p-0.5">
      {(
        [
          ["Split", true],
          ["Unified", false],
        ] as const
      ).map(([label, value]) => (
        <button
          className="cursor-pointer rounded-[4px] border-none bg-transparent px-1.5 py-0.5 font-[inherit] text-[10.5px] font-semibold text-cg-muted transition-colors duration-150 ease-out hover:text-cg-fg data-[active=true]:bg-cg-surface-hover data-[active=true]:text-cg-fg motion-reduce:transition-none"
          data-active={sideBySide === value}
          key={label}
          onClick={() => onChange(value)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const DIFF_STATUS_STYLES: Record<string, { label: string; className: string }> =
  {
    added: { label: "Added", className: "text-cg-success" },
    modified: { label: "Modified", className: "text-cg-warning" },
    deleted: { label: "Deleted", className: "text-cg-danger" },
    unchanged: { label: "No changes", className: "text-cg-muted" },
  };

function statusBadge(status: string) {
  return DIFF_STATUS_STYLES[status] ?? DIFF_STATUS_STYLES.modified;
}

/// Header (filename + status + layout toggle) over a [`DiffView`], with
/// loading/error/no-change fallbacks. The toggle state is owned by the parent
/// so it persists as the focused file changes.
export function DiffSurface({
  path,
  diff,
  error,
  loading,
  sideBySide,
  onSideBySideChange,
  resolvedTheme,
  settings,
}: {
  path: string;
  diff: CheckpointFileDiff | null;
  error?: string | null;
  loading?: boolean;
  sideBySide: boolean;
  onSideBySideChange: (sideBySide: boolean) => void;
  resolvedTheme: ResolvedTheme;
  settings: TextEditorSettings;
}) {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const badge = diff ? statusBadge(diff.status) : null;
  const unchanged =
    diff != null && diff.status !== "deleted" && diff.before === diff.after;

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-cg-editor">
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-cg-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span
            className="min-w-0 truncate font-mono text-[12px] text-cg-fg"
            title={path}
          >
            {fileName}
          </span>
          {badge ? (
            <span
              className={`flex-none text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}
            >
              {badge.label}
            </span>
          ) : null}
        </div>
        <DiffLayoutToggle
          onChange={onSideBySideChange}
          sideBySide={sideBySide}
        />
      </header>

      <div className="min-h-0 min-w-0">
        {error ? (
          <DiffMessage tone="danger">{error}</DiffMessage>
        ) : loading || !diff ? (
          <DiffMessage>
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin text-cg-muted motion-reduce:animate-none"
              size={16}
              strokeWidth={1.8}
            />
            Loading changes…
          </DiffMessage>
        ) : unchanged ? (
          <DiffMessage>No changes in this file.</DiffMessage>
        ) : (
          <DiffView
            modified={diff.after ?? ""}
            original={diff.before ?? ""}
            path={path}
            resolvedTheme={resolvedTheme}
            settings={settings}
            sideBySide={sideBySide}
          />
        )}
      </div>
    </section>
  );
}

function DiffMessage({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="grid h-full place-items-center bg-cg-editor px-6">
      <p
        className={`m-0 flex max-w-[320px] items-center gap-2 text-center text-[12px] leading-snug ${
          tone === "danger" ? "text-cg-danger" : "text-cg-muted"
        }`}
      >
        {children}
      </p>
    </div>
  );
}
