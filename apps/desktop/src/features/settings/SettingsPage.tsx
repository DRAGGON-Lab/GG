import { useState } from "react";

import { BackupSettingsSection } from "@/features/backup";
import { ActivityRailSettingsSection } from "@/features/settings/ActivityRailSettingsSection";
import { AdvancedSettingsSection } from "@/features/settings/AdvancedSettingsSection";
import { AiMemorySettingsSection } from "@/features/settings/AiMemorySettingsSection";
import { AiProvidersSettingsSection } from "@/features/settings/AiProvidersSettingsSection";
import { McpServersSettingsSection } from "@/features/settings/McpServersSettingsSection";
import type { SettingsSectionId } from "@/features/settings/settings-sections";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { SkillsSettingsSection } from "@/features/settings/SkillsSettingsSection";
import { TextEditorSettingsSection } from "@/features/settings/TextEditorSettingsSection";
import type { PageRuntime } from "@/pages/page.types";

export function SettingsPage({ openPageInNewTab }: PageRuntime) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("providers");

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[212px_minmax(0,1fr)] bg-cg-editor">
      <SettingsNav activeSection={activeSection} onSelect={setActiveSection} />

      <div className="min-w-0 overflow-auto bg-cg-editor [container-type:inline-size]">
        <div className="min-w-0 px-[22px] py-[18px] [@container(max-width:520px)]:p-3.5 [@container(max-width:380px)]:p-3">
          {activeSection === "providers" && <AiProvidersSettingsSection />}

          {activeSection === "backup" && <BackupSettingsSection />}

          {activeSection === "memory" && <AiMemorySettingsSection />}

          {activeSection === "skills" && <SkillsSettingsSection />}

          {activeSection === "mcp" && <McpServersSettingsSection />}

          {activeSection === "rail" && <ActivityRailSettingsSection />}

          {activeSection === "editor" && <TextEditorSettingsSection />}

          {activeSection === "advanced" && (
            <AdvancedSettingsSection openPageInNewTab={openPageInNewTab} />
          )}
        </div>
      </div>
    </div>
  );
}
