import { Search } from "@/ui";

type TopBarProps = {
  onOpenCommandPalette: () => void;
};

export function TopBar({ onOpenCommandPalette }: TopBarProps) {
  return (
    <header className="relative border-b border-cg-border bg-cg-titlebar">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        data-tauri-drag-region
      />
      <button
        aria-label="Search pages, commands, and more"
        aria-keyshortcuts="Meta+K Control+K"
        className="absolute left-1/2 top-1/2 z-10 grid h-7 w-[min(48vw,540px)] min-w-[260px] -translate-x-1/2 -translate-y-1/2 cursor-default grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-2 pl-[9px] font-[inherit] text-cg-muted hover:border-cg-border-strong hover:bg-cg-surface-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus [&>svg]:opacity-75"
        onClick={onOpenCommandPalette}
        title="Open command palette"
        type="button"
      >
        <Search aria-hidden="true" size={14} strokeWidth={1.8} />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-[450] leading-none">
          Bio Eng Studio
        </span>
        <kbd className="inline-flex h-[18px] min-w-[26px] items-center justify-center rounded-[5px] border border-cg-border bg-cg-editor px-[5px] font-mono text-[10.5px] font-bold leading-none text-cg-muted">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
