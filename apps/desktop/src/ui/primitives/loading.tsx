import type { CSSProperties } from "react";

import { cx } from "@/ui/class-name";

/// Skeleton building blocks shared by the workbench page skeletons and
/// feature-level loading states, so every loading surface speaks the same
/// visual language.
export type LoadingEmphasis = "low" | "medium";

export function LoadingLine({
  className,
  emphasis = "low",
  style,
}: {
  className?: string;
  emphasis?: LoadingEmphasis;
  style?: CSSProperties;
}) {
  return (
    <LoadingBlock
      className={cx("rounded-full", className)}
      emphasis={emphasis}
      style={style}
    />
  );
}

export function LoadingBlock({
  className,
  emphasis = "low",
  style,
}: {
  className?: string;
  emphasis?: LoadingEmphasis;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cx(
        "relative overflow-hidden bg-[color-mix(in_srgb,var(--cg-border),transparent_62%)]",
        emphasis === "medium"
          ? "bg-[color-mix(in_srgb,var(--cg-border-strong),transparent_54%)]"
          : "",
        className,
      )}
      style={style}
    >
      {/* A calm light scans across — the same gesture as the launch veil's
          progress sweep, so loading speaks one visual language top to bottom.
          Slow and low-contrast on purpose. Reduced motion drops it entirely,
          leaving the plain static skeleton. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-[app-progress-sweep_2000ms_ease-in-out_infinite] bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--cg-border-strong),transparent_55%)] to-transparent motion-reduce:hidden"
      />
    </div>
  );
}
