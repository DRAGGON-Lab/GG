import type { ReactNode } from "react";

import { AlertCircle, LoaderCircle } from "@/ui";
import { cx } from "@/ui/class-name";

/// Tabular-numeral monospace, matching the Data tab's workbench cells.
export const monoClass =
  "font-mono text-[12px] [font-variant-numeric:tabular-nums]";

export function SectionHeader({
  actions,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        <h2 className="m-0 text-[16px] font-semibold leading-tight text-cg-fg">
          {title}
        </h2>
        {subtitle ? (
          <p className="m-0 mt-1 text-[12.5px] leading-snug text-cg-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-[12.5px] text-cg-muted">
      <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[7px] border border-cg-danger/40 bg-cg-danger/5 px-3 py-2.5 text-[12.5px] text-cg-danger">
      <AlertCircle aria-hidden="true" className="mt-px shrink-0" size={15} />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[7px] border border-dashed border-cg-border px-3 py-8 text-center text-[12.5px] text-cg-muted">
      {message}
    </div>
  );
}

export function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-auto rounded-[8px] border border-cg-border">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-cg-border bg-cg-surface text-left text-[11px] uppercase tracking-[0.03em] text-cg-muted">
            {columns.map((column) => (
              <th className="px-3 py-2 font-semibold" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              className="border-b border-cg-border last:border-0"
              key={rowIndex}
            >
              {row.map((cell, cellIndex) => (
                <td
                  className={cx(monoClass, "px-3 py-1.5 align-top text-cg-fg")}
                  key={cellIndex}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
