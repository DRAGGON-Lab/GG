import type { ServerDraft } from "@/features/settings/mcp-draft";
import { compactButtonClassName } from "@/features/settings/McpServerRow";
import {
  settingsFieldClassName,
  settingsInputClassName,
} from "@/features/settings/settings-styles";
import { AlertCircle, Blocks, Button, LoaderCircle } from "@/ui";

const textareaClassName =
  "min-h-[64px] w-full min-w-0 resize-y rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

export function ServerForm({
  busy,
  draft,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  draft: ServerDraft;
  onCancel: () => void;
  onChange: (draft: ServerDraft) => void;
  onSave: () => void;
}) {
  const isStdio = draft.transport === "stdio";
  const canSave =
    draft.name.trim().length > 0 &&
    (isStdio ? draft.command.trim().length > 0 : draft.url.trim().length > 0);

  return (
    <div className="grid min-w-0 gap-3 rounded-[7px] border border-cg-border bg-cg-surface p-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 [@container(max-width:520px)]:gap-2.5">
        <label className={settingsFieldClassName}>
          <span>Name</span>
          <input
            aria-label="Server name"
            autoComplete="off"
            className={settingsInputClassName}
            onChange={(event) =>
              onChange({ ...draft, name: event.currentTarget.value })
            }
            placeholder="arxiv"
            spellCheck={false}
            type="text"
            value={draft.name}
          />
        </label>
        <fieldset className={settingsFieldClassName}>
          <span>Transport</span>
          <div className="flex h-8 items-center gap-3">
            {(["stdio", "http"] as const).map((transport) => (
              <label
                className="flex items-center gap-1.5 text-[12.5px] font-semibold leading-none text-cg-fg"
                key={transport}
              >
                <input
                  checked={draft.transport === transport}
                  className="size-3.5 accent-cg-focus"
                  name="mcp-transport"
                  onChange={() => onChange({ ...draft, transport })}
                  type="radio"
                />
                <span>
                  {transport === "stdio" ? "Local (stdio)" : "Remote (HTTP)"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {isStdio ? (
        <>
          <label className={settingsFieldClassName}>
            <span>Command</span>
            <input
              aria-label="Command"
              autoComplete="off"
              className={settingsInputClassName}
              onChange={(event) =>
                onChange({ ...draft, command: event.currentTarget.value })
              }
              placeholder="npx"
              spellCheck={false}
              type="text"
              value={draft.command}
            />
          </label>
          <label className={settingsFieldClassName}>
            <span>Arguments (space-separated)</span>
            <input
              aria-label="Arguments"
              autoComplete="off"
              className={settingsInputClassName}
              onChange={(event) =>
                onChange({ ...draft, argsText: event.currentTarget.value })
              }
              placeholder="-y arxiv-mcp-server"
              spellCheck={false}
              type="text"
              value={draft.argsText}
            />
          </label>
          <label className={settingsFieldClassName}>
            <span>Environment (KEY=value per line)</span>
            <textarea
              aria-label="Environment variables"
              className={textareaClassName}
              onChange={(event) =>
                onChange({ ...draft, envText: event.currentTarget.value })
              }
              placeholder="API_KEY=..."
              spellCheck={false}
              value={draft.envText}
            />
          </label>
        </>
      ) : (
        <>
          <label className={settingsFieldClassName}>
            <span>URL</span>
            <input
              aria-label="Server URL"
              autoComplete="off"
              className={settingsInputClassName}
              onChange={(event) =>
                onChange({ ...draft, url: event.currentTarget.value })
              }
              placeholder="https://example.com/mcp"
              spellCheck={false}
              type="text"
              value={draft.url}
            />
          </label>
          <label className={settingsFieldClassName}>
            <span>Headers (Name: value per line)</span>
            <textarea
              aria-label="HTTP headers"
              className={textareaClassName}
              onChange={(event) =>
                onChange({ ...draft, headersText: event.currentTarget.value })
              }
              placeholder="Authorization: Bearer ..."
              spellCheck={false}
              value={draft.headersText}
            />
          </label>
        </>
      )}

      <label className="flex min-w-0 items-start gap-2 text-[11.5px] font-semibold leading-snug text-cg-fg">
        <input
          checked={draft.autoAllowTools}
          className="mt-0.5 size-3.5 flex-none accent-cg-focus"
          onChange={(event) =>
            onChange({ ...draft, autoAllowTools: event.currentTarget.checked })
          }
          type="checkbox"
        />
        <span>Allow this server's tools to run without asking each time</span>
      </label>

      <div className="flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-border bg-cg-editor px-2.5 py-2 text-[11px] leading-snug text-cg-muted">
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 flex-none"
          size={13}
          strokeWidth={1.8}
        />
        <span className="min-w-0">
          {isStdio
            ? "A local server runs the command above on this machine. Only add servers you trust."
            : "Headers and environment values are stored unencrypted in the local database."}
        </span>
      </div>

      <div className="flex min-w-0 justify-end gap-2">
        <Button
          className={compactButtonClassName}
          disabled={busy}
          onClick={onCancel}
          size="none"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          className={compactButtonClassName}
          disabled={busy || !canSave}
          onClick={onSave}
          size="none"
          variant="default"
        >
          {busy ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
              size={13}
              strokeWidth={1.8}
            />
          ) : (
            <Blocks aria-hidden="true" size={13} strokeWidth={1.8} />
          )}
          {draft.id ? "Save Server" : "Add Server"}
        </Button>
      </div>
    </div>
  );
}
