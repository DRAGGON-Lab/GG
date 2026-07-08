import type { PageDefinition } from "@/pages/page.types";

export const circuitPage = {
  activity: "Circuit",
  hideHeader: true,
  id: "circuit",
  keywords: [
    "circuit",
    "loica",
    "genetic",
    "network",
    "synbio",
    "synthetic biology",
    "regulator",
    "reporter",
    "operator",
    "promoter",
    "graph",
    "simulation",
  ],
  label: "Circuit",
  loadComponent: () =>
    import("@/features/circuit/CircuitPage").then(({ CircuitPage }) => ({
      default: CircuitPage,
    })),
  subtitle: "Design genetic circuits as a Loica network graph.",
  title: "Circuit",
} as const satisfies PageDefinition;
