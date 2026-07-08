import type { NodeKind } from "@/features/circuit/core/loica-model";

/// The SBOL Visual glyph a node renders as.
export type SbolGlyphKind = "promoter" | "cds" | "small-molecule";

/// Which SBOL part each Loica node reads as: operators are promoters (regulated
/// or constitutive), gene products are coding sequences, supplements are small
/// molecules.
export function glyphForKind(kind: NodeKind): SbolGlyphKind {
  switch (kind) {
    case "regulator":
    case "reporter":
      return "cds";
    case "supplement":
      return "small-molecule";
    default:
      return "promoter";
  }
}
