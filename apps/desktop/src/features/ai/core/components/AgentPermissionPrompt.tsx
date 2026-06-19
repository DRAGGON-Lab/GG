import { PermissionBehavior, type PermissionPrompt } from "@protocol";

import {
  safeStringify,
  toolPresentation,
} from "@/features/ai/core/components/tool-call-presentation";
import { AlertCircle, Button } from "@/ui";

export function AgentPermissionPrompt({
  onRespond,
  prompt,
}: {
  onRespond: (behavior: PermissionBehavior) => void;
  prompt: PermissionPrompt;
}) {
  const presentation = toolPresentation(prompt.toolName, prompt.input);

  return (
    <div className="grid gap-2 rounded-[6px] border border-cg-accent bg-cg-surface px-2.5 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-cg-accent"
          size={14}
          strokeWidth={1.9}
        />
        <div className="grid min-w-0 gap-1">
          <div className="text-[12px] font-medium leading-snug text-cg-fg">
            Allow {presentation.label}
            {presentation.server ? (
              <span className="text-cg-muted"> · {presentation.server}</span>
            ) : null}
          </div>
          <div className="min-w-0 truncate font-mono text-[10.5px] leading-none text-cg-muted">
            {presentation.preview || presentation.detail}
          </div>
        </div>
      </div>
      <pre className="m-0 max-h-28 overflow-auto rounded-[5px] border border-cg-border bg-cg-editor px-2 py-1.5 font-mono text-[10.5px] leading-[1.35] text-cg-muted">
        {safeStringify(prompt.input, true)}
      </pre>
      <div className="flex justify-end gap-1.5">
        <Button
          onClick={() => onRespond(PermissionBehavior.Deny)}
          size="sm"
          variant="ghost"
        >
          Deny
        </Button>
        <Button
          onClick={() => onRespond(PermissionBehavior.Allow)}
          size="sm"
          variant="default"
        >
          Allow
        </Button>
      </div>
    </div>
  );
}
