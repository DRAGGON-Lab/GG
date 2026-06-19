import type { CellValue, QueryResult } from "@/features/database/types";

const integerFormatter = new Intl.NumberFormat("en-US");

export function formatRowCount(count: number) {
  return integerFormatter.format(count);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(durationMs: number) {
  if (durationMs < 1) {
    return "<1 ms";
  }

  if (durationMs < 1000) {
    return `${durationMs >= 100 ? Math.round(durationMs) : durationMs.toFixed(1)} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

/// Plain-text form of a cell, used for the grid, the clipboard, and CSV.
export function cellText(cell: CellValue): string {
  switch (cell.type) {
    case "null":
      return "";
    case "integer":
    case "real":
      return String(cell.value);
    case "text":
      return cell.value;
    case "blob":
      return `<blob ${formatBytes(cell.length)}>`;
  }
}

/// Pretty form for the cell-detail view: JSON payloads get re-indented.
export function cellDetailText(cell: CellValue): string {
  if (cell.type !== "text") {
    return cellText(cell);
  }

  const trimmed = cell.value.trim();
  if (
    cell.fullLength === undefined &&
    (trimmed.startsWith("{") || trimmed.startsWith("["))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return cell.value;
    }
  }

  return cell.value;
}

export function resultToCsv(result: QueryResult): string {
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [result.columns.map(escape).join(",")];

  for (const row of result.rows) {
    lines.push(
      row
        .map((cell) => (cell.type === "null" ? "" : escape(cellText(cell))))
        .join(","),
    );
  }

  return lines.join("\n");
}

export function resultToJson(result: QueryResult): string {
  const records = result.rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column, index) => {
        const cell = row[index];
        switch (cell.type) {
          case "null":
            return [column, null];
          case "integer":
          case "real":
            return [column, cell.value];
          case "text":
            return [column, cell.value];
          case "blob":
            return [column, { blobBytes: cell.length, preview: cell.preview }];
        }
      }),
    ),
  );

  return JSON.stringify(records, null, 2);
}
