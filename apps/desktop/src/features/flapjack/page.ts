import type { PageDefinition } from "@/pages/page.types";

export const flapjackPage = {
  activity: "Flapjack",
  hideHeader: true,
  id: "flapjack",
  keywords: [
    "flapjack",
    "experiment",
    "assay",
    "measurement",
    "characterization",
    "expression rate",
    "induction",
    "dose response",
    "plate reader",
    "time series",
  ],
  label: "Flapjack",
  loadComponent: () =>
    import("@/features/flapjack/FlapjackPage").then(({ FlapjackPage }) => ({
      default: FlapjackPage,
    })),
  subtitle: "Store and analyze experiment and simulation results.",
  title: "Flapjack",
} as const satisfies PageDefinition;
