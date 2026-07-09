/// Shared class names for workbench sidebars, so the editor explorer and other
/// sidebars (the circuit palette) present the same affordances.

/// Trailing action button in a `SidebarHeader` — sized to sit inline with the
/// title. Pair with `IconButton variant="ghost"`.
export const sidebarHeaderIconButtonClassName = "size-7 rounded-cg-md p-0";

/// A sidebar list row: 28px tall, rounded hover, the same foreground/hover
/// tokens as the explorer tree.
export const sidebarRowClassName =
  "grid h-[28px] w-full cursor-default items-center gap-[7px] rounded-[5px] border border-transparent bg-transparent px-1.5 text-left font-[inherit] text-cg-sidebar-fg hover:bg-cg-sidebar-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

/// The selected-row treatment for a navigation sidebar: a subtle border and
/// hover-toned fill that marks the active row without competing chrome. Append
/// to `sidebarRowClassName` on the current row.
export const sidebarRowActiveClassName =
  "border-cg-border bg-cg-sidebar-hover font-semibold text-cg-fg";
