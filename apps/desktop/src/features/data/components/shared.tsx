import type { ReactNode } from "react";

import type { Term } from "@/features/data/core/data-types";
import { monoClass, shortIri } from "@/features/data/core/format";
import { AlertCircle, LoaderCircle } from "@/ui";
import { cx } from "@/ui/class-name";

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

/// Render one RDF term the way the data lab does: IRIs as links-styled text,
/// blank nodes prefixed `_:`, literals quoted with an optional type/lang hint.
export function TermCell({ term }: { term: Term }) {
  if (term.type === "uri") {
    return (
      <span className={cx(monoClass, "break-all text-cg-accent")}>
        {term.value}
      </span>
    );
  }
  if (term.type === "bnode") {
    return (
      <span className={cx(monoClass, "break-all text-cg-muted")}>
        _:{term.value}
      </span>
    );
  }

  const suffix = term.language
    ? `@${term.language}`
    : term.datatype
      ? `^^${shortIri(term.datatype)}`
      : "";
  return (
    <span className={cx(monoClass, "break-words text-cg-fg")}>
      &ldquo;{term.value}&rdquo;
      {suffix ? <span className="text-cg-muted">{suffix}</span> : null}
    </span>
  );
}
