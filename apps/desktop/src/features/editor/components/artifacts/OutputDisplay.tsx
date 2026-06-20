import { Fragment, type ReactNode } from "react";

import {
  DATAFRAME_MIME,
  type DataFrameData,
  type DisplayData,
  isPlateShaped,
  pickMime,
} from "./display";

/// Render one rich display emitted by a Python run. The host holds all the
/// rendering logic; the script only produces standard objects whose MIME bundle
/// arrives here. Sits in the Output panel's stream beside plain stdout/stderr.
export function OutputDisplay({ display }: { display: DisplayData }) {
  const mime = pickMime(display.data);
  if (!mime) {
    return null;
  }
  const payload = display.data[mime];

  switch (mime) {
    case DATAFRAME_MIME:
      return <DataFrame frame={payload as DataFrameData} />;
    case "text/html":
      return (
        <ArtifactCard>
          <iframe
            className="w-full rounded-[5px] border-0 bg-white"
            // Scripts run (Plotly etc.) but the frame stays cross-origin to the
            // app, so it can't reach into the host document.
            sandbox="allow-scripts"
            srcDoc={String(payload)}
            style={{ height: 360 }}
            title="HTML output"
          />
        </ArtifactCard>
      );
    case "image/svg+xml":
      return (
        <ArtifactCard>
          <div
            // SVG comes from the user's own run (same trust as the code we just
            // ran); render inline so diagrams scale.
            className="overflow-auto bg-white p-2 [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: String(payload) }}
          />
        </ArtifactCard>
      );
    case "image/png":
    case "image/jpeg": {
      const raw = String(payload);
      const src = raw.startsWith("data:") ? raw : `data:${mime};base64,${raw}`;
      return (
        <img
          alt="Figure"
          className="my-1.5 block max-w-full rounded-[6px] border border-cg-border bg-white"
          src={src}
        />
      );
    }
    case "application/json":
      return (
        <ArtifactCard>
          <pre className="m-0 overflow-auto font-mono text-[11px] leading-[1.45] text-cg-fg">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </ArtifactCard>
      );
    default:
      // text/markdown, text/latex, text/plain, and any unknown type.
      return (
        <ArtifactCard>
          <pre className="m-0 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-[1.45] text-cg-fg">
            {String(payload)}
          </pre>
        </ArtifactCard>
      );
  }
}

function DataFrame({ frame }: { frame: DataFrameData }) {
  return isPlateShaped(frame) ? (
    <PlateMap frame={frame} />
  ) : (
    <TableView frame={frame} />
  );
}

function PlateMap({ frame }: { frame: DataFrameData }) {
  const colorByValue = buildColorMap(frame);

  return (
    <ArtifactCard>
      <div className="overflow-auto">
        <div
          className="inline-grid gap-[3px]"
          style={{
            gridTemplateColumns: `auto repeat(${frame.columns.length}, minmax(16px, 1fr))`,
          }}
        >
          <div />
          {frame.columns.map((column) => (
            <div
              className="text-center text-[9px] font-semibold leading-none text-cg-muted"
              key={`h${column}`}
            >
              {column}
            </div>
          ))}
          {frame.index.map((rowLabel, rowIndex) => (
            <Fragment key={rowLabel}>
              <div className="flex items-center pr-1 text-[9px] font-semibold leading-none text-cg-muted">
                {rowLabel}
              </div>
              {frame.columns.map((column, colIndex) => {
                const value = frame.data[rowIndex]?.[colIndex] ?? null;
                const label =
                  value === null || value === "" ? null : String(value);
                const color = label ? colorByValue.get(label) : undefined;
                return (
                  <div
                    className="grid aspect-square min-w-[16px] place-items-center rounded-full border border-cg-border"
                    key={`${rowLabel}${column}`}
                    style={color ? { backgroundColor: color } : undefined}
                    title={
                      label
                        ? `${rowLabel}${column}: ${label}`
                        : `${rowLabel}${column}`
                    }
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </ArtifactCard>
  );
}

const PLATE_COLORS = [
  "#128a3e",
  "#2563eb",
  "#c026d3",
  "#d97706",
  "#0891b2",
  "#dc2626",
  "#7c3aed",
  "#65a30d",
];

/// Assign each distinct non-empty well value a stable color, so replicates of
/// the same sample share a tint.
function buildColorMap(frame: DataFrameData): Map<string, string> {
  const colors = new Map<string, string>();
  for (const row of frame.data) {
    for (const value of row) {
      if (value === null || value === "") {
        continue;
      }
      const label = String(value);
      if (!colors.has(label)) {
        colors.set(label, PLATE_COLORS[colors.size % PLATE_COLORS.length]);
      }
    }
  }
  return colors;
}

function TableView({ frame }: { frame: DataFrameData }) {
  // Show the index as a leading column only when it carries real labels (not the
  // default 0..n-1 row numbers pandas emits).
  const showIndex = frame.index.some(
    (label, position) => label !== String(position),
  );

  return (
    <ArtifactCard>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              {showIndex ? (
                <th className="border-b border-cg-border px-2 py-1 text-left font-semibold text-cg-muted" />
              ) : null}
              {frame.columns.map((column) => (
                <th
                  className="border-b border-cg-border px-2 py-1 text-left font-semibold text-cg-fg"
                  key={column}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {frame.data.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {showIndex ? (
                  <td className="border-b border-cg-border px-2 py-1 font-semibold text-cg-muted">
                    {frame.index[rowIndex]}
                  </td>
                ) : null}
                {row.map((cell, cellIndex) => (
                  <td
                    className="border-b border-cg-border px-2 py-1 align-top text-cg-fg"
                    key={cellIndex}
                  >
                    {cell === null ? "" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ArtifactCard>
  );
}

function ArtifactCard({ children }: { children: ReactNode }) {
  return (
    <div className="my-1.5 overflow-hidden rounded-[6px] border border-cg-border bg-cg-editor p-2 font-sans">
      {children}
    </div>
  );
}
