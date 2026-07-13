import markDarkUrl from "@/assets/brand/gg-mark-dark.svg";
import markUrl from "@/assets/brand/gg-mark.svg";
import { cx } from "@/ui/class-name";

/** The GG Circuit brand marks. `GGCircuitMark` is fixed-color artwork with one
 * file per ground, so each theme swaps in the variant drawn for it rather than
 * recoloring; it stays no smaller than 16px tall. `GGCircuitWordmark` is
 * drawn as text in `currentColor`, so it inherits the surrounding text color. */

type BrandImageProps = {
  alt?: string;
  className?: string;
};

export function GGCircuitMark({ alt = "", className }: BrandImageProps) {
  return (
    <>
      <img
        alt={alt}
        aria-hidden={alt === "" || undefined}
        className={cx("dark:hidden", className)}
        draggable={false}
        src={markUrl}
      />
      <img
        alt={alt}
        aria-hidden={alt === "" || undefined}
        className={cx("hidden dark:block", className)}
        draggable={false}
        src={markDarkUrl}
      />
    </>
  );
}

const WORDMARK_FONT_FAMILY =
  '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const WORDMARK_VIEWBOX_WIDTH = 560;
const WORDMARK_VIEWBOX_HEIGHT = 96;
/// The single line is tracked out to this width so the lockup reads as airy,
/// deliberate type rather than default-spaced letters.
const WORDMARK_TEXT_LENGTH = 512;
/// A thin weight keeps the lockup light and sleek rather than chunky.
const WORDMARK_FONT_WEIGHT = 200;

/// The product wordmark, drawn as a single tracked line of text in
/// `currentColor`, so it sits on any theme ground without per-theme artwork.
export function GGCircuitWordmark({
  className,
  size = WORDMARK_VIEWBOX_WIDTH,
}: {
  className?: string;
  size?: number;
}) {
  const height = (size * WORDMARK_VIEWBOX_HEIGHT) / WORDMARK_VIEWBOX_WIDTH;

  return (
    <svg
      aria-hidden="true"
      className={cx("fill-current stroke-none", className)}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${WORDMARK_VIEWBOX_WIDTH} ${WORDMARK_VIEWBOX_HEIGHT}`}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        fill="currentColor"
        fontFamily={WORDMARK_FONT_FAMILY}
        fontSize={58}
        fontWeight={WORDMARK_FONT_WEIGHT}
        lengthAdjust="spacing"
        textAnchor="middle"
        textLength={WORDMARK_TEXT_LENGTH}
        x={WORDMARK_VIEWBOX_WIDTH / 2}
        y={66}
      >
        GG CIRCUIT
      </text>
    </svg>
  );
}
