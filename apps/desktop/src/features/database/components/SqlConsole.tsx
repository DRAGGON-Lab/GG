import { useCallback, useState } from "react";

import { ConfirmDialog } from "@/features/database/components/ConfirmDialog";
import { DataGrid } from "@/features/database/components/DataGrid";
import { SqlCodeEditor } from "@/features/database/components/SqlCodeEditor";
import {
  formatDuration,
  formatRowCount,
  resultToCsv,
  resultToJson,
} from "@/features/database/core/cell-format";
import {
  appendQueryHistory,
  clearQueryHistory,
  readQueryHistory,
  runDatabaseQuery,
} from "@/features/database/core/database-service";
import type { QueryHistoryEntry, QueryResult } from "@/features/database/types";
import type { TextEditorSettings } from "@/features/settings";
import {
  AlertCircle,
  Button,
  History,
  IconButton,
  Lock,
  LockOpen,
  Play,
  type ResolvedTheme,
} from "@/ui";
import { cx } from "@/ui/class-name";

const QUERY_MAX_ROWS = 500;

type SqlConsoleProps = {
  onDidWrite: () => void;
  onSqlChange: (value: string) => void;
  resolvedTheme: ResolvedTheme;
  sql: string;
  textEditorSettings: TextEditorSettings;
};

export function SqlConsole({
  onDidWrite,
  onSqlChange,
  resolvedTheme,
  sql,
  textEditorSettings,
}: SqlConsoleProps) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [writeMode, setWriteMode] = useState(false);
  const [confirmWriteOpen, setConfirmWriteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>(readQueryHistory);
  const [copied, setCopied] = useState<"csv" | "json" | null>(null);

  const runQuery = useCallback(() => {
    const trimmed = sql.trim();
    if (!trimmed || running) {
      return;
    }

    setRunning(true);
    setError(null);
    const startedAt = performance.now();

    runDatabaseQuery({
      allowWrites: writeMode,
      maxRows: QUERY_MAX_ROWS,
      sql: trimmed,
    })
      .then((queryResult) => {
        setResult(queryResult);
        setHistory(
          appendQueryHistory({
            durationMs: queryResult.durationMs,
            ok: true,
            ranAt: Date.now(),
            sql: trimmed,
          }),
        );
        if (
          queryResult.rowsAffected > 0 ||
          queryResult.lastInsertRowid !== null
        ) {
          onDidWrite();
        }
      })
      .catch((queryError: unknown) => {
        setResult(null);
        setError(
          queryError instanceof Error ? queryError.message : String(queryError),
        );
        setHistory(
          appendQueryHistory({
            durationMs: performance.now() - startedAt,
            ok: false,
            ranAt: Date.now(),
            sql: trimmed,
          }),
        );
      })
      .finally(() => {
        setRunning(false);
      });
  }, [onDidWrite, running, sql, writeMode]);

  function copyResult(format: "csv" | "json") {
    if (!result) {
      return;
    }

    void navigator.clipboard
      .writeText(format === "csv" ? resultToCsv(result) : resultToJson(result))
      .then(() => {
        setCopied(format);
        window.setTimeout(() => setCopied(null), 1600);
      });
  }

  return (
    <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2.5">
      <SqlCodeEditor
        disabled={running}
        onChange={onSqlChange}
        onSubmit={runQuery}
        resolvedTheme={resolvedTheme}
        textEditorSettings={textEditorSettings}
        value={sql}
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button disabled={running || sql.trim() === ""} onClick={runQuery}>
          <Play aria-hidden="true" size={13} strokeWidth={2} />
          Run
          <kbd className="font-sans text-[10.5px] font-bold opacity-70">⌘↵</kbd>
        </Button>

        <Button
          className={cx(
            writeMode
              ? "border-cg-danger bg-transparent text-cg-danger hover:border-cg-danger hover:bg-transparent hover:text-cg-danger"
              : undefined,
          )}
          onClick={() => {
            if (writeMode) {
              setWriteMode(false);
            } else {
              setConfirmWriteOpen(true);
            }
          }}
          variant="subtle"
        >
          {writeMode ? (
            <LockOpen aria-hidden="true" size={13} strokeWidth={1.9} />
          ) : (
            <Lock aria-hidden="true" size={13} strokeWidth={1.9} />
          )}
          {writeMode ? "Write mode" : "Read-only"}
        </Button>

        <IconButton
          className={cx(historyOpen ? "bg-cg-surface-hover" : undefined)}
          label="Query history"
          onClick={() => setHistoryOpen((open) => !open)}
          variant="ghost"
        >
          <History aria-hidden="true" size={14} strokeWidth={1.9} />
        </IconButton>

        <span
          aria-live="polite"
          className="min-w-0 truncate text-[12px] text-cg-muted"
        >
          {running
            ? "Running…"
            : result
              ? resultStatusText(result)
              : "Statements run read-only unless write mode is enabled."}
        </span>

        {result && result.columns.length > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Button onClick={() => copyResult("csv")} size="sm" variant="ghost">
              {copied === "csv" ? "Copied" : "Copy CSV"}
            </Button>
            <Button
              onClick={() => copyResult("json")}
              size="sm"
              variant="ghost"
            >
              {copied === "json" ? "Copied" : "Copy JSON"}
            </Button>
          </span>
        ) : null}
      </div>

      <div
        className={cx(
          "grid min-h-0 min-w-0 gap-2.5",
          historyOpen
            ? "grid-cols-[minmax(0,1fr)_240px]"
            : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
          {error ? (
            <div className="flex items-start gap-2 self-start rounded-[7px] border border-cg-danger px-3 py-2.5 text-[12.5px] leading-relaxed text-cg-danger">
              <AlertCircle
                aria-hidden="true"
                className="mt-[1px] shrink-0"
                size={14}
                strokeWidth={1.9}
              />
              <span className="min-w-0 break-words font-mono">{error}</span>
            </div>
          ) : result && result.columns.length > 0 ? (
            <DataGrid
              emptyMessage="The statement returned no rows."
              result={result}
            />
          ) : result ? (
            <div className="grid place-items-center rounded-[7px] border border-dashed border-cg-border px-4 py-10 text-center text-[12.5px] leading-relaxed text-cg-muted">
              Statement completed — {resultStatusText(result)}.
            </div>
          ) : (
            <div className="grid place-items-center rounded-[7px] border border-dashed border-cg-border px-4 py-10 text-center text-[12.5px] leading-relaxed text-cg-muted">
              Run a statement to see results here. Multiple statements are
              supported in write mode; results show the last statement's rows.
            </div>
          )}
        </div>

        {historyOpen ? (
          <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1.5 overflow-hidden rounded-[7px] border border-cg-border bg-cg-sidebar">
            <header className="flex items-center justify-between gap-2 border-b border-cg-border px-2.5 py-2">
              <span className="text-[11px] font-bold text-cg-muted">
                History
              </span>
              <Button
                disabled={history.length === 0}
                onClick={() => setHistory(clearQueryHistory())}
                size="sm"
                variant="ghost"
              >
                Clear
              </Button>
            </header>
            <div className="min-h-0 overflow-auto px-1.5 pb-1.5">
              {history.length === 0 ? (
                <div className="px-2 py-4 text-center text-[11.5px] text-cg-muted">
                  Queries you run appear here.
                </div>
              ) : (
                history.map((entry) => (
                  <button
                    className="grid w-full cursor-default gap-1 rounded-[5px] px-2 py-1.5 text-left hover:bg-cg-surface-hover"
                    key={`${entry.ranAt}:${entry.sql}`}
                    onClick={() => onSqlChange(entry.sql)}
                    type="button"
                  >
                    <span className="truncate font-mono text-[11.5px] text-cg-fg">
                      {entry.sql.replace(/\s+/g, " ")}
                    </span>
                    <span className="text-[10.5px] text-cg-muted">
                      {entry.ok ? formatDuration(entry.durationMs) : "failed"} ·{" "}
                      {new Date(entry.ranAt).toLocaleTimeString()}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>
        ) : null}
      </div>

      <ConfirmDialog
        confirmLabel="Enable Write Mode"
        description="Write mode lets statements permanently modify this app's data — there is no undo. Consider creating a backup first (Settings → Backup). Write mode stays on until you turn it off or leave the page."
        onConfirm={() => {
          setWriteMode(true);
          setConfirmWriteOpen(false);
        }}
        onOpenChange={setConfirmWriteOpen}
        open={confirmWriteOpen}
        title="Enable write mode?"
      />
    </div>
  );
}

function resultStatusText(result: QueryResult) {
  const parts: string[] = [];

  if (result.columns.length > 0) {
    parts.push(
      `${formatRowCount(result.rows.length)}${result.truncated ? "+" : ""} row${result.rows.length === 1 ? "" : "s"}`,
    );
    if (result.truncated) {
      parts.push(`showing the first ${formatRowCount(result.rows.length)}`);
    }
  }

  if (result.rowsAffected > 0) {
    parts.push(`${formatRowCount(result.rowsAffected)} affected`);
  }

  if (result.statementCount > 1) {
    parts.push(`${result.statementCount} statements`);
  }

  parts.push(formatDuration(result.durationMs));

  return parts.join(" · ");
}
