import type { PageDefinition } from "@/pages/page.types";

export const dataPage = {
  activity: "Data",
  hideHeader: true,
  id: "data",
  keywords: [
    "data",
    "sbol",
    "rdf",
    "sparql",
    "sql",
    "sequence",
    "graph",
    "ontology",
    "genbank",
    "fasta",
    "import",
  ],
  label: "Data",
  loadComponent: () =>
    import("@/features/data/DataPage").then(({ DataPage }) => ({
      default: DataPage,
    })),
  subtitle: "Manage and explore the local SBOL data store.",
  title: "Data",
} as const satisfies PageDefinition;
