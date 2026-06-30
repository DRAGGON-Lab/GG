import { useState } from "react";

import { type DataSectionId } from "@/features/data/data-sections";
import { DataNav } from "@/features/data/DataNav";
import { GraphsView } from "@/features/data/views/GraphsView";
import { ImportView } from "@/features/data/views/ImportView";
import { ObjectsView } from "@/features/data/views/ObjectsView";
import { OverviewView } from "@/features/data/views/OverviewView";
import { SequencesView } from "@/features/data/views/SequencesView";
import { WorkbenchView } from "@/features/data/views/WorkbenchView";

export function DataPage() {
  const [activeSection, setActiveSection] = useState<DataSectionId>("overview");

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[212px_minmax(0,1fr)] bg-cg-editor">
      <DataNav activeSection={activeSection} onSelect={setActiveSection} />

      <div className="min-w-0 overflow-auto bg-cg-editor [container-type:inline-size]">
        <div className="flex min-h-full min-w-0 flex-col px-[22px] py-[18px] [@container(max-width:520px)]:p-3.5">
          {activeSection === "overview" && <OverviewView />}
          {activeSection === "graphs" && <GraphsView />}
          {activeSection === "objects" && <ObjectsView />}
          {activeSection === "sequences" && <SequencesView />}
          {activeSection === "sparql" && <WorkbenchView mode="sparql" />}
          {activeSection === "sql" && <WorkbenchView mode="sql" />}
          {activeSection === "import" && <ImportView />}
        </div>
      </div>
    </div>
  );
}
