import { useCallback, useEffect, useState } from "react";

import {
  loadCharacterizations,
  loadStudies,
} from "@/features/flapjack/core/flapjack-service";
import type {
  Characterization,
  Study,
} from "@/features/flapjack/core/flapjack-types";
import { type FlapjackSectionId } from "@/features/flapjack/flapjack-sections";
import { FlapjackNav } from "@/features/flapjack/FlapjackNav";
import { CharacterizationsView } from "@/features/flapjack/views/CharacterizationsView";
import { MeasurementsView } from "@/features/flapjack/views/MeasurementsView";
import { OverviewView } from "@/features/flapjack/views/OverviewView";
import { SqlView } from "@/features/flapjack/views/SqlView";
import { StudiesView } from "@/features/flapjack/views/StudiesView";

export function FlapjackPage() {
  const [activeSection, setActiveSection] =
    useState<FlapjackSectionId>("overview");

  // Study and characterization lists live here so they can drive the sidebar
  // nav; the detail views load their selected item by id.
  const [studies, setStudies] = useState<Study[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<number | null>(null);
  const [runs, setRuns] = useState<Characterization[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadStudies().then((loaded) => {
      if (cancelled) return;
      setStudies(loaded);
      setSelectedStudyId((current) => current ?? loaded[0]?.id ?? null);
    }, noop);
    loadCharacterizations().then((loaded) => {
      if (cancelled) return;
      setRuns(loaded);
      setSelectedRunId((current) => current ?? loaded[0]?.id ?? null);
    }, noop);
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the runs list after an analysis is saved and select the new run.
  const handleRunSaved = useCallback(async (id: number) => {
    const loaded = await loadCharacterizations();
    setRuns(loaded);
    setSelectedRunId(id);
  }, []);

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[212px_minmax(0,1fr)] bg-cg-editor">
      <FlapjackNav
        activeSection={activeSection}
        onSelect={setActiveSection}
        onSelectRun={setSelectedRunId}
        onSelectStudy={setSelectedStudyId}
        runs={runs}
        selectedRunId={selectedRunId}
        selectedStudyId={selectedStudyId}
        studies={studies}
      />

      <div className="min-w-0 overflow-auto bg-cg-editor [container-type:inline-size]">
        <div className="flex min-h-full min-w-0 flex-col px-[22px] py-[18px] [@container(max-width:520px)]:p-3.5">
          {activeSection === "overview" && <OverviewView />}
          {activeSection === "studies" && (
            <StudiesView selectedStudyId={selectedStudyId} />
          )}
          {activeSection === "measurements" && <MeasurementsView />}
          {activeSection === "characterizations" && (
            <CharacterizationsView
              onRunSaved={handleRunSaved}
              selectedRunId={selectedRunId}
              studies={studies}
            />
          )}
          {activeSection === "sql" && <SqlView />}
        </div>
      </div>
    </div>
  );
}

function noop() {}
