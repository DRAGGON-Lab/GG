import type {
  Characterization,
  Study,
} from "@/features/flapjack/core/flapjack-types";
import {
  type FlapjackSectionId,
  flapjackSections,
} from "@/features/flapjack/flapjack-sections";
import {
  sidebarRowActiveClassName,
  sidebarRowClassName,
  SidebarSectionLabel,
} from "@/ui";
import { cx } from "@/ui/class-name";

type FlapjackNavProps = {
  activeSection: FlapjackSectionId;
  onSelect: (id: FlapjackSectionId) => void;
  studies: Study[];
  selectedStudyId: number | null;
  onSelectStudy: (id: number) => void;
  runs: Characterization[];
  selectedRunId: number | null;
  onSelectRun: (id: number) => void;
};

/// The Flapjack sidebar: an explorer-style two-tier nav. The five sections sit
/// at the top; the active list-bearing section (Studies or Characterizations)
/// expands its items as indented child rows, so selecting a study or run swaps
/// only the content pane. Every row shares the workbench sidebar-row style.
export function FlapjackNav({
  activeSection,
  onSelect,
  studies,
  selectedStudyId,
  onSelectStudy,
  runs,
  selectedRunId,
  onSelectRun,
}: FlapjackNavProps) {
  return (
    <nav
      aria-label="Flapjack sections"
      className="flex min-h-0 flex-col overflow-auto border-r border-cg-sidebar-border bg-cg-sidebar px-2 py-2"
    >
      <SidebarSectionLabel>Flapjack</SidebarSectionLabel>
      <div className="grid gap-px">
        {flapjackSections.map((section) => (
          <div key={section.id}>
            <button
              aria-current={activeSection === section.id ? "page" : undefined}
              className={cx(
                sidebarRowClassName,
                "grid-cols-[max-content_minmax(0,1fr)] text-[12.5px] font-[550]",
                activeSection === section.id && sidebarRowActiveClassName,
              )}
              onClick={() => onSelect(section.id)}
              type="button"
            >
              <section.Icon
                aria-hidden="true"
                className="shrink-0"
                size={16}
                strokeWidth={1.8}
              />
              <span className="min-w-0 truncate">{section.label}</span>
            </button>

            {activeSection === "studies" && section.id === "studies" ? (
              <ChildList
                emptyLabel="No studies yet."
                items={studies.map((study) => ({
                  id: study.id,
                  label: study.name,
                }))}
                onSelect={onSelectStudy}
                selectedId={selectedStudyId}
              />
            ) : null}

            {activeSection === "characterizations" &&
            section.id === "characterizations" ? (
              <ChildList
                emptyLabel="No runs yet."
                items={runs.map((run) => ({
                  id: run.id,
                  label: run.name || run.analysisType,
                  title: run.analysisType,
                }))}
                onSelect={onSelectRun}
                selectedId={selectedRunId}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="min-h-3 flex-1" aria-hidden="true" />
    </nav>
  );
}

/// The indented item rows beneath an active section. Text-only nav rows sharing
/// the sidebar-row style, aligned under the parent section's label.
function ChildList({
  emptyLabel,
  items,
  onSelect,
  selectedId,
}: {
  emptyLabel: string;
  items: { id: number; label: string; title?: string }[];
  onSelect: (id: number) => void;
  selectedId: number | null;
}) {
  if (items.length === 0) {
    return (
      <div className="py-1 pl-[30px] pr-1.5 text-[11.5px] italic leading-none text-cg-muted">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="mt-px grid gap-px pl-4">
      {items.map((item) => (
        <button
          aria-current={selectedId === item.id ? "true" : undefined}
          className={cx(
            sidebarRowClassName,
            "text-[12px]",
            selectedId === item.id && sidebarRowActiveClassName,
          )}
          key={item.id}
          onClick={(event) => {
            event.currentTarget.blur();
            onSelect(item.id);
          }}
          title={item.title ?? item.label}
          type="button"
        >
          <span className="min-w-0 truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
