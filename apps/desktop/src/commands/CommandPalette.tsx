import {
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
  useRef,
} from "react";

import { getCommandDomId } from "@/commands/command-search";
import type { CommandGroupResult, CommandItem } from "@/commands/command.types";
import { Button, Dialog, Search } from "@/ui";
import { cx } from "@/ui/class-name";

type CommandPaletteProps = {
  filteredCommands: readonly CommandItem[];
  groupedCommands: readonly CommandGroupResult[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  query: string;
  runCommand: (command: CommandItem | undefined) => void;
  selectedCommandIndex: number;
  setQuery: (query: string) => void;
  setSelectedCommandIndex: Dispatch<SetStateAction<number>>;
};

export function CommandPalette({
  filteredCommands,
  groupedCommands,
  onOpenChange,
  open,
  query,
  runCommand,
  selectedCommandIndex,
  setQuery,
  setSelectedCommandIndex,
}: CommandPaletteProps) {
  const commandInputRef = useRef<HTMLInputElement>(null);
  const selectedCommand = filteredCommands[selectedCommandIndex];

  function handleCommandInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedCommandIndex((index) =>
        filteredCommands.length === 0
          ? 0
          : (index + 1) % filteredCommands.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedCommandIndex((index) =>
        filteredCommands.length === 0
          ? 0
          : (index - 1 + filteredCommands.length) % filteredCommands.length,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedCommandIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setSelectedCommandIndex(Math.max(filteredCommands.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand(selectedCommand);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-cg-overlay animate-[app-command-backdrop-in_120ms_ease] motion-reduce:animate-none" />
        <Dialog.Popup
          className="fixed left-1/2 top-[70px] grid max-h-[min(620px,calc(100vh_-_110px))] w-[min(660px,calc(100vw_-_32px))] -translate-x-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-cg-command-border bg-cg-command text-cg-fg shadow-[var(--cg-command-shadow)] animate-[app-command-popup-in_140ms_var(--ease-out-strong)] focus-visible:outline-none motion-reduce:animate-none"
          initialFocus={commandInputRef}
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search pages and commands.
          </Dialog.Description>
          <div className="grid h-14 grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-3 border-b border-cg-border px-3.5">
            <div className="flex items-center gap-2">
              <Search
                aria-hidden="true"
                className="text-cg-muted"
                size={18}
                strokeWidth={1.8}
              />
            </div>
            <input
              aria-activedescendant={
                selectedCommand ? getCommandDomId(selectedCommand) : undefined
              }
              aria-controls="app-command-list"
              aria-label="Search pages and commands"
              className="min-w-0 border-0 bg-transparent font-[inherit] text-[17px] font-[440] leading-none text-cg-fg outline-0 placeholder:text-cg-muted"
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={handleCommandInputKeyDown}
              placeholder="Search or go to..."
              ref={commandInputRef}
              role="combobox"
              value={query}
            />
            <kbd className="inline-flex h-5 min-w-[30px] items-center justify-center rounded-[5px] border border-cg-border bg-cg-editor px-1.5 font-mono text-[11px] font-bold leading-none text-cg-muted">
              ⌘K
            </kbd>
          </div>

          <div
            aria-label="Commands"
            className="min-h-0 max-h-[min(430px,calc(100vh_-_230px))] overflow-y-auto p-[7px]"
            id="app-command-list"
            role="listbox"
          >
            {groupedCommands.length === 0 ? (
              <div className="grid min-h-[120px] content-center justify-items-center gap-1.5 text-[13px] text-cg-muted">
                <span>No commands found</span>
              </div>
            ) : (
              groupedCommands.map(({ commands, group }) => (
                <section className="[&+&]:mt-1.5" key={group}>
                  <div className="px-[9px] pb-[5px] pt-2 font-mono text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-cg-muted">
                    {group}
                  </div>
                  {commands.map((command) => {
                    const Icon = command.icon;
                    const commandIndex = filteredCommands.indexOf(command);
                    const isSelected = commandIndex === selectedCommandIndex;

                    return (
                      <Button
                        aria-selected={isSelected}
                        className="!grid h-[46px] w-full grid-cols-[28px_minmax(0,1fr)_max-content] items-center justify-stretch gap-2.5 rounded-[7px] border-transparent bg-transparent px-2.5 text-left text-cg-fg hover:border-transparent hover:bg-cg-command-selected data-selected:border-transparent data-selected:bg-cg-command-selected"
                        data-active={command.isActive ? "" : undefined}
                        data-selected={isSelected ? "" : undefined}
                        id={getCommandDomId(command)}
                        key={command.id}
                        onClick={() => runCommand(command)}
                        onMouseEnter={() =>
                          setSelectedCommandIndex(commandIndex)
                        }
                        role="option"
                        size="none"
                        variant="bare"
                      >
                        <span
                          className={cx(
                            "inline-flex size-7 items-center justify-center rounded-md border border-cg-border bg-cg-editor text-cg-muted",
                            isSelected && "border-cg-border-strong text-cg-fg",
                          )}
                        >
                          <Icon
                            aria-hidden="true"
                            size={15}
                            strokeWidth={1.8}
                          />
                        </span>
                        <span className="flex min-w-0 flex-col gap-1">
                          <span
                            className={cx(
                              "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[540] leading-none",
                              command.isActive && "font-[650]",
                            )}
                          >
                            {command.label}
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-[440] leading-none text-cg-muted">
                            {command.subtitle}
                          </span>
                        </span>
                        <span className="text-[11px] font-[560] text-cg-muted">
                          {command.status ?? command.shortcut}
                        </span>
                      </Button>
                    );
                  })}
                </section>
              ))
            )}
          </div>

          <div className="flex h-8 items-center justify-end gap-3.5 border-t border-cg-border bg-cg-command-footer px-3 font-mono text-[11px] leading-none text-cg-muted">
            <span>↑↓ Select</span>
            <span>↵ Open</span>
            <span>Esc Close</span>
          </div>
          <Dialog.Close className="sr-only">Close</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
