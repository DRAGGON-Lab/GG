import markDarkUrl from "@/assets/brand/bioeng-mark-dark.svg";
import markUrl from "@/assets/brand/bioeng-mark.svg";
import { cx } from "@/ui/class-name";

/** The Bio Eng Studio brand marks. `BioEngMark` is fixed-color artwork with one
 * file per ground, so each theme swaps in the variant drawn for it rather than
 * recoloring; it stays no smaller than 16px tall. `BioEngStudioWordmark` is
 * drawn as text in `currentColor`, so it inherits the surrounding text color. */

type BrandImageProps = {
  alt?: string;
  className?: string;
};

export function BioEngMark({ alt = "", className }: BrandImageProps) {
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
const WORDMARK_VIEWBOX_WIDTH = 300;
const WORDMARK_VIEWBOX_HEIGHT = 150;
/// The two lines share one `textLength`, so the shorter "STUDIO" is tracked out
/// to exactly the width of "BIO ENG" and the lockup reads as a single block.
const WORDMARK_LINE_LENGTH = 276;
/// A thin weight keeps the lockup light and sleek rather than chunky.
const WORDMARK_FONT_WEIGHT = 200;

/// The product wordmark, drawn as two equal-width lines stacked into a lockup.
/// It inherits the current text color via `currentColor`, so it sits on any
/// theme ground without per-theme artwork.
export function BioEngStudioWordmark({
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
        textLength={WORDMARK_LINE_LENGTH}
        x={WORDMARK_VIEWBOX_WIDTH / 2}
        y={62}
      >
        BIO ENG
      </text>
      <text
        fill="currentColor"
        fontFamily={WORDMARK_FONT_FAMILY}
        fontSize={58}
        fontWeight={WORDMARK_FONT_WEIGHT}
        lengthAdjust="spacing"
        textAnchor="middle"
        textLength={WORDMARK_LINE_LENGTH}
        x={WORDMARK_VIEWBOX_WIDTH / 2}
        y={128}
      >
        STUDIO
      </text>
    </svg>
  );
}
