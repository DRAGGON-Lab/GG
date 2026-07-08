import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {
  canFormatOnSave,
  languageForName,
} from "@/features/editor/core/editor-language";
import type { TextEditorSettings } from "@/features/settings";

/// Reformat a document's buffer with its language formatter ahead of a save,
/// when format-on-save is enabled and the language is supported. The edit is
/// applied to the live Monaco model (via `editor.action.formatDocument`), so it
/// is a single undoable change and the buffer stays in sync with what gets
/// written to disk. No-ops when disabled, unsupported, or when no editor hosts
/// the document's model. Callers read the formatted text back from the model or
/// editor after awaiting this.
export async function runFormatOnSave(
  monaco: typeof Monaco,
  uri: string,
  name: string,
  settings: TextEditorSettings,
): Promise<void> {
  if (!settings.formatOnSave || !canFormatOnSave(languageForName(name))) {
    return;
  }

  const editor = monaco.editor
    .getEditors()
    .find((candidate) => candidate.getModel()?.uri.toString() === uri);

  await editor?.getAction("editor.action.formatDocument")?.run();
}
