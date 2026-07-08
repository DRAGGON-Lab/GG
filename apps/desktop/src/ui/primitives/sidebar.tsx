import type { ReactNode } from "react";

/// The standard workbench sidebar header: a bold, muted uppercase title plus
/// trailing action buttons. Shared by the editor explorer and the circuit
/// palette so every sidebar reads the same. Pair action `IconButton`s with
/// `sidebarHeaderIconButtonClassName`.
export function SidebarHeader({
  actions,
  title,
}: {
  actions?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="flex min-w-0 items-center gap-0.5 border-b border-cg-border px-2 py-2">
      <span className="ml-1 min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-[0.04em] leading-none text-cg-muted">
        {title}
      </span>
      {actions}
    </header>
  );
}

/// A muted uppercase section label within a sidebar body.
export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.04em] leading-none text-cg-muted">
      {children}
    </div>
  );
}
