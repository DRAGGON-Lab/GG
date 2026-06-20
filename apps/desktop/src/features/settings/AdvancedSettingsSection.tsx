import { settingsSectionClassName } from "@/features/settings/settings-styles";
import type { PageRuntime } from "@/pages/page.types";
import { Button, Database } from "@/ui";

type AdvancedSettingsSectionProps = {
  openPageInNewTab: PageRuntime["openPageInNewTab"];
};

export function AdvancedSettingsSection({
  openPageInNewTab,
}: AdvancedSettingsSectionProps) {
  return (
    <section className={settingsSectionClassName} aria-labelledby="advanced">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5">
        <h2
          className="m-0 text-[14px] font-bold leading-none text-cg-fg"
          id="advanced"
        >
          Advanced
        </h2>
      </header>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[7px] border border-cg-border bg-cg-surface px-3 py-2.5">
        <div className="grid min-w-0 gap-1.5">
          <span className="text-[12.5px] font-[600] leading-none text-cg-fg">
            Database Inspector
          </span>
          <span className="text-[11.5px] leading-relaxed text-cg-muted">
            Browse tables and run SQL against the app's local SQLite database.
          </span>
        </div>
        <Button
          onClick={() => openPageInNewTab?.("database")}
          size="sm"
          variant="subtle"
        >
          <Database aria-hidden="true" size={13} strokeWidth={1.9} />
          Open
        </Button>
      </div>
    </section>
  );
}
