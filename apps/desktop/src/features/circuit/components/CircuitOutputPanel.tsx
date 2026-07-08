import type { RunLine } from "@/features/circuit/core/circuit-run";
import { parseDisplay } from "@/features/editor/components/artifacts/display";
import { OutputDisplay } from "@/features/editor/components/artifacts/OutputDisplay";

export function CircuitOutputPanel({
  exitCode,
  lines,
  running,
}: {
  exitCode: number | null;
  lines: RunLine[];
  running: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-cg-editor">
      <div className="flex items-center gap-2 border-b border-cg-border px-3 py-1.5 text-[11px]">
        <span className="font-medium text-cg-fg">Simulation output</span>
        {running ? (
          <span className="text-cg-muted">running…</span>
        ) : exitCode !== null ? (
          <span className={exitCode === 0 ? "text-cg-muted" : "text-cg-danger"}>
            exit {exitCode}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed">
        {lines.length === 0 && !running ? (
          <p className="text-cg-muted">No output.</p>
        ) : null}
        {lines.map((line, index) => {
          if (line.stream === "display") {
            const display = parseDisplay(line.text);
            if (display) {
              return <OutputDisplay display={display} key={index} />;
            }
            return (
              <pre className="whitespace-pre-wrap text-cg-muted" key={index}>
                {line.text}
              </pre>
            );
          }
          // stderr carries progress bars and warnings (loica/tqdm), not just
          // errors, so it reads as muted secondary text — genuine failures show
          // via the red exit badge above.
          return (
            <pre
              className={
                line.stream === "stderr"
                  ? "whitespace-pre-wrap text-cg-muted"
                  : "whitespace-pre-wrap text-cg-fg"
              }
              key={index}
            >
              {line.text}
            </pre>
          );
        })}
      </div>
    </div>
  );
}
