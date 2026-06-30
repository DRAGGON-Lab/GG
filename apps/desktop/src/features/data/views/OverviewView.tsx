import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/features/data/components/shared";
import { loadOverview } from "@/features/data/core/data-service";
import { formatInt, monoClass, shortIri } from "@/features/data/core/format";
import { useAsyncResource } from "@/lib/use-async-resource";
import { Button, RefreshCw } from "@/ui";
import { cx } from "@/ui/class-name";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] border border-cg-border bg-cg-surface px-3.5 py-3">
      <div className="text-[20px] font-semibold leading-none text-cg-fg">
        {formatInt(value)}
      </div>
      <div className="mt-1.5 text-[11.5px] uppercase tracking-[0.03em] text-cg-muted">
        {label}
      </div>
    </div>
  );
}

export function OverviewView() {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource(`overview:${revision}`, () =>
    loadOverview(),
  );
  const overview = resource.data;

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
        subtitle="Corpus totals, recent imports, and the most common SBOL classes."
        title="Overview"
      />

      {resource.error ? <ErrorState message={resource.error} /> : null}
      {!overview && resource.loading ? <LoadingState /> : null}

      {overview ? (
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Objects" value={overview.counts.objects} />
            <StatCard label="Graphs" value={overview.counts.graphs} />
            <StatCard label="Triples" value={overview.counts.triples} />
            <StatCard label="Sequences" value={overview.counts.sequences} />
            <StatCard label="Ontologies" value={overview.counts.ontologies} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="m-0 mb-2 text-[13px] font-semibold text-cg-fg">
                Recent graphs
              </h3>
              {overview.recentGraphs.length === 0 ? (
                <EmptyState message="No graphs imported yet." />
              ) : (
                <ul className="grid gap-1.5">
                  {overview.recentGraphs.map((graph) => (
                    <li
                      className="rounded-[7px] border border-cg-border bg-cg-surface px-3 py-2"
                      key={graph.id}
                    >
                      <div className="truncate text-[12.5px] font-medium text-cg-fg">
                        {graph.name ?? shortIri(graph.iri)}
                      </div>
                      <div className={cx(monoClass, "truncate text-cg-muted")}>
                        {graph.iri}
                      </div>
                      <div className="mt-1 text-[11px] text-cg-muted">
                        {formatInt(graph.tripleCount)} triples ·{" "}
                        {formatInt(graph.objectCount)} objects · {graph.kind}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="min-w-0">
              <h3 className="m-0 mb-2 text-[13px] font-semibold text-cg-fg">
                Top classes
              </h3>
              {overview.topClasses.length === 0 ? (
                <EmptyState message="No typed objects yet." />
              ) : (
                <ul className="grid gap-1.5">
                  {overview.topClasses.map((entry) => (
                    <li
                      className="flex items-center justify-between gap-3 rounded-[7px] border border-cg-border bg-cg-surface px-3 py-2"
                      key={entry.iri}
                    >
                      <span
                        className={cx(monoClass, "truncate text-cg-fg")}
                        title={entry.iri}
                      >
                        {shortIri(entry.iri)}
                      </span>
                      <span className="shrink-0 text-[12px] font-medium text-cg-muted">
                        {formatInt(entry.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
