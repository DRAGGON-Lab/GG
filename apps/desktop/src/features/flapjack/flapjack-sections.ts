import {
  ChartNoAxesCombined,
  ChartScatter,
  FlaskConical,
  Grid3x3,
  type LucideIcon,
  Sigma,
  SquareTerminal,
} from "@/ui";

export type FlapjackSectionId =
  | "overview"
  | "studies"
  | "measurements"
  | "characterizations"
  | "sql";

export const flapjackSections: readonly {
  id: FlapjackSectionId;
  label: string;
  Icon: LucideIcon;
}[] = [
  { id: "overview", label: "Overview", Icon: ChartNoAxesCombined },
  { id: "studies", label: "Studies", Icon: Grid3x3 },
  { id: "measurements", label: "Measurements", Icon: ChartScatter },
  { id: "characterizations", label: "Characterizations", Icon: Sigma },
  { id: "sql", label: "SQL", Icon: SquareTerminal },
];

export const FLAPJACK_SECTION_ICON = FlaskConical;
