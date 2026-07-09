import { useEffect, useState } from "react";

import {
  type EditorMarker,
  SbolCodeEditor,
} from "@/features/data/components/SbolCodeEditor";
import {
  EmptyState,
  ErrorState,
  ResultTable,
  SectionHeader,
} from "@/features/flapjack/components/shared";
import {
  executeSql,
  loadSqlSchema,
  validateSql,
} from "@/features/flapjack/core/flapjack-service";
import type {
  Schema,
  SqlResult,
} from "@/features/flapjack/core/flapjack-types";
import { useAppSettings } from "@/features/settings";
import { Button, LoaderCircle, Play, useTheme } from "@/ui";
import { cx } from "@/ui/class-name";

const SAMPLE_SQL =
  "SELECT s.name AS study, count(*) AS measurements\n" +
  "FROM measurement m\n" +
  "JOIN sample sa ON sa.id = m.sample_id\n" +
  "JOIN assay a ON a.id = sa.assay_id\n" +
  "JOIN study s ON s.id = a.study_id\n" +
  "GROUP BY s.id";

const monoChip =
  "cursor-default rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 font-mono text-[12px] text-cg-muted hover:text-cg-fg";

export function SqlView() {
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();

  const [query, setQuery] = useState(SAMPLE_SQL);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marker, setMarker] = useState<EditorMarker | null>(null);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSqlSchema().then(
      (loaded) => !cancelled && setSchema(loaded),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      if (query.trim().length === 0) {
        setMarker(null);
        return;
      }
      validateSql(query).then(
        (validated) => {
          if (cancelled) return;
          setMarker(
            validated.ok
              ? null
              : {
                  column: validated.column,
                  line: validated.line,
                  message: validated.message ?? "Syntax error",
                },
          );
        },
        () => {},
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const run = async () => {
    setError(null);
    setRunning(true);
    try {
      setResult(await executeSql(query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <SectionHeader
        subtitle="Run read-only SQL directly against the Flapjack database."
        title="SQL"
      />

      <div className="flex min-h-0 flex-col gap-3">
        {schema ? (
          <div className="flex flex-wrap gap-1.5">
            {schema.tables.map((table) => (
              <button
                className={monoChip}
                key={table.name}
                onClick={() =>
                  setQuery(`SELECT * FROM "${table.name}" LIMIT 100`)
                }
                title={table.columns.map((column) => column.name).join(", ")}
                type="button"
              >
                {table.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <SbolCodeEditor
            ariaLabel="SQL query"
            disabled={running}
            marker={marker}
            modelUri="inmemory://flapjack/sql-workbench"
            onChange={setQuery}
            onSubmit={run}
            resolvedTheme={resolvedTheme}
            textEditorSettings={settings.textEditor}
            value={query}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-cg-muted">⌘↵ to run</span>
            <Button
              disabled={running || query.trim().length === 0}
              onClick={run}
              size="sm"
              variant="default"
            >
              {running ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={14}
                />
              ) : (
                <Play aria-hidden="true" size={14} />
              )}
              Run
            </Button>
          </div>
        </div>

        {error ? <ErrorState message={error} /> : null}
        {result ? <SqlResultView result={result} /> : null}
      </div>
    </div>
  );
}

function SqlResultView({ result }: { result: SqlResult }) {
  if (result.columns.length === 0) {
    return <EmptyState message="Statement executed. No rows returned." />;
  }
  const columns = result.columns.map((column) => column.name);
  const rows = result.rows.map((row) => row.map(formatCell));
  return (
    <div className="grid min-h-0 gap-1.5">
      <div className={cx("text-[11px] text-cg-muted")}>
        {result.rowCount.toLocaleString()} rows · {result.elapsedMs} ms
        {result.truncated ? " · truncated" : ""}
      </div>
      <ResultTable columns={columns} rows={rows} />
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
