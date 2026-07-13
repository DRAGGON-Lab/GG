/// A rich display emitted by a Python run via the standard Jupyter display
/// protocol (matplotlib figures, `display(obj)`). Carried as one JSON line on
/// the run's `display` stream and rendered by `OutputDisplay`. `data` maps MIME
/// type to payload — the renderer picks the richest type it can draw.

export type DisplayData = {
  data: Record<string, unknown>;
};

/// A pandas DataFrame in `to_dict("split")` shape, sent under the
/// `application/vnd.gg.dataframe+json` MIME type.
export type DataFrameData = {
  columns: string[];
  index: string[];
  data: (string | number | boolean | null)[][];
  /// Pandas-generated CSV (DataFrame.to_csv()) used when saving captures.
  csv?: string;
  /// Pandas-generated fixed-width text (DataFrame.to_string()) for .txt saves.
  text?: string;
};

export const DATAFRAME_MIME = "application/vnd.gg.dataframe+json";

/// MIME types the renderer can draw, richest first.
export const RENDER_PRIORITY = [
  DATAFRAME_MIME,
  "text/html",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "application/json",
  "text/markdown",
  "text/latex",
  "text/plain",
] as const;

/// Parse one display JSON line. Returns null when the payload isn't a display
/// bundle, so the caller can fall back to rendering it as text.
export function parseDisplay(json: string): DisplayData | null {
  try {
    const value = JSON.parse(json) as unknown;
    if (
      value &&
      typeof value === "object" &&
      "data" in value &&
      typeof (value as { data: unknown }).data === "object" &&
      (value as { data: unknown }).data !== null
    ) {
      return value as DisplayData;
    }
    return null;
  } catch {
    return null;
  }
}

/// The richest renderable MIME type present in a bundle, or null when empty.
export function pickMime(data: Record<string, unknown>): string | null {
  for (const mime of RENDER_PRIORITY) {
    if (mime in data && data[mime] != null) {
      return mime;
    }
  }
  const keys = Object.keys(data);
  return keys.length ? keys[0] : null;
}

/// Whether a DataFrame is shaped like a microplate: row labels are plate rows
/// (A–P) and column labels are positive well numbers (1–24). Such frames render
/// as a plate map; everything else renders as a table.
export function isPlateShaped(frame: DataFrameData): boolean {
  const rows = frame.index;
  const cols = frame.columns;
  if (!rows.length || !cols.length || rows.length > 16 || cols.length > 24) {
    return false;
  }
  const rowsOk = rows.every((label) => /^[A-P]$/.test(label));
  const colsOk = cols.every((label) => {
    const value = Number(label);
    return Number.isInteger(value) && value >= 1 && value <= 24;
  });
  return rowsOk && colsOk;
}
