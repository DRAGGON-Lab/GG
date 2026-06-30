import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/features/data/components/shared";
import { loadGraphs } from "@/features/data/core/data-service";
import { formatInt, monoClass, shortIri } from "@/features/data/core/format";
import { GraphDetailView } from "@/features/data/views/GraphDetailView";
import { useAsyncResource } from "@/lib/use-async-resource";
import { Button, ChevronRight, RefreshCw } from "@/ui";
import { cx } from "@/ui/class-name";

const PAGE_SIZE = 50;

export function GraphsView() {
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);

  const resource = useAsyncResource(`graphs:${offset}:${revision}`, () =>
    loadGraphs({ limit: PAGE_SIZE, offset }),
  );

  if (selectedGraphId) {
    return (
      <GraphDetailView
        graphId={selectedGraphId}
        onBack={() => setSelectedGraphId(null)}
      />
    );
  }

  const list = resource.data;
  const total = list?.total ?? 0;

  return (
    <div className="min-w-0">
      <SectionHeader
        actions={
          <Button
            onClick={() => setRevision((value) => value + 1)}
            size="sm"
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" size={14} />
            Refresh
          </Button>
        }
        subtitle="Every named graph in the store, with triple and object counts."
        title="Graphs"
      />

      {resource.error ? <ErrorState message={resource.error} /> : null}
      {!list && resource.loading ? <LoadingState /> : null}

      {list ? (
        list.graphs.length === 0 ? (
          <EmptyState message="No graphs yet. Import a document from the Import tab." />
        ) : (
          <>
            <div className="overflow-hidden rounded-[8px] border border-cg-border">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-cg-border bg-cg-surface text-left text-[11px] uppercase tracking-[0.03em] text-cg-muted">
                    <th className="px-3 py-2 font-semibold">Name / IRI</th>
                    <th className="px-3 py-2 font-semibold">Kind</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Triples
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Objects
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {list.graphs.map((graph) => (
                    <tr
                      className="cursor-default border-b border-cg-border last:border-0 hover:bg-cg-surface-hover"
                      key={graph.id}
                      onClick={() => setSelectedGraphId(graph.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="truncate font-medium text-cg-fg">
                          {graph.name ?? shortIri(graph.iri)}
                        </div>
                        <div
                          className={cx(monoClass, "truncate text-cg-muted")}
                          title={graph.iri}
                        >
                          {graph.iri}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-cg-muted">{graph.kind}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-cg-fg">
                        {formatInt(graph.tripleCount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-cg-fg">
                        {formatInt(graph.objectCount)}
                      </td>
                      <td className="px-2 text-cg-muted">
                        <ChevronRight aria-hidden="true" size={14} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between text-[12px] text-cg-muted">
              <span>
                {offset + 1}–{offset + list.graphs.length} of {formatInt(total)}
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
