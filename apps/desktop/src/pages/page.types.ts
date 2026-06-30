import type { ComponentType } from "react";

import type { AiContextAttachmentInput } from "@/features/ai/core/ai-types";
import type { LucideIcon } from "@/ui";

export type ActivityMode =
  | "AI"
  | "Editor"
  | "Python"
  | "Data"
  | "Database"
  | "Settings";

/// Activities with a slot in the activity rail. Database and Settings are
/// reachable via the command palette and settings page instead.
export type TopLevelActivityMode = Exclude<
  ActivityMode,
  "Database" | "Settings"
>;

export type PageId =
  | "ai"
  | "editor"
  | "python"
  | "data"
  | "database"
  | "settings";

export type ActivityItem = {
  label: TopLevelActivityMode;
  Icon: LucideIcon;
  pageId: PageId;
};

export type OpenAiConversationOptions = {
  contextAttachments?: AiContextAttachmentInput[];
  conversationId?: string | null;
  placement?: "below" | "right";
  title?: string;
};

export type PageRuntime = {
  aiConversationId?: string | null;
  aiInitialContextAttachments?: AiContextAttachmentInput[];
  aiOpenRequestId?: number | null;
  openAiConversation?: (options: OpenAiConversationOptions) => void;
  openPageInNewTab?: (
    pageId: PageId,
    title?: string,
    options?: { placement?: "below" | "right" },
  ) => void;
};

export type PageComponentModule = {
  default: ComponentType<PageRuntime>;
};

export type PageComponentLoader = () => Promise<PageComponentModule>;

export type PageDefinition = {
  activity: ActivityMode;
  deferInitialRender?: boolean;
  hideHeader?: boolean;
  hiddenFromCommandPalette?: boolean;
  id: PageId;
  keywords: readonly string[];
  label: string;
  loadComponent: PageComponentLoader;
  preload?: () => Promise<unknown> | void;
  subtitle: string;
  title: string;
};
