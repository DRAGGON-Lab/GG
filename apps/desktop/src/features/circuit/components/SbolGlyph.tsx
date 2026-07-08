import type { SbolGlyphKind } from "@/features/circuit/core/sbol-glyph";

/// SBOL Visual glyphs (github.com/SynBioDex/SBOL-visual, CC0) reproduced as
/// inline SVG from the official geometry. All share the standard 45×45 viewBox
/// and are monochrome, so they take the node's accent color and stay crisp at
/// any canvas zoom.
export function SbolGlyph({
  color,
  glyph,
  size = 46,
}: {
  color: string;
  glyph: SbolGlyphKind;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={3}
      viewBox="0 0 45 45"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {glyph === "promoter" ? (
        <>
          <path d="M7.5 39.75 v-27 h29" />
          <path d="M29 5.25 l8.5 7.5 l-8.5 7.33" />
        </>
      ) : null}
      {glyph === "cds" ? (
        <path
          d="M5.26 33.9 H28.87 L39.75 22.5 L28.87 11.1 H5.26 Z"
          fill={color}
          fillOpacity={0.16}
        />
      ) : null}
      {glyph === "small-molecule" ? (
        <circle cx={22.5} cy={22.5} fill={color} r={8.5} strokeWidth={2} />
      ) : null}
    </svg>
  );
}
