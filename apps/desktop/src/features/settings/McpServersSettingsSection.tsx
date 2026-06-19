import { useEffect, useState } from "react";

import {
  deleteMcpServer,
  listMcpServers,
  type McpServerInput,
  type McpServerStatus,
  type McpServerView,
  type McpTransport,
  onMcpServersChanged,
  reconnectMcpServer,
  saveMcpServer,
  toggleMcpServer,
} from "@/features/settings/mcp-service";
import { useAsyncResource } from "@/lib/use-async-resource";
import {
  AlertCircle,
  Blocks,
  Button,
  ChevronRight,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "@/ui";

const settingsSectionClassName =
  "grid max-w-[760px] gap-3.5 [@container(max-width:520px)]:gap-3";

const settingsFieldClassName =
  "grid gap-[7px] [&>span]:text-[11px] [&>span]:font-bold [&>span]:leading-none [&>span]:text-cg-muted";

const settingsInputClassName =
  "h-8 w-full min-w-0 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 font-[inherit] text-[13px] leading-none text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

const textareaClassName =
  "min-h-[64px] w-full min-w-0 resize-y rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

const compactButtonClassName = "h-7 rounded-[6px] px-2 text-[11.5px]";

type ServerDraft = {
  id: string | null;
  name: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  autoAllowTools: boolean;
};

function emptyDraft(): ServerDraft {
  return {
    id: null,
    name: "",
    transport: "stdio",
    command: "",
    argsText: "",
    envText: "",
    url: "",
    headersText: "",
    autoAllowTools: false,
  };
}

function draftFromServer(server: McpServerView): ServerDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    argsText: server.args.join(" "),
    envText: pairsToText(server.env, "="),
    url: server.url,
    headersText: pairsToText(server.headers, ": "),
    autoAllowTools: server.autoAllowTools,
  };
}

export function McpServersSettingsSection() {
  const [revision, setRevision] = useState(0);
  const serversResource = useAsyncResource(`mcp:${revision}`, () =>
    listMcpServers(),
  );
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const servers = serversResource.data ?? [];
  const status = serversResource.loading
    ? "Loading"
    : busy
      ? "Working"
      : error || serversResource.error
        ? "Server Error"
        : servers.length > 0
          ? `${servers.length} ${servers.length === 1 ? "server" : "servers"}`
          : "None";

  function refresh() {
    setRevision((revision) => revision + 1);
  }

  useEffect(() => {
    const unlisten = onMcpServersChanged(refresh);
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  async function applyServerList(action: Promise<McpServerView[]>) {
    setBusy(true);
    setError(null);
    setConfirmingDelete(null);
    try {
      await action;
      refresh();
      return true;
    } catch (error) {
      setError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!draft) {
      return;
    }
    const input = draftToInput(draft);
    if (await applyServerList(saveMcpServer(input))) {
      setDraft(null);
    }
  }

  return (
    <section
      className={`${settingsSectionClassName} mb-6`}
      aria-labelledby="mcp-servers"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5 [@container(max-width:520px)]:items-start [@container(max-width:520px)]:gap-2 [@container(max-width:520px)]:self-start [@container(max-width:520px)]:flex-col">
        <h2
          className="m-0 text-[14px] font-bold leading-none text-cg-fg"
          id="mcp-servers"
        >
          MCP Servers
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex-none text-[11px] font-semibold leading-none text-cg-muted [&[data-error]]:text-cg-danger"
            data-error={error || serversResource.error ? "" : undefined}
          >
            {status}
          </span>
          <Button
            aria-label="Add MCP server"
            className="size-7 rounded-[6px] p-0"
            disabled={busy || draft !== null}
            onClick={() => {
              setError(null);
              setDraft(emptyDraft());
            }}
            size="none"
            title="Add MCP server"
            variant="ghost"
          >
            <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
          </Button>
        </div>
      </header>

      <p className="m-0 text-[11.5px] leading-relaxed text-cg-muted">
        Connect Model Context Protocol servers to give the workspace agent extra
        tools, for example a sequence database or a protein-structure predictor.
        The agent asks before each call unless you allow a server's tools below.
      </p>

      <div className="grid gap-1.5">
        {servers.length === 0 && !draft ? (
          <div className="grid min-w-0 gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2">
            <div className="text-[12.5px] font-bold leading-tight text-cg-fg">
              No MCP servers
            </div>
            <div className="text-[11.5px] font-medium leading-snug text-cg-muted">
              Add a server to extend what the agent can do.
            </div>
          </div>
        ) : (
          servers.map((server) => (
            <ServerRow
              busy={busy}
              confirmingDelete={confirmingDelete === server.id}
              key={server.id}
              onDelete={(id) => {
                if (confirmingDelete !== id) {
                  setConfirmingDelete(id);
                  return;
                }
                void applyServerList(deleteMcpServer(id));
              }}
              onEdit={(server) => {
                setError(null);
                setConfirmingDelete(null);
                setDraft(draftFromServer(server));
              }}
              onReconnect={(id) => void applyServerList(reconnectMcpServer(id))}
              onToggleEnabled={(id, enabled) =>
                void applyServerList(toggleMcpServer(id, enabled))
              }
              server={server}
            />
          ))
        )}
      </div>

      {draft ? (
        <ServerForm
          busy={busy}
          draft={draft}
          onCancel={() => {
            setError(null);
            setDraft(null);
          }}
          onChange={setDraft}
          onSave={handleSave}
        />
      ) : null}

      {error || serversResource.error ? (
        <div className="flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-danger/35 bg-cg-danger/10 px-2.5 py-2 text-[11.5px] leading-snug text-cg-danger">
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 flex-none"
            size={14}
            strokeWidth={1.8}
          />
          <span className="min-w-0">{error ?? serversResource.error}</span>
        </div>
      ) : null}
    </section>
  );
}

function ServerRow({
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

function ServerForm({
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

function draftToInput(draft: ServerDraft): McpServerInput {
  const isStdio = draft.transport === "stdio";
  return {
    id: draft.id ?? undefined,
    name: draft.name.trim(),
    transport: draft.transport,
    command: isStdio ? draft.command.trim() : "",
    args: isStdio ? draft.argsText.split(/\s+/).filter(Boolean) : [],
    env: isStdio ? parsePairs(draft.envText, "=") : {},
    url: isStdio ? "" : draft.url.trim(),
    headers: isStdio ? {} : parsePairs(draft.headersText, ":"),
    autoAllowTools: draft.autoAllowTools,
  };
}

function parsePairs(text: string, separator: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const index = trimmed.indexOf(separator);
    if (index <= 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + separator.length).trim();
    if (key) {
      pairs[key] = value;
    }
  }
  return pairs;
}

function pairsToText(pairs: Record<string, string>, separator: string) {
  return Object.entries(pairs)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
