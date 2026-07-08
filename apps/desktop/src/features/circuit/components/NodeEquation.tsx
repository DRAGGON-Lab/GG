import "katex/dist/katex.min.css";

import katex from "katex";
import { useMemo } from "react";

type NodeEquationProps = {
  /// The operator's expression rate as a KaTeX string.
  equation: string;
};

/// Renders an operator's Loica `expression_rate` as a display equation. The
/// container scrolls horizontally so a wide formula (Hill2, Sum) never widens
/// the inspector panel.
export function NodeEquation({ equation }: NodeEquationProps) {
  const html = useMemo(
    () =>
      katex.renderToString(equation, {
        displayMode: true,
        throwOnError: false,
      }),
    [equation],
  );

  return (
    <div className="grid gap-1 rounded-[6px] border border-cg-border bg-cg-surface px-2.5 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-cg-muted">
        Expression rate
      </span>
      <div
        className="max-w-full overflow-x-auto text-cg-fg [&_.katex-display]:my-0.5 [&_.katex]:text-[0.95em]"
        // KaTeX emits trusted markup from a static equation string.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
