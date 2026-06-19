import { Monitor, Moon, Sun } from "@/ui/icons";
import { Button } from "@/ui/primitives/button";
import { type ThemeMode, useTheme } from "@/ui/theme/use-theme";

const nextThemeMode: Record<ThemeMode, ThemeMode> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const themeModeLabel: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === "dark") {
    return <Moon aria-hidden="true" size={15} strokeWidth={1.8} />;
  }

  if (mode === "system") {
    return <Monitor aria-hidden="true" size={15} strokeWidth={1.8} />;
  }

  return <Sun aria-hidden="true" size={15} strokeWidth={1.8} />;
}

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const nextMode = nextThemeMode[mode];

  return (
    <Button
      aria-label={`Theme: ${themeModeLabel[mode]}. Switch to ${themeModeLabel[nextMode]}.`}
      className="size-[34px] min-h-[34px] min-w-[34px] translate-x-px rounded-lg border-transparent bg-transparent p-0 text-cg-activity-fg hover:border-transparent hover:bg-cg-activity-hover hover:text-cg-fg [&>svg]:size-[15px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.8] [&>svg]:opacity-70 [&>svg]:transition-[opacity,transform] [&>svg]:duration-150 [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] hover:[&>svg]:scale-[1.06] hover:[&>svg]:opacity-100"
      data-mode={mode}
      onClick={() => setMode(nextMode)}
      size="none"
      title={`Theme: ${themeModeLabel[mode]}`}
      variant="bare"
    >
      <ThemeIcon mode={mode} />
    </Button>
  );
}
