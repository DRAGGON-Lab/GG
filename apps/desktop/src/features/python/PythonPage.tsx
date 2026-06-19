import { useCallback, useEffect, useRef, useState } from "react";

import { PythonCodeEditor } from "@/features/python/components/PythonCodeEditor";
import { PythonResult } from "@/features/python/components/PythonResult";
import {
  evaluatePythonCode,
  resetPythonSession,
  warmPythonKernel,
} from "@/features/python/core/python-engine";
import type { PythonEntry } from "@/features/python/types";
import { useAppSettings } from "@/features/settings";
import {
  Button,
  Info,
  Popover,
  RotateCcw,
  SendButton,
  useTheme,
  X,
} from "@/ui";

const pythonPromptClassName =
  "flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-border bg-[color-mix(in_srgb,var(--cg-titlebar-bg),var(--cg-editor-bg)_42%)] px-2.5 py-2 font-mono text-[13px] leading-[1.45] [@container(max-width:520px)]:flex-col [@container(max-width:520px)]:gap-1.5 [&>code]:min-w-0 [&>code]:flex-1 [&>code]:whitespace-pre-wrap [&>code]:[overflow-wrap:anywhere] [&>code]:text-cg-fg [&>span]:shrink-0 [&>span]:rounded-[4px] [&>span]:border [&>span]:border-cg-border [&>span]:bg-cg-editor [&>span]:px-1.5 [&>span]:py-0.5 [&>span]:text-[10.5px] [&>span]:font-bold [&>span]:leading-none [&>span]:text-cg-muted";

const headerIconButtonClassName =
  "size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:border-transparent hover:bg-cg-surface-hover hover:text-cg-fg data-[popup-open]:bg-cg-surface-hover data-[popup-open]:text-cg-fg";

const pythonGuideExample = [
  "values = [n * n for n in range(1, 8)]",
  "total = sum(values)",
  "total",
].join("\n");

export function PythonPage() {
  const [pythonEntries, setPythonEntries] = useState<PythonEntry[]>([]);
  const [pythonCode, setPythonCode] = useState("");
  const [kernelStatus, setKernelStatus] = useState<
    "error" | "ready" | "starting"
  >("starting");
  const [pythonSessionStatus, setPythonSessionStatus] = useState<
    "ready" | "reset" | "resetting"
  >("ready");
  const nextEntryId = useRef(1);
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();
  const pythonBusy = pythonEntries.some(
    (entry) => entry.status === "evaluating",
  );

  useEffect(() => {
    let mounted = true;

    warmPythonKernel()
      .then(() => {
        if (mounted) {
          setKernelStatus("ready");
        }
      })
      .catch(() => {
        if (mounted) {
          setKernelStatus("error");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const evaluatePython = useCallback(
    function () {
      const trimmedCode = pythonCode.trim();

      if (!trimmedCode || pythonBusy) {
        return;
      }

      const code = pythonCode.trimEnd();
      const id = nextEntryId.current;
      nextEntryId.current += 1;

      setPythonEntries((currentPythonEntries) => [
        ...currentPythonEntries,
        {
          code,
          id,
          status: "evaluating",
        },
      ]);
      setPythonCode("");

      void evaluatePythonCode(code)
        .then((evaluation) => {
          setKernelStatus("ready");
          setPythonSessionStatus("ready");
          setPythonEntries((currentPythonEntries) =>
            currentPythonEntries.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    evaluation,
                    status: "ready",
                  }
                : entry,
            ),
          );
        })
        .catch((error: unknown) => {
          setPythonEntries((currentPythonEntries) =>
            currentPythonEntries.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    error:
                      error instanceof Error
                        ? error.message
                        : "Python evaluation failed",
                    status: "failed",
                  }
                : entry,
            ),
          );
        });
    },
    [pythonBusy, pythonCode],
  );

  const useExample = useCallback(function () {
    setPythonCode(pythonGuideExample);
  }, []);

  const resetPython = useCallback(
    function () {
      if (pythonBusy || pythonSessionStatus === "resetting") {
        return;
      }

      setPythonSessionStatus("resetting");
      void resetPythonSession()
        .then(() => {
          setKernelStatus("ready");
          setPythonSessionStatus("reset");
        })
        .catch(() => {
          setKernelStatus("error");
          setPythonSessionStatus("ready");
        });
    },
    [pythonBusy, pythonSessionStatus],
  );

  const status = pythonBusy
    ? "Running Python"
    : pythonSessionStatus === "resetting"
      ? "Resetting Python"
      : pythonSessionStatus === "reset"
        ? "Python session reset"
        : kernelStatus === "ready"
          ? "Python session ready"
          : kernelStatus === "error"
            ? "Kernel unavailable"
            : "Starting Python kernel";
  const historyIsEmpty = pythonEntries.length === 0;

  return (
    <section
      aria-label="Python"
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-[color-mix(in_srgb,var(--cg-editor-bg),var(--cg-surface)_16%)] [container-type:inline-size]"
    >
      <header className="flex min-w-0 items-center gap-3 border-b border-cg-border bg-cg-titlebar px-3 py-1.5">
        <span className="min-w-0 truncate text-[12px] font-semibold leading-none text-cg-fg">
          Python
        </span>
        <div className="min-w-0 flex-1 truncate text-right text-[11.5px] font-medium leading-none text-cg-muted">
          {status}
        </div>
        <Button
          aria-label="Reset Python session"
          className={headerIconButtonClassName}
          disabled={pythonBusy || pythonSessionStatus === "resetting"}
          onClick={resetPython}
          size="none"
          title="Reset Python session"
          type="button"
          variant="bare"
        >
          <RotateCcw aria-hidden="true" size={14} strokeWidth={1.9} />
        </Button>
        <PythonHelpPopover onUseExample={useExample} />
      </header>

      <div
        className={[
          "min-h-0 min-w-0 overflow-auto p-[18px] [@container(max-width:520px)]:p-3.5",
          historyIsEmpty ? "grid place-items-center" : "flex flex-col gap-5",
        ].join(" ")}
        aria-live="polite"
      >
        {historyIsEmpty ? (
          <PythonGuide onUseExample={useExample} />
        ) : (
          pythonEntries.map((entry, index) => (
            <article
              className="mx-auto grid w-full max-w-[980px] gap-3"
              key={entry.id}
            >
              <div className={pythonPromptClassName}>
                <span>{`In[${index + 1}]`}</span>
                <code>{entry.code}</code>
              </div>
              <PythonResult entry={entry} outputNumber={index + 1} />
            </article>
          ))
        )}
      </div>

      <div className="grid gap-2 border-t border-cg-border bg-[color-mix(in_srgb,var(--cg-titlebar-bg),var(--cg-editor-bg)_28%)] px-3 py-[11px]">
        <div className="grid min-w-0 grid-cols-[50px_minmax(0,1fr)] gap-2 [@container(max-width:520px)]:grid-cols-1">
          <span className="mt-2 inline-flex h-[22px] w-[50px] items-center justify-center rounded-[4px] border border-cg-border bg-cg-editor font-mono text-[10.5px] font-bold leading-none text-cg-muted shadow-[inset_0_1px_0_color-mix(in_srgb,var(--cg-fg),transparent_94%)] [@container(max-width:520px)]:mt-0">
            {`In[${pythonEntries.length + 1}]`}
          </span>
          <PythonCodeEditor
            disabled={pythonBusy}
            onChange={setPythonCode}
            onSubmit={evaluatePython}
            resolvedTheme={resolvedTheme}
            textEditorSettings={settings.textEditor}
            value={pythonCode}
          />
        </div>
        <div className="flex min-w-0 items-center justify-end">
          <SendButton
            disabled={pythonBusy || !pythonCode.trim()}
            label="Run Python"
            onClick={evaluatePython}
            title="Run Python"
            type="button"
          />
        </div>
      </div>
    </section>
  );
}

function PythonHelpPopover({ onUseExample }: { onUseExample: () => void }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            aria-label="Show Python guide"
            className={headerIconButtonClassName}
            size="none"
            title="Show Python guide"
            type="button"
            variant="bare"
          >
            <Info aria-hidden="true" size={14} strokeWidth={1.9} />
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          collisionPadding={10}
          side="bottom"
          sideOffset={7}
        >
          <Popover.Popup
            className="z-[2000] grid w-[min(430px,calc(100vw_-_24px))] gap-3 rounded-[7px] border border-cg-border bg-[color-mix(in_srgb,var(--cg-surface),var(--cg-editor-bg)_22%)] p-3.5 text-cg-fg shadow-[0_18px_50px_rgb(0_0_0_/_16%)] focus-visible:outline-none dark:shadow-[0_18px_50px_rgb(0_0_0_/_36%)]"
            initialFocus={false}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <Popover.Title className="m-0 text-[13px] font-semibold leading-none text-cg-fg">
                  Python
                </Popover.Title>
                <Popover.Description className="m-0 max-w-[350px] text-[12px] font-medium leading-[1.45] text-cg-muted">
                  Run multi-line Python in a persistent, offline Pyodide
                  session. Variables and ans remain available until you reset
                  the session, and packages can be installed with await
                  install(...).
                </Popover.Description>
              </div>
              <Popover.Close
                render={
                  <Button
                    aria-label="Close guide"
                    className={headerIconButtonClassName}
                    size="none"
                    title="Close guide"
                    type="button"
                    variant="bare"
                  >
                    <X aria-hidden="true" size={14} strokeWidth={1.9} />
                  </Button>
                }
              />
            </div>
            <div className="grid min-w-0 gap-1.5 rounded-[6px] border border-[color-mix(in_srgb,var(--cg-border),transparent_18%)] bg-cg-editor px-2.5 py-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--cg-fg),transparent_94%)]">
              <div className="text-[10.5px] font-bold uppercase leading-none text-cg-muted">
                Example
              </div>
              <pre className="m-0 min-w-0 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-[1.45] text-cg-fg">
                {pythonGuideExample}
              </pre>
            </div>
            <div>
              <Popover.Close
                render={
                  <Button
                    className="border-[color-mix(in_srgb,var(--cg-accent),var(--cg-border)_46%)] bg-[color-mix(in_srgb,var(--cg-accent),transparent_91%)] text-cg-fg hover:border-cg-accent hover:bg-[color-mix(in_srgb,var(--cg-accent),transparent_84%)]"
                    onClick={onUseExample}
                    size="sm"
                    type="button"
                    variant="subtle"
                  >
                    Use example
                  </Button>
                }
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PythonGuide({ onUseExample }: { onUseExample: () => void }) {
  return (
    <section className="relative mx-auto grid w-full max-w-[760px] gap-3 overflow-hidden rounded-[7px] border border-cg-border bg-[color-mix(in_srgb,var(--cg-surface),var(--cg-editor-bg)_34%)] px-4 py-3.5 shadow-[0_18px_48px_rgb(0_0_0_/_10%)] dark:shadow-[0_18px_48px_rgb(0_0_0_/_28%)]">
      <div className="grid min-w-0 gap-1">
        <div className="text-[13px] font-semibold leading-none text-cg-fg">
          Python
        </div>
        <p className="m-0 max-w-[640px] text-[12px] font-medium leading-[1.45] text-cg-muted">
          Run multi-line Python in a persistent, offline Pyodide session.
          Variables and ans remain available until you reset the session, and
          packages can be installed with await install(...).
        </p>
      </div>
      <div className="grid min-w-0 gap-1.5 rounded-[6px] border border-[color-mix(in_srgb,var(--cg-border),transparent_18%)] bg-cg-editor px-2.5 py-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--cg-fg),transparent_94%)]">
        <div className="text-[10.5px] font-bold uppercase leading-none text-cg-muted">
          Example
        </div>
        <pre className="m-0 min-w-0 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-[1.45] text-cg-fg">
          {pythonGuideExample}
        </pre>
      </div>
      <div>
        <Button
          className="border-[color-mix(in_srgb,var(--cg-accent),var(--cg-border)_46%)] bg-[color-mix(in_srgb,var(--cg-accent),transparent_91%)] text-cg-fg hover:border-cg-accent hover:bg-[color-mix(in_srgb,var(--cg-accent),transparent_84%)]"
          onClick={onUseExample}
          size="sm"
          type="button"
          variant="subtle"
        >
          Use example
        </Button>
      </div>
    </section>
  );
}
