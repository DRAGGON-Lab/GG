import type {
  McpServerStatus,
  McpServerView,
} from "@/features/settings/mcp-service";
import { Button, ChevronRight, RotateCcw, Trash2 } from "@/ui";

export const compactButtonClassName = "h-7 rounded-[6px] px-2 text-[11.5px]";

export function ServerRow({
  busy,
  confirmingDelete,
  onDelete,
  onEdit,
  onReconnect,
  onToggleEnabled,
  server,
}: {
  busy: boolean;
  confirmingDelete: boolean;
  onDelete: (id: string) => void;
  onEdit: (server: McpServerView) => void;
  onReconnect: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  server: McpServerView;
}) {
  const target =
    server.transport === "stdio"
      ? [server.command, ...server.args].join(" ").trim()
      : server.url;

  return (
    <details className="group/mcp min-w-0 rounded-[7px] border border-cg-border bg-cg-surface">
      <summary className="flex min-h-9 cursor-default list-none items-center gap-2 px-2.5 py-2 outline-none hover:bg-cg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cg-focus [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="shrink-0 text-cg-muted transition-transform duration-150 group-open/mcp:rotate-90"
          size={13}
          strokeWidth={1.9}
        />
        <StatusDot status={server.status} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] font-bold leading-tight text-cg-fg">
              {server.name}
            </span>
            <span className="flex-none rounded-[4px] border border-cg-border bg-cg-editor px-1 py-0.5 text-[9.5px] font-semibold uppercase leading-none tracking-wide text-cg-muted">
              {server.transport}
            </span>
          </div>
          <div className="truncate text-[10.5px] font-semibold leading-tight text-cg-muted">
            {statusDetail(server)}
          </div>
        </div>
        <label
          className="flex flex-none items-center gap-1.5 text-[11px] font-semibold leading-none text-cg-muted"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            checked={server.enabled}
            className="size-3.5 accent-cg-focus"
            disabled={busy}
            onChange={(event) =>
              onToggleEnabled(server.id, event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span>Enabled</span>
        </label>
      </summary>

      <div className="grid gap-2 border-t border-cg-border px-2.5 py-2">
        <div className="min-w-0 break-words font-mono text-[10.5px] leading-snug text-cg-muted">
          {target}
        </div>
        {server.status.state === "error" ? (
          <div className="min-w-0 break-words text-[11px] leading-snug text-cg-danger">
            {server.status.message}
          </div>
        ) : null}
        {server.tools.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-1">
            {server.tools.map((tool) => (
              <span
                className="rounded-[4px] border border-cg-border bg-cg-editor px-1.5 py-0.5 font-mono text-[10px] leading-none text-cg-muted"
                key={tool}
              >
                {tool}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="text-[11px] font-semibold leading-tight text-cg-muted">
            {server.autoAllowTools
              ? "Tools run without asking"
              : "Agent asks before each tool"}
          </span>
          <div className="flex flex-none items-center gap-1">
            <Button
              className={compactButtonClassName}
              disabled={busy}
              onClick={() => onReconnect(server.id)}
              size="none"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
              Reconnect
            </Button>
            <Button
              className={compactButtonClassName}
              disabled={busy}
              onClick={() => onEdit(server)}
              size="none"
              variant="ghost"
            >
              Edit
            </Button>
            <Button
              aria-label={
                confirmingDelete
                  ? `Confirm deleting ${server.name}`
                  : `Delete ${server.name}`
              }
              className={
                confirmingDelete
                  ? `${compactButtonClassName} text-cg-danger`
                  : "size-7 rounded-[6px] p-0"
              }
              disabled={busy}
              onClick={() => onDelete(server.id)}
              size="none"
              title={confirmingDelete ? "Click again to delete" : "Delete"}
              variant="ghost"
            >
              <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
              {confirmingDelete ? "Confirm" : null}
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}

function StatusDot({ status }: { status: McpServerStatus }) {
  const tone =
    status.state === "connected"
      ? "bg-cg-success"
      : status.state === "connecting"
        ? "bg-cg-accent"
        : status.state === "error"
          ? "bg-cg-danger"
          : "bg-cg-muted";
  return (
    <span
      aria-hidden="true"
      className={`size-2 flex-none rounded-full ${tone} ${
        status.state === "connecting"
          ? "animate-pulse motion-reduce:animate-none"
          : ""
      }`}
    />
  );
}

function statusDetail(server: McpServerView) {
  switch (server.status.state) {
    case "connected":
      return `Connected · ${server.status.toolCount} ${
        server.status.toolCount === 1 ? "tool" : "tools"
      }`;
    case "connecting":
      return "Connecting…";
    case "error":
      return "Connection failed";
    case "disabled":
      return "Disabled";
  }
}
