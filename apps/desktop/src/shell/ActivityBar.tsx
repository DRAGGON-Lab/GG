import { useAppSettings } from "@/features/settings";
import { orderActivityItems } from "@/pages/activity-items";
import type { ActivityMode, TopLevelActivityMode } from "@/pages/page.types";
import { Button, Settings, ThemeToggle } from "@/ui";

type ActivityBarProps = {
  activityMode: ActivityMode | null;
  onNavigateToActivity: (mode: TopLevelActivityMode) => void;
  onOpenSettings: () => void;
  onPreloadActivity?: (mode: TopLevelActivityMode) => void;
  onPreloadSettings?: () => void;
};

export function ActivityBar({
  activityMode,
  onNavigateToActivity,
  onOpenSettings,
  onPreloadActivity,
  onPreloadSettings,
}: ActivityBarProps) {
  const { settings } = useAppSettings();
  const activityItems = orderActivityItems(
    settings.activityOrder,
    settings.hiddenActivityItems,
  );

  return (
    <aside
      className="flex min-h-0 min-w-0 flex-col items-center gap-1.5 border-r border-cg-border bg-cg-activity px-[5px] py-2"
      aria-label="Activity"
    >
      {activityItems.map((item, index) => (
        <Button
          aria-current={activityMode === item.label ? "page" : undefined}
          aria-label={item.label}
          className="relative size-[34px] rounded-lg border-transparent bg-transparent text-[12px] font-[650] text-cg-activity-fg data-active:text-cg-fg hover:border-transparent hover:bg-cg-activity-hover hover:text-cg-fg active:border-transparent active:bg-cg-activity-hover active:text-cg-fg active:brightness-100 data-active:before:absolute data-active:before:left-[-5px] data-active:before:h-[18px] data-active:before:w-0.5 data-active:before:rounded-full data-active:before:bg-cg-accent data-active:before:content-[''] [&>svg]:size-[18px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.75] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&_.overflow-visible]:size-[22px] [&_.overflow-visible]:fill-current [&_.overflow-visible]:stroke-none"
          data-active={activityMode === item.label ? "" : undefined}
          key={item.label}
          onClick={(event) => {
            event.currentTarget.blur();
            onNavigateToActivity(item.label);
          }}
          onFocus={() => onPreloadActivity?.(item.label)}
          onPointerEnter={() => onPreloadActivity?.(item.label)}
          size="none"
          title={index < 9 ? `${item.label} (⌘${index + 1})` : item.label}
          variant="bare"
        >
          <item.Icon aria-hidden="true" size={18} strokeWidth={1.75} />
        </Button>
      ))}
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <ThemeToggle />
      <Button
        aria-label="Open Settings"
        className="size-[34px] min-h-[34px] min-w-[34px] translate-x-px rounded-lg border-transparent bg-transparent text-cg-activity-fg hover:border-transparent hover:bg-cg-activity-hover hover:text-cg-fg [&>svg]:opacity-70 [&>svg]:transition-[opacity,transform] [&>svg]:duration-150 hover:[&>svg]:scale-[1.06] hover:[&>svg]:opacity-100"
        onClick={onOpenSettings}
        onFocus={onPreloadSettings}
        onPointerEnter={onPreloadSettings}
        size="none"
        title="Settings"
        variant="bare"
      >
        <Settings aria-hidden="true" size={15} strokeWidth={1.8} />
      </Button>
    </aside>
  );
}
