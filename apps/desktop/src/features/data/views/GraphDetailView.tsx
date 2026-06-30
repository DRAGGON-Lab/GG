import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
  TermCell,
} from "@/features/data/components/shared";
import { loadGraph, loadGraphTriples } from "@/features/data/core/data-service";
import { formatInt, monoClass, shortIri } from "@/features/data/core/format";
import { useAsyncResource } from "@/lib/use-async-resource";
import { ArrowUp, Button } from "@/ui";
import { cx } from "@/ui/class-name";

const PAGE_SIZE = 100;

export function GraphDetailView({
  graphId,
  onBack,
}: {
  graphId: string;
  onBack: () => void;
}) {
  const [offset, setOffset] = useState(0);

  const graph = useAsyncResource(`graph:${graphId}`, () => loadGraph(graphId));
  const triples = useAsyncResource(`graph-triples:${graphId}:${offset}`, () =>
    loadGraphTriples({ id: graphId, limit: PAGE_SIZE, offset }),
  );

  const summary = graph.data;
  const page = triples.data;
  const total = page?.total ?? 0;

  return (
    <div className="min-w-0">
      <SectionHeader
        actions={
          <Button onClick={onBack} size="sm" variant="ghost">
            <ArrowUp aria-hidden="true" size={14} />
            Back to graphs
          </Button>
        }
        subtitle={summary ? summary.iri : "Graph detail"}
        title={summary?.name ?? (summary ? shortIri(summary.iri) : "Graph")}
      />

      {graph.error ? <ErrorState message={graph.error} /> : null}

      {summary ? (
        <div className="mb-4 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
          <Meta label="Kind" value={summary.kind} />
          <Meta label="Triples" value={formatInt(summary.tripleCount)} />
          <Meta label="Objects" value={formatInt(summary.objectCount)} />
          <Meta label="Format" value={summary.serializationFormat ?? "—"} />
        </div>
      ) : null}

      {triples.error ? <ErrorState message={triples.error} /> : null}
      {!page && triples.loading ? <LoadingState /> : null}

      {page ? (
        page.triples.length === 0 ? (
          <EmptyState message="This graph has no triples." />
        ) : (
          <>
            <div className="overflow-hidden rounded-[8px] border border-cg-border">
              <table className="w-full table-fixed border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-cg-border bg-cg-surface text-left text-[11px] uppercase tracking-[0.03em] text-cg-muted">
                    <th className="w-1/3 px-3 py-2 font-semibold">Subject</th>
                    <th className="w-1/3 px-3 py-2 font-semibold">Predicate</th>
                    <th className="w-1/3 px-3 py-2 font-semibold">Object</th>
                  </tr>
                </thead>
                <tbody>
                  {page.triples.map((row, index) => (
                    <tr
                      className="border-b border-cg-border align-top last:border-0"
                      key={index}
                    >
                      <td className="px-3 py-1.5">
                        <TermCell term={row.subject} />
                      </td>
                      <td className="px-3 py-1.5">
                        <TermCell term={row.predicate} />
                      </td>
                      <td className="px-3 py-1.5">
                        <TermCell term={row.object} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between text-[12px] text-cg-muted">
              <span>
                {offset + 1}–{offset + page.triples.length} of{" "}
                {formatInt(total)}
              </span>
              <div className="flex gap-2">
                <Button
                  disabled={offset === 0}
                  onClick={() =>
                    setOffset((value) => Math.max(0, value - PAGE_SIZE))
                  }
                  size="sm"
                  variant="subtle"
                >
                  Previous
                </Button>
                <Button
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                  size="sm"
                  variant="subtle"
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-cg-border bg-cg-surface px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-[0.03em] text-cg-muted">
        {label}
      </div>
      <div className={cx(monoClass, "mt-0.5 truncate text-cg-fg")}>{value}</div>
    </div>
  );
}
