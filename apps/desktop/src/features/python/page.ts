import type { PageDefinition } from "@/pages/page.types";

export const pythonPage = {
  activity: "Python",
  hideHeader: true,
  id: "python",
  keywords: ["python", "repl", "code", "run", "pyodide", "numpy"],
  label: "Python",
  loadComponent: () =>
    import("@/features/python/PythonPage").then(({ PythonPage }) => ({
      default: PythonPage,
    })),
  subtitle: "Run Python in a persistent REPL.",
  title: "Python",
} as const satisfies PageDefinition;
