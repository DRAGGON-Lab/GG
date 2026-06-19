import type {
  CommandGroup,
  CommandGroupResult,
  CommandItem,
} from "@/commands/command.types";

export const commandGroups: readonly CommandGroup[] = [
  "Pages",
  "Features",
  "Appearance",
  "View",
];

export function getCommandDomId(command: CommandItem) {
  return `app-command-${command.id.replace(/[^a-z0-9_-]/gi, "-")}`;
}

export function getCommandSearchText(command: CommandItem) {
  return [
    command.group,
    command.label,
    command.subtitle,
    command.status,
    ...command.keywords,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterCommands(
  commandItems: readonly CommandItem[],
  queryValue: string,
) {
  const query = queryValue.trim().toLowerCase();

  if (!query) {
    return commandItems;
  }

  return commandItems.filter((command) =>
    getCommandSearchText(command).includes(query),
  );
}

export function groupCommands(
  filteredCommands: readonly CommandItem[],
): readonly CommandGroupResult[] {
  return commandGroups
    .map((group) => ({
      commands: filteredCommands.filter((command) => command.group === group),
      group,
    }))
    .filter(({ commands }) => commands.length > 0);
}
