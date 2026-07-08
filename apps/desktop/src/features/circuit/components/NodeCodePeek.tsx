import { useEffect, useState } from "react";

import { LoicaCodeEditor } from "@/features/circuit/components/LoicaCodeEditor";
import type { TextEditorSettings } from "@/features/settings";
import { type ResolvedTheme, X } from "@/ui";

/// A centered "peek" over the canvas showing a node's editable Loica code, in
/// the spirit of Notion's center peek. Rendered outside ReactFlow's transformed
/// viewport, so Monaco lays out and maps clicks at an identity scale regardless
/// of canvas zoom. The backdrop dims the canvas; `open` drives the enter/exit.
export function NodeCodePeek({
  initialCode,
  name,
  nodeId,
  onChange,
  onClose,
  open,
  resolvedTheme,
  textEditorSettings,
}: {
  initialCode: string;
  name: string;
  nodeId: string;
  onChange: (code: string) => void;
  onClose: () => void;
  open: boolean;
  resolvedTheme: ResolvedTheme;
  textEditorSettings: TextEditorSettings;
}) {
  const [code, setCode] = useState(initialCode);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="circuit-peek-backdrop absolute inset-0 z-30 flex items-center justify-center bg-black/35"
      data-open={open}
      onPointerDown={onClose}
    >
      <div
        className="circuit-peek-panel flex h-[min(520px,78%)] w-[min(720px,88%)] flex-col overflow-hidden rounded-xl border border-cg-border bg-cg-surface shadow-2xl"
        data-open={open}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-cg-border px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[12px] font-medium text-cg-fg">
              {name}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-cg-muted">
              Loica
            </span>
          </div>
          <button
            aria-label="Close"
            className="flex size-6 items-center justify-center rounded-[5px] border-none bg-transparent text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg"
            onClick={onClose}
            title="Close (Esc)"
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 p-2">
          <LoicaCodeEditor
            ariaLabel={`Loica code for ${name}`}
            modelUri={`inmemory://circuit-peek/${nodeId}.py`}
            onChange={(next) => {
              setCode(next);
              onChange(next);
            }}
            resolvedTheme={resolvedTheme}
            textEditorSettings={textEditorSettings}
            value={code}
          />
        </div>
      </div>
    </div>
  );
}
