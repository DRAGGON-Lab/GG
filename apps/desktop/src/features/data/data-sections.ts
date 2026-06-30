import {
  Blocks,
  ChartNoAxesCombined,
  Code2,
  Dna,
  FolderOpen,
  type LucideIcon,
  Orbit,
  Search,
  SquareTerminal,
} from "@/ui";

export type DataSectionId =
  | "overview"
  | "graphs"
  | "objects"
  | "sequences"
  | "sparql"
  | "sql"
  | "import";

export const dataSections: readonly {
  id: DataSectionId;
  label: string;
  Icon: LucideIcon;
}[] = [
  { id: "overview", label: "Overview", Icon: ChartNoAxesCombined },
  { id: "graphs", label: "Graphs", Icon: Orbit },
  { id: "objects", label: "Objects", Icon: Blocks },
  { id: "sequences", label: "Sequence Search", Icon: Search },
  { id: "sparql", label: "SPARQL", Icon: Code2 },
  { id: "sql", label: "SQL", Icon: SquareTerminal },
  { id: "import", label: "Import", Icon: FolderOpen },
];

export const DATA_SECTION_ICON = Dna;
