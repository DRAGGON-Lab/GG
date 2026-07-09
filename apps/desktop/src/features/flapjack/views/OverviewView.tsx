import { useEffect, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/features/flapjack/components/shared";
import { loadOverview } from "@/features/flapjack/core/flapjack-service";
import type { Overview } from "@/features/flapjack/core/flapjack-types";

const COUNT_TILES: { key: keyof Overview["counts"]; label: string }[] = [
  { key: "studies", label: "Studies" },
  { key: "assays", label: "Assays" },
  { key: "samples", label: "Samples" },
  { key: "signals", label: "Signals" },
  { key: "measurements", label: "Measurements" },
  { key: "characterizations", label: "Characterizations" },
];

export function OverviewView() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOverview().then(
      (loaded) => !cancelled && setOverview(loaded),
      (caught) =>
        !cancelled &&
        setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <SectionHeader
        subtitle="A local Flapjack-compatible store for experiment and simulation results."
        title="Overview"
      />
      {error ? <ErrorState message={error} /> : null}
      {!overview && !error ? <LoadingState /> : null}
      {overview ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {COUNT_TILES.map((tile) => (
              <div
                className="rounded-[8px] border border-cg-border bg-cg-surface px-3.5 py-3"
                key={tile.key}
              >
                <div className="text-[22px] font-semibold leading-none text-cg-fg [font-variant-numeric:tabular-nums]">
                  {overview.counts[tile.key].toLocaleString()}
                </div>
                <div className="mt-1.5 text-[11.5px] text-cg-muted">
                  {tile.label}
                </div>
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-6 text-[13px] font-semibold text-cg-fg">
            Recent studies
          </h3>
          {overview.recentStudies.length === 0 ? (
            <EmptyState message="No studies yet. Run a circuit simulation and save the results to Flapjack." />
          ) : (
            <ul className="grid gap-1.5">
              {overview.recentStudies.map((study) => (
                <li
                  className="rounded-[7px] border border-cg-border bg-cg-surface px-3 py-2"
                  key={study.id}
                >
                  <div className="text-[13px] font-[550] text-cg-fg">
                    {study.name}
                  </div>
                  {study.description ? (
                    <div className="mt-0.5 text-[12px] text-cg-muted">
                      {study.description}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
