import type { PageDefinition } from "@/pages/page.types";

export const editorPage = {
  activity: "Editor",
  hideHeader: true,
  id: "editor",
  keywords: ["editor", "code", "python", "ide", "file"],
  label: "Editor",
  loadComponent: () =>
    import("@/features/editor/EditorPage").then(({ EditorPage }) => ({
      default: EditorPage,
    })),
  subtitle: "Write and edit Python for biological engineering.",
  title: "Editor",
} as const satisfies PageDefinition;
