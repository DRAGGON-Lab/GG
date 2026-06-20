import {
  type SettingsSectionId,
  settingsSections,
} from "@/features/settings/settings-sections";
import { BioEngStudioWordmark } from "@/ui";

type SettingsNavProps = {
  activeSection: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
};

export function SettingsNav({ activeSection, onSelect }: SettingsNavProps) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex min-h-0 flex-col overflow-auto border-r border-cg-sidebar-border bg-cg-sidebar px-2 py-2"
    >
      <div className="px-1.5 pb-1.5 pt-1 text-[11px] font-bold uppercase leading-none tracking-[0.04em] text-cg-muted">
        Settings
      </div>
      <div className="grid gap-px">
        {settingsSections.map((section) => (
          <button
            aria-current={activeSection === section.id ? "page" : undefined}
            className="flex min-h-[30px] cursor-default items-center gap-2.5 rounded-[6px] border border-transparent bg-transparent px-2 py-1.5 text-left text-[12.5px] font-[550] leading-none text-cg-sidebar-fg transition-[background-color,color] duration-150 ease-out-strong hover:bg-cg-sidebar-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus data-active:border-cg-border data-active:bg-cg-sidebar-hover data-active:font-semibold data-active:text-cg-fg"
            data-active={activeSection === section.id ? "" : undefined}
            key={section.id}
            onClick={() => onSelect(section.id)}
            type="button"
          >
            <section.Icon
              aria-hidden="true"
              className="shrink-0"
              size={16}
              strokeWidth={1.8}
            />
            <span className="min-w-0 truncate">{section.label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-3 flex-1" aria-hidden="true" />
      <div className="grid justify-items-start gap-1.5 px-1 pb-1">
        <BioEngStudioWordmark className="h-9 w-auto text-cg-muted" />
        <p className="m-0 text-[10.5px] leading-none text-cg-muted">
          The Biological Engineering IDE
        </p>
      </div>
    </nav>
  );
}
