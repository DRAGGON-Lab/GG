import { useEffect, useRef } from "react";

import { OutputDisplay } from "@/features/editor/components/artifacts/OutputDisplay";
import { useEditorPageContext } from "@/features/editor/editor-page-context";
import { Button, Play } from "@/ui";

/// The run console: streams stdout/stderr from `python_run_script` and shows the
/// exit code. Driven by the shared run state in the page context.
export function OutputPanel() {
  const { run } = useEditorPageContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;

    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [run.lines]);

  const statusLabel =
    run.status === "running"
      ? "Running…"
      : run.status === "done"
        ? run.exitCode === 0
          ? "Exited 0"
          : `Exited ${run.exitCode ?? "?"}`
        : "Idle";

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-cg-editor">
      <div className="flex min-w-0 items-center gap-2 border-b border-cg-border px-3 py-2.5">
        <span className="text-[12px] font-bold leading-none text-cg-fg">
          Output
        </span>
        <Button
          className="h-[24px] gap-1.5 rounded-[6px] border-transparent bg-transparent px-1.5 text-[11.5px] text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg"
          disabled={run.status === "running" || !run.available}
          onClick={run.run}
          size="none"
          title={run.available ? "Run the active file" : run.runtimeLabel}
          variant="bare"
        >
          <Play aria-hidden="true" size={12} strokeWidth={2} />
          Run
        </Button>
        <span
          className={[
            "ml-auto text-[11px] font-semibold leading-none",
            run.status === "done" && run.exitCode !== 0 && run.exitCode !== null
              ? "text-cg-danger"
              : "text-cg-muted",
          ].join(" ")}
        >
          {statusLabel}
        </span>
      </div>
      <div
        className="min-h-0 min-w-0 overflow-auto px-3 py-2.5"
        ref={scrollRef}
      >
        {run.lines.length ? (
          <pre className="m-0 min-w-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.45]">
            {run.lines.map((line) =>
              line.stream === "display" && line.display ? (
                <OutputDisplay display={line.display} key={line.id} />
              ) : (
                <span
                  className={
                    line.stream === "stderr" ? "text-cg-danger" : "text-cg-fg"
                  }
                  key={line.id}
                >
                  {line.text}
                  {"\n"}
                </span>
              ),
            )}
          </pre>
        ) : (
          <div className="text-[12px] leading-[1.4] text-cg-muted">
            Run the active file to see output here.
          </div>
        )}
      </div>
    </section>
  );
}
