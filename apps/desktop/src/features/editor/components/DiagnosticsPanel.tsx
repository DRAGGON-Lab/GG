import type {
  LspDiagnostic,
  LspDiagnosticSeverity,
} from "@/features/editor/core/python-service";
import { useEditorPageContext } from "@/features/editor/editor-page-context";
import { AlertCircle } from "@/ui";

const diagnosticRowClassName =
  "grid w-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-start gap-2 rounded-md border border-cg-border bg-cg-editor px-2.5 py-[9px] text-left transition-colors duration-150 ease-out hover:bg-cg-surface-hover data-[severity=1]:border-[color-mix(in_srgb,var(--cg-danger),var(--cg-border)_58%)] data-[severity=2]:border-[color-mix(in_srgb,var(--cg-warning),var(--cg-border)_58%)] motion-reduce:transition-none";

/// Diagnostics for the active document. Sorted by severity then position;
/// clicking a row reveals the location in the editor.
export function DiagnosticsPanel() {
  const { activeDocument, diagnostics, navigateToLocation } =
    useEditorPageContext();
  const uri = activeDocument?.uri ?? null;
  const sorted = [...diagnostics].sort(compareDiagnostics);
  const counts = countDiagnostics(sorted);

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="grid min-w-0 gap-1 border-b border-cg-border px-3 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-2 text-[12px] font-bold leading-none text-cg-fg">
          <span>Diagnostics</span>
          <span className="text-[11px] font-semibold text-cg-muted">
            {diagnostics.length}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-none text-cg-muted">
          <span>{counts.error} errors</span>
          <span>{counts.warning} warnings</span>
          <span>{counts.info} info</span>
        </div>
      </div>

      <div className="grid min-h-0 min-w-0 auto-rows-max content-start gap-2 overflow-auto p-3">
        {sorted.length ? (
          sorted.map((diagnostic, index) => (
            <button
              className={diagnosticRowClassName}
              data-severity={diagnostic.severity ?? 1}
              disabled={!uri}
              key={`${diagnostic.range.start.line}-${diagnostic.range.start.character}-${index}`}
              onClick={() => {
                if (uri) {
                  navigateToLocation(
                    uri,
                    diagnostic.range.start.line,
                    diagnostic.range.start.character,
                  );
                }
              }}
              type="button"
            >
              <AlertCircle
                aria-hidden="true"
                className={
                  diagnostic.severity === 2
                    ? "mt-px text-cg-warning"
                    : diagnostic.severity === 3 || diagnostic.severity === 4
                      ? "mt-px text-cg-muted"
                      : "mt-px text-cg-danger"
                }
                size={14}
                strokeWidth={1.8}
              />
              <div className="grid min-w-0 gap-[5px]">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] font-bold leading-none text-cg-muted">
                  <span>{severityLabel(diagnostic.severity)}</span>
                  <span>
                    {`Ln ${diagnostic.range.start.line + 1}, Col ${
                      diagnostic.range.start.character + 1
                    }`}
                  </span>
                  {diagnostic.source ? <span>{diagnostic.source}</span> : null}
                  {diagnostic.code !== undefined ? (
                    <span>{String(diagnostic.code)}</span>
                  ) : null}
                </div>
                <div className="min-w-0 whitespace-pre-wrap text-[12px] leading-[1.35] text-cg-fg">
                  {diagnostic.message}
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="text-[12px] leading-[1.4] text-cg-muted">
            No diagnostics for this file.
          </div>
        )}
      </div>
    </section>
  );
}

function compareDiagnostics(left: LspDiagnostic, right: LspDiagnostic) {
  return (
    severityRank(left.severity) - severityRank(right.severity) ||
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character
  );
}

function severityRank(severity: LspDiagnosticSeverity | undefined) {
  switch (severity) {
    case 1:
      return 0;
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 3;
    default:
      return 0;
  }
}

function severityLabel(severity: LspDiagnosticSeverity | undefined) {
  switch (severity) {
    case 2:
      return "Warning";
    case 3:
      return "Info";
    case 4:
      return "Hint";
    default:
      return "Error";
  }
}

function countDiagnostics(diagnostics: LspDiagnostic[]) {
  return diagnostics.reduce(
    (counts, diagnostic) => {
      switch (diagnostic.severity) {
        case 2:
          counts.warning += 1;
          break;
        case 3:
        case 4:
          counts.info += 1;
          break;
        default:
          counts.error += 1;
      }
      return counts;
    },
    { error: 0, info: 0, warning: 0 },
  );
}
