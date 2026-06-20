import { useEffect, useState } from "react";

import {
  draftFromServer,
  draftToInput,
  emptyDraft,
  type ServerDraft,
} from "@/features/settings/mcp-draft";
import {
  deleteMcpServer,
  listMcpServers,
  type McpServerView,
  onMcpServersChanged,
  reconnectMcpServer,
  saveMcpServer,
  toggleMcpServer,
} from "@/features/settings/mcp-service";
import { ServerForm } from "@/features/settings/McpServerForm";
import { ServerRow } from "@/features/settings/McpServerRow";
import { settingsSectionClassName } from "@/features/settings/settings-styles";
import { useAsyncResource } from "@/lib/use-async-resource";
import { AlertCircle, Button, Plus } from "@/ui";

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
