import { useMemo } from "react";

import type { AiContextAttachmentInput } from "@/features/ai/core/ai-types";
import { AiSurface } from "@/features/ai/core/components/AiSurface";
import type { LspDiagnostic } from "@/features/editor/core/python-service";
import {
  type EditorDocument,
  useEditorPageContext,
} from "@/features/editor/editor-page-context";

/// The AI Assistant tab: the shared chat surface seeded with the live Python
/// editor context (current file, cursor line, and the active file's
/// diagnostics).
export function AssistantPanel() {
  const { activeDocument, cursorLine, diagnostics, workspaceRoot } =
    useEditorPageContext();

  const context = useMemo(
    () => [
      ...workspaceContextAttachments(workspaceRoot),
      ...pythonContextAttachments(activeDocument, cursorLine, diagnostics),
    ],
    [activeDocument, cursorLine, diagnostics, workspaceRoot],
  );
  const initialGuide = useMemo(
    () => ({
      exampleLabel: "TRY THIS",
      examplePrompt: activeDocument
        ? "Explain this file and suggest a next step."
        : "Open a Python file, then ask about the code at your cursor.",
    }),
    [activeDocument],
  );

  return (
    <AiSurface
      agentId="workspace-ai"
      compact
      contextAttachments={context}
      initialContextAttachments={context}
      initialGuide={initialGuide}
      initialTitle="Assistant"
      showContextChips={false}
      showHeader={false}
      showModeToggle
    />
  );
}

/// Tell the agent which folder is open so it can resolve the workspace-relative
/// paths its file tools take. Empty when no workspace is open — the file tools
/// then report there's nothing to operate on.
function workspaceContextAttachments(
  workspaceRoot: string | null,
): AiContextAttachmentInput[] {
  if (!workspaceRoot) {
    return [];
  }
  const name =
    workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot;
  return [
    {
      kind: "workspace",
      label: `Workspace: ${name}`,
      payload: { name, root: workspaceRoot },
    },
  ];
}

function pythonContextAttachments(
  document: EditorDocument | null,
  cursorLine: number | null,
  diagnostics: LspDiagnostic[],
): AiContextAttachmentInput[] {
  if (!document) {
    return [];
  }

  const line = cursorLine ?? 0;
  // Ship an error digest with the cursor so the model has real context without
  // tool round-trips. Deterministic truncation keeps the attachment bounded.
  const errors = diagnostics
    .filter((diagnostic) => (diagnostic.severity ?? 1) === 1)
    .slice(0, 5)
    .map((diagnostic) => ({
      line: diagnostic.range.start.line,
      message:
        diagnostic.message.length > 400
          ? `${diagnostic.message.slice(0, 400)}…`
          : diagnostic.message,
    }));

  return [
    {
      kind: "pythonDocumentCursor",
      label: `Current context: ${document.path ?? document.name}:${line + 1}`,
      payload: {
        errors,
        filePath: document.path,
        line,
        name: document.name,
        // The full buffer, so the agent can copy a verbatim snippet for the
        // `edit` tool without a tool round-trip.
        text: document.text,
        uri: document.uri,
      },
    },
  ];
}
