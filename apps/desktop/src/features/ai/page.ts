import type { PageDefinition } from "@/pages/page.types";

export const aiPage = {
  activity: "AI",
  hideHeader: true,
  id: "ai",
  keywords: ["ai", "chat", "assistant"],
  label: "AI",
  loadComponent: () =>
    import("@/features/ai/AiPage").then(({ AiPage }) => ({
      default: AiPage,
    })),
  subtitle: "Reason about your models and simulations with AI.",
  title: "AI",
} as const satisfies PageDefinition;
