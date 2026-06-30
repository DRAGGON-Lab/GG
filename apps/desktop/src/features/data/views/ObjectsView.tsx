import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/features/data/components/shared";
import { loadObjects } from "@/features/data/core/data-service";
import { monoClass, shortIri } from "@/features/data/core/format";
import { ObjectDetailView } from "@/features/data/views/ObjectDetailView";
import { useAsyncResource } from "@/lib/use-async-resource";
import { Button, ChevronRight } from "@/ui";
import { cx } from "@/ui/class-name";

const PAGE_SIZE = 100;

type Filters = {
  sbolClass: string;
  role: string;
  graphId: string;
};

const EMPTY_FILTERS: Filters = { graphId: "", role: "", sbolClass: "" };

export function ObjectsView() {
  const [selectedIri, setSelectedIri] = useState<string | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);

  const after = cursorStack[cursorStack.length - 1];
  const resource = useAsyncResource(
    `objects:${JSON.stringify(filters)}:${after ?? ""}`,
    () =>
      loadObjects({
        after,
        graphId: filters.graphId.trim() || null,
        limit: PAGE_SIZE,
        role: filters.role.trim() || null,
        sbolClass: filters.sbolClass.trim() || null,
      }),
  );

  if (selectedIri) {
    return (
      <ObjectDetailView iri={selectedIri} onBack={() => setSelectedIri(null)} />
    );
  }

  const applyFilters = () => {
    setFilters(draft);
    setCursorStack([null]);
  };

  const list = resource.data;

  return (
    <div className="min-w-0">
      <SectionHeader
        subtitle="Browse typed SBOL objects. Filter by class, role, or graph."
        title="Objects"
      />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <FilterInput
          label="SBOL class"
          onChange={(value) => setDraft((d) => ({ ...d, sbolClass: value }))}
          placeholder="e.g. https://sbols.org/v3#Component"
          value={draft.sbolClass}
        />
        <FilterInput
          label="Role"
          onChange={(value) => setDraft((d) => ({ ...d, role: value }))}
          placeholder="role IRI"
          value={draft.role}
        />
        <FilterInput
          label="Graph ID"
          onChange={(value) => setDraft((d) => ({ ...d, graphId: value }))}
          placeholder="graph UUID"
          value={draft.graphId}
        />
        <div className="flex items-end">
          <Button onClick={applyFilters} size="sm" variant="default">
            Apply
          </Button>
        </div>
      </div>

      {resource.error ? <ErrorState message={resource.error} /> : null}
      {!list && resource.loading ? <LoadingState /> : null}

      {list ? (
        list.objects.length === 0 ? (
          <EmptyState message="No objects match these filters." />
        ) : (
          <>
            <div className="overflow-hidden rounded-[8px] border border-cg-border">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-cg-border bg-cg-surface text-left text-[11px] uppercase tracking-[0.03em] text-cg-muted">
                    <th className="px-3 py-2 font-semibold">
                      Display ID / IRI
                    </th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Class</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {list.objects.map((object) => (
                    <tr
                      className="cursor-default border-b border-cg-border last:border-0 hover:bg-cg-surface-hover"
                      key={object.id}
                      onClick={() => setSelectedIri(object.iri)}
                    >
                      <td className="px-3 py-2">
                        <div className="truncate font-medium text-cg-fg">
                          {object.displayId ?? shortIri(object.iri)}
                        </div>
                        <div
                          className={cx(monoClass, "truncate text-cg-muted")}
                          title={object.iri}
                        >
                          {object.iri}
                        </div>
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-cg-fg">
                        {object.name ?? "—"}
                      </td>
                      <td
                        className="px-3 py-2 text-cg-muted"
                        title={object.sbolClass}
                      >
                        {shortIri(object.sbolClass)}
                      </td>
                      <td className="px-2 text-cg-muted">
                        <ChevronRight aria-hidden="true" size={14} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2 text-[12px] text-cg-muted">
              <Button
                disabled={cursorStack.length <= 1}
                onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
                size="sm"
                variant="subtle"
              >
                Previous
              </Button>
              <Button
                disabled={!list.nextCursor}
                onClick={() =>
                  setCursorStack((stack) => [...stack, list.nextCursor])
                }
                size="sm"
                variant="subtle"
              >
                Next
              </Button>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function FilterInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-[11px] text-cg-muted">
      {label}
      <input
        className="rounded-[6px] border border-cg-border bg-cg-editor px-2.5 py-1.5 font-mono text-[12px] text-cg-fg outline-none focus:border-cg-focus"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
      />
    </label>
  );
}
