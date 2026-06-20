import {
  Blocks,
  BookOpen,
  Code2,
  History,
  type LucideIcon,
  Sidebar,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from "@/ui";

export type SettingsSectionId =
  | "providers"
  | "backup"
  | "memory"
  | "skills"
  | "mcp"
  | "rail"
  | "editor"
  | "advanced";

export const settingsSections: readonly {
  id: SettingsSectionId;
  label: string;
  Icon: LucideIcon;
}[] = [
  { id: "providers", label: "AI Providers", Icon: Sparkles },
  { id: "backup", label: "Backup", Icon: History },
  { id: "memory", label: "AI Memory", Icon: BookOpen },
  { id: "skills", label: "Skills", Icon: WandSparkles },
  { id: "mcp", label: "MCP Servers", Icon: Blocks },
  { id: "rail", label: "Activity Rail", Icon: Sidebar },
  { id: "editor", label: "Text Editor", Icon: Code2 },
  { id: "advanced", label: "Advanced", Icon: SlidersHorizontal },
];
