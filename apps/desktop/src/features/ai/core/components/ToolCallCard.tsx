import type { AiBlock } from "@/features/ai/core/ai-types";
import {
  safeStringify,
  type ToolCallState,
  toolPresentation,
  toolStatusLabel,
} from "@/features/ai/core/components/tool-call-presentation";
import { AlertCircle, CheckCircle2, ChevronRight, LoaderCircle } from "@/ui";
import { cx } from "@/ui/class-name";

type ToolUseBlock = Extract<AiBlock, { type: "toolUse" }>;
type ToolResultBlock = Extract<AiBlock, { type: "toolResult" }>;

export function ToolCallCard({
  result,
  toolUse,
}: {
  result?: ToolResultBlock;
  toolUse: ToolUseBlock;
}) {
  const presentation = toolPresentation(toolUse.name, toolUse.input);
  const state: ToolCallState = result
    ? result.isError
      ? "error"
      : "done"
    : "running";

  return (
    <details className="group/tool-call rounded-[6px] border border-cg-border bg-transparent text-[11px] text-cg-muted open:bg-cg-surface">
      <summary className="flex min-h-7 cursor-default list-none items-center gap-1.5 px-2 py-1 outline-none hover:bg-cg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cg-focus [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="shrink-0 transition-transform duration-150 group-open/tool-call:rotate-90"
          size={12}
          strokeWidth={1.9}
        />
        <ToolStatusIcon state={state} />
        <span className="min-w-0 shrink-0 text-[11px] font-medium leading-none text-cg-fg">
          {presentation.label}
        </span>
        {presentation.server ? (
          <span className="shrink-0 rounded-[4px] border border-cg-border bg-cg-editor px-1 py-0.5 text-[9.5px] font-semibold uppercase leading-none tracking-wide text-cg-muted">
            {presentation.server}
          </span>
        ) : null}
        {presentation.preview ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-none text-cg-muted">
            {presentation.preview}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <span
          className={cx(
            "shrink-0 text-[10px] leading-none",
            state === "done" && "text-cg-tool-ok",
            state === "error" && "text-cg-danger",
          )}
        >
          {toolStatusLabel(state)}
        </span>
      </summary>

      <div className="grid gap-1.5 border-t border-cg-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] leading-none text-cg-muted">
          <span className="font-mono">{presentation.detail}</span>
        </div>
        <ToolPayload label="input" value={safeStringify(toolUse.input, true)} />
        {result ? (
          <ToolPayload
            label={result.isError ? "error" : "result"}
            tone={result.isError ? "error" : "normal"}
            value={result.content}
          />
        ) : null}
      </div>
    </details>
  );
}

function ToolStatusIcon({ state }: { state: ToolCallState }) {
  if (state === "running") {
    return (
      <LoaderCircle
        aria-hidden="true"
        className="shrink-0 animate-spin text-cg-muted motion-reduce:animate-none"
        size={12}
        strokeWidth={1.9}
      />
    );
  }

  if (state === "error") {
    return (
      <AlertCircle
        aria-hidden="true"
        className="shrink-0 text-cg-danger"
        size={12}
        strokeWidth={1.9}
      />
    );
  }

  return (
    <CheckCircle2
      aria-hidden="true"
      className="shrink-0 text-cg-tool-ok"
      size={12}
      strokeWidth={1.9}
    />
  );
}

function ToolPayload({
  label,
  tone = "normal",
  value,
}: {
  label: string;
  tone?: "error" | "normal";
  value: string;
}) {
  return (
    <div className="grid gap-1">
      <span
        className={cx(
          "text-[10px] font-medium uppercase leading-none tracking-wide",
          tone === "error" ? "text-cg-danger" : "text-cg-muted",
        )}
      >
        {label}
      </span>
      <pre
        className={cx(
          "m-0 max-h-40 overflow-auto rounded-[5px] border border-cg-border bg-cg-editor px-2 py-1.5 font-mono text-[10.5px] leading-[1.35]",
          tone === "error" ? "text-cg-danger" : "text-cg-fg",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
