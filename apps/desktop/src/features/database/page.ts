import type { PageDefinition } from "@/pages/page.types";

export const databasePage = {
  activity: "Database",
  hideHeader: true,
  id: "database",
  keywords: [
    "sqlite",
    "database",
    "sql",
    "tables",
    "schema",
    "rows",
    "query",
    "inspector",
    "data",
  ],
  label: "Database",
  loadComponent: () =>
    import("@/features/database/DatabasePage").then(({ DatabasePage }) => ({
      default: DatabasePage,
    })),
  subtitle: "Inspect and query the app's local SQLite database.",
  title: "Database",
} as const satisfies PageDefinition;
