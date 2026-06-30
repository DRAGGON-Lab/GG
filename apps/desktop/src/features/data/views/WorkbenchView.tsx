import { useEffect, useState } from "react";

import {
  type EditorMarker,
  SbolCodeEditor,
} from "@/features/data/components/SbolCodeEditor";
import {
  EmptyState,
  ErrorState,
  SectionHeader,
} from "@/features/data/components/shared";
import {
  executeSparql,
  executeSql,
  loadSqlSchema,
  validateSparql,
  validateSql,
} from "@/features/data/core/data-service";
import type {
  Schema,
  SparqlJsonResults,
  SparqlResult,
  SqlResult,
} from "@/features/data/core/data-types";
import {
  formatDuration,
  formatInt,
  monoClass,
} from "@/features/data/core/format";
import { useAppSettings } from "@/features/settings";
import { Button, LoaderCircle, Play, useTheme } from "@/ui";
import { cx } from "@/ui/class-name";

const SAMPLE_SPARQL = "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25";
const SAMPLE_SQL = "SELECT name FROM sqlite_master WHERE type = 'table'";

export function WorkbenchView({ mode }: { mode: "sparql" | "sql" }) {
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();

  const [query, setQuery] = useState(
    mode === "sparql" ? SAMPLE_SPARQL : SAMPLE_SQL,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marker, setMarker] = useState<EditorMarker | null>(null);
  const [sqlResult, setSqlResult] = useState<SqlResult | null>(null);
  const [sparqlResult, setSparqlResult] = useState<SparqlResult | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);

  useEffect(() => {
    if (mode !== "sql") {
      return;
    }
    let cancelled = false;
    loadSqlSchema().then(
      (loaded) => {
        if (!cancelled) {
          setSchema(loaded);
        }
      },
      () => {
        // The schema sidebar is best-effort.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Validate on idle so a syntax error surfaces as a Monaco marker. All marker
  // updates happen inside the debounce callback so the effect body never calls
  // setState synchronously.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) {
        return;
      }
      if (query.trim().length === 0) {
        setMarker(null);
        return;
      }
      const validate = mode === "sparql" ? validateSparql : validateSql;
      validate(query).then(
        (result) => {
          if (cancelled) {
            return;
          }
          setMarker(
            result.ok
              ? null
              : {
                  column: result.column,
                  line: result.line,
                  message: result.message ?? "Syntax error",
                },
          );
        },
        () => {
          // Validation is advisory.
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, mode]);

  const run = async () => {
    setError(null);
    setRunning(true);
    try {
      if (mode === "sparql") {
        const result = await executeSparql(query);
        setSparqlResult(result);
      } else {
        const result = await executeSql({ query });
        setSqlResult(result);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  const editor = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SbolCodeEditor
        ariaLabel={`${mode} query`}
        disabled={running}
        marker={marker}
        modelUri={`inmemory://data/${mode}-workbench`}
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
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <SectionHeader
        subtitle={
          mode === "sparql"
            ? "Query the triplestore with SPARQL (SELECT / ASK / CONSTRUCT / DESCRIBE)."
            : "Run read-only SQL directly against the SBOL database."
        }
        title={mode === "sparql" ? "SPARQL" : "SQL"}
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          {mode === "sql" && schema ? (
            <SchemaBar schema={schema} onPick={setQuery} />
          ) : null}
          {editor}
          {error ? <ErrorState message={error} /> : null}
          {mode === "sparql" && sparqlResult ? (
            <SparqlResultView result={sparqlResult} />
          ) : null}
          {mode === "sql" && sqlResult ? (
            <SqlResultView result={sqlResult} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SchemaBar({
  onPick,
  schema,
}: {
  onPick: (query: string) => void;
  schema: Schema;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {schema.tables.map((table) => (
        <button
          className={cx(
            monoClass,
            "cursor-default rounded-[6px] border border-cg-border bg-cg-surface px-2 py-1 text-cg-muted hover:text-cg-fg",
          )}
          key={table.name}
          onClick={() => onPick(`SELECT * FROM "${table.name}" LIMIT 100`)}
          title={table.columns.map((column) => column.name).join(", ")}
          type="button"
        >
          {table.name}
        </button>
      ))}
    </div>
  );
}

function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-auto rounded-[8px] border border-cg-border">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-cg-border bg-cg-surface text-left text-[11px] uppercase tracking-[0.03em] text-cg-muted">
            {columns.map((column) => (
              <th className="px-3 py-2 font-semibold" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              className="border-b border-cg-border last:border-0"
              key={rowIndex}
            >
              {row.map((cell, cellIndex) => (
                <td
                  className={cx(monoClass, "px-3 py-1.5 align-top text-cg-fg")}
                  key={cellIndex}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
      <ResultMeta
        text={`${formatInt(result.rowCount)} rows · ${formatDuration(
          result.elapsedMs,
        )}${result.truncated ? " · truncated" : ""}`}
      />
      <ResultTable columns={columns} rows={rows} />
    </div>
  );
}

function SparqlResultView({ result }: { result: SparqlResult }) {
  const meta = (
    <ResultMeta
      text={`${formatDuration(result.elapsedMs)}${
        result.truncated ? " · truncated" : ""
      }`}
    />
  );

  if (typeof result.body === "string") {
    return (
      <div className="grid min-h-0 gap-1.5">
        {meta}
        <pre className="max-h-96 overflow-auto rounded-[8px] border border-cg-border bg-cg-editor p-3 font-mono text-[11.5px] leading-relaxed text-cg-fg">
          {result.body}
        </pre>
      </div>
    );
  }

  const json = result.body as SparqlJsonResults;
  if (typeof json.boolean === "boolean") {
    return (
      <div className="grid gap-1.5">
        {meta}
        <div className="rounded-[8px] border border-cg-border bg-cg-surface px-3 py-2 font-mono text-[13px] text-cg-fg">
          {String(json.boolean)}
        </div>
      </div>
    );
  }

  const vars = json.head?.vars ?? [];
  const bindings = json.results?.bindings ?? [];
  if (vars.length === 0 || bindings.length === 0) {
    return (
      <div className="grid gap-1.5">
        {meta}
        <EmptyState message="Query returned no results." />
      </div>
    );
  }

  const rows = bindings.map((binding) =>
    vars.map((variable) => {
      const value = binding[variable];
      return value ? value.value : "";
    }),
  );

  return (
    <div className="grid min-h-0 gap-1.5">
      {meta}
      <ResultTable columns={vars} rows={rows} />
    </div>
  );
}

function ResultMeta({ text }: { text: string }) {
  return <div className="text-[11px] text-cg-muted">{text}</div>;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
