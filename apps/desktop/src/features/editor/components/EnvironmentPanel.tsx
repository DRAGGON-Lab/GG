import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  type InstalledPackage,
  onPythonEnvOutput,
  pythonEnvCreate,
  type PythonEnvStatus,
  pythonEnvStatus,
  pythonPackagesInstall,
  pythonPackagesList,
  pythonPackagesUninstall,
} from "@/features/editor/core/python-service";
import { useEditorPageContext } from "@/features/editor/editor-page-context";
import { useAsyncResource } from "@/lib/use-async-resource";
import {
  Blocks,
  Button,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "@/ui";

/// Per-workspace Python environment manager. The workspace `.venv` (in the
/// project directory, like `.git`) is created and managed with the bundled
/// `uv`; scripts run with it and its packages are importable. Mirrors the
/// History panel: it reflects the live on-disk environment, whether this app
/// created it or the user did.
export function EnvironmentPanel() {
  const { workspaceRoot, refreshTree, reloadFilesFromDisk } =
    useEditorPageContext();

  if (!workspaceRoot) {
    return <Centered>Open a folder to manage its Python environment.</Centered>;
  }

  return (
    <EnvironmentBody
      refreshTree={refreshTree}
      reloadFilesFromDisk={reloadFilesFromDisk}
      root={workspaceRoot}
    />
  );
}

function EnvironmentBody({
  refreshTree,
  reloadFilesFromDisk,
  root,
}: {
  refreshTree: () => void;
  reloadFilesFromDisk: (paths: string[]) => void;
  root: string;
}) {
  // Bumped after any mutation to re-read the venv status and package list.
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [installText, setInstallText] = useState("");
  const [showTransitive, setShowTransitive] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = () => setEpoch((value) => value + 1);

  const statusResource = useAsyncResource<PythonEnvStatus>(
    `env-status:${root}:${epoch}`,
    () => pythonEnvStatus(root),
  );
  const packagesResource = useAsyncResource<InstalledPackage[]>(
    `env-packages:${root}:${epoch}`,
    () => pythonPackagesList(root),
  );
  const status = statusResource.data;
  const packages = packagesResource.data;

  // Stream uv's progress lines into the log while an operation runs.
  useEffect(() => {
    const unlisten = onPythonEnvOutput((output) => {
      setLog((lines) => [...lines, output.line]);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const node = logRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [log]);

  // Run one environment operation, streaming its output and refreshing after.
  const runOperation = async (operation: () => Promise<unknown>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    setLog([]);
    try {
      await operation();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      refresh();
      // Surface newly written project files (pyproject.toml, uv.lock,
      // .gitignore) in the sidebar, and refresh them if already open, without
      // waiting on the fs watcher.
      refreshTree();
      reloadFilesFromDisk([`${root}/pyproject.toml`, `${root}/uv.lock`]);
    }
  };

  const createEnv = () => void runOperation(() => pythonEnvCreate(root));

  const install = () => {
    const names = installText.split(/\s+/).filter(Boolean);
    if (!names.length) {
      return;
    }
    void runOperation(async () => {
      await pythonPackagesInstall(root, names);
      setInstallText("");
    });
  };

  const uninstall = (name: string) =>
    void runOperation(() => pythonPackagesUninstall(root, [name]));

  if (statusResource.error) {
    return <Centered tone="danger">{statusResource.error}</Centered>;
  }
  if (!status) {
    return <Centered>Checking environment…</Centered>;
  }
  if (!status.hasVenv) {
    return (
      <CreatePrompt
        busy={busy}
        log={log}
        logRef={logRef}
        notice={notice}
        onCreate={createEnv}
        root={root}
      />
    );
  }

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-cg-editor">
      <header className="grid flex-none gap-2 border-b border-cg-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold leading-none text-cg-fg">
            Environment
          </span>
          <button
            aria-label="Refresh"
            className="grid size-7 cursor-pointer place-items-center rounded-[6px] border-transparent bg-transparent p-0 text-cg-muted transition-colors duration-150 ease-out hover:bg-cg-surface-hover hover:text-cg-fg disabled:pointer-events-none disabled:opacity-45"
            disabled={busy}
            onClick={refresh}
            title="Refresh"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={13} strokeWidth={1.8} />
          </button>
        </div>
        <p className="m-0 truncate text-[11px] leading-snug text-cg-muted">
          {notice ?? envStatusLine(status, packages)}
        </p>
        <div className="flex items-center gap-1.5">
          <input
            className="h-8 min-w-0 flex-1 rounded-[7px] border border-cg-border bg-cg-editor px-2.5 text-[12px] text-cg-fg outline-none placeholder:text-cg-muted focus:border-cg-accent"
            disabled={busy}
            onChange={(event) => setInstallText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                install();
              }
            }}
            placeholder="numpy matplotlib seaborn…"
            spellCheck={false}
            value={installText}
          />
          <Button
            className="h-8 flex-none gap-1.5 px-3"
            disabled={busy || !installText.trim()}
            onClick={install}
            size="none"
            variant="default"
          >
            {busy ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                size={13}
                strokeWidth={1.8}
              />
            ) : (
              <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            Install
          </Button>
        </div>
      </header>

      <div className="min-h-0 min-w-0 overflow-y-auto px-1.5 py-1.5">
        {packagesResource.error ? (
          <Centered tone="danger">{packagesResource.error}</Centered>
        ) : !packages ? (
          <Centered>Loading packages…</Centered>
        ) : (
          <PackageList
            busy={busy}
            onToggleTransitive={() => setShowTransitive((open) => !open)}
            onUninstall={uninstall}
            packages={packages}
            showTransitive={showTransitive}
          />
        )}
      </div>

      {log.length ? <ProgressLog log={log} logRef={logRef} /> : null}
    </section>
  );
}

const byName = (a: InstalledPackage, b: InstalledPackage) =>
  a.name.localeCompare(b.name);

/// The installed packages, split into the ones the user declared (direct, the
/// primary content — versioned and removable) and the transitive dependencies
/// pulled in to satisfy them (secondary — tucked behind a disclosure, read-only
/// since they're removed by removing their parent, not on their own).
function PackageList({
  busy,
  onToggleTransitive,
  onUninstall,
  packages,
  showTransitive,
}: {
  busy: boolean;
  onToggleTransitive: () => void;
  onUninstall: (name: string) => void;
  packages: InstalledPackage[];
  showTransitive: boolean;
}) {
  const direct = packages.filter((pkg) => pkg.direct).sort(byName);
  const transitive = packages.filter((pkg) => !pkg.direct).sort(byName);

  return (
    <div className="grid gap-1">
      {direct.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {direct.map((pkg) => (
            <li
              className="group flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 hover:bg-cg-surface-hover"
              key={pkg.name}
            >
              <span
                className="min-w-0 flex-1 truncate text-[12px] leading-snug text-cg-fg"
                title={pkg.name}
              >
                {pkg.name}
              </span>
              <span className="flex-none text-[10.5px] tabular-nums leading-none text-cg-muted">
                {pkg.version}
              </span>
              <button
                aria-label={`Uninstall ${pkg.name}`}
                className="flex-none cursor-pointer rounded-[5px] border-none bg-transparent p-1 text-cg-muted opacity-0 transition-[opacity,color,transform] duration-150 ease-out hover:text-cg-danger focus-visible:opacity-100 group-hover:opacity-100 active:scale-90 disabled:pointer-events-none motion-reduce:transition-none"
                disabled={busy}
                onClick={() => onUninstall(pkg.name)}
                title={`Uninstall ${pkg.name}`}
                type="button"
              >
                <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 px-2.5 py-2 text-[11.5px] leading-snug text-cg-muted">
          No packages added yet. Install one above (e.g. numpy, matplotlib).
        </p>
      )}

      {transitive.length ? (
        <div className="mt-1 border-t border-cg-border pt-1">
          <button
            aria-expanded={showTransitive}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-[7px] border-none bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-cg-muted transition-colors duration-150 ease-out hover:bg-cg-surface-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cg-focus motion-reduce:transition-none"
            onClick={onToggleTransitive}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={`flex-none transition-transform duration-150 ease-out motion-reduce:transition-none ${
                showTransitive ? "rotate-90" : ""
              }`}
              size={12}
              strokeWidth={2}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              {transitive.length} indirect{" "}
              {transitive.length === 1 ? "dependency" : "dependencies"}
            </span>
          </button>
          {showTransitive ? (
            <ul className="m-0 grid list-none gap-0.5 p-0 pt-0.5">
              {transitive.map((pkg) => (
                <li
                  className="flex items-center gap-2 rounded-[7px] py-1 pl-[26px] pr-2.5"
                  key={pkg.name}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[11.5px] leading-snug text-cg-muted"
                    title={pkg.name}
                  >
                    {pkg.name}
                  </span>
                  <span className="flex-none text-[10.5px] tabular-nums leading-none text-cg-muted opacity-70">
                    {pkg.version}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/// A workspace with no `.venv` yet. Offer to create one from the bundled
/// interpreter; afterwards the full package-management view takes over.
function CreatePrompt({
  busy,
  log,
  logRef,
  notice,
  onCreate,
  root,
}: {
  busy: boolean;
  log: string[];
  logRef: React.RefObject<HTMLDivElement | null>;
  notice: string | null;
  onCreate: () => void;
  root: string;
}) {
  const folder = root.split(/[\\/]/).filter(Boolean).pop() ?? "";

  return (
    <section className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-cg-editor">
      <div className="grid place-items-center px-6">
        <div className="grid max-w-[300px] justify-items-center gap-2 text-center">
          <Blocks
            aria-hidden="true"
            className="text-cg-muted opacity-60"
            size={28}
            strokeWidth={1.6}
          />
          <h3 className="m-0 text-[13px] font-bold text-cg-fg">
            {folder || "This folder"} has no Python environment yet
          </h3>
          <p className="m-0 text-[11.5px] leading-snug text-cg-muted">
            Set up a Python project here — <code>pyproject.toml</code>,{" "}
            <code>uv.lock</code>, and a <code>.venv</code> — so you can install
            packages (numpy, matplotlib, …) and run your scripts against them,
            all from this panel.
          </p>
          {notice ? (
            <p className="m-0 text-[11px] leading-snug text-cg-danger">
              {notice}
            </p>
          ) : null}
          <Button
            className="mt-1 gap-1.5"
            disabled={busy}
            onClick={onCreate}
            size="sm"
            variant="default"
          >
            {busy ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                size={13}
                strokeWidth={1.8}
              />
            ) : null}
            Create environment
          </Button>
        </div>
      </div>
      {log.length ? <ProgressLog log={log} logRef={logRef} /> : null}
    </section>
  );
}

/// A scrolling console of the streamed uv output for the running operation.
function ProgressLog({
  log,
  logRef,
}: {
  log: string[];
  logRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className="max-h-[140px] min-w-0 overflow-auto border-t border-cg-border px-3 py-2"
      ref={logRef}
    >
      <pre className="m-0 min-w-0 whitespace-pre-wrap font-mono text-[11px] leading-[1.45] text-cg-muted">
        {log.join("\n")}
      </pre>
    </div>
  );
}

/// Header summary that mirrors the list's split: count the packages the user
/// sees (direct) separately from the dependencies behind the disclosure, so the
/// number never contradicts what's on screen. Falls back to a total before the
/// package list has loaded.
function envStatusLine(
  status: PythonEnvStatus,
  packages: InstalledPackage[] | null,
) {
  const version = status.pythonVersion ?? "Python";

  if (!packages) {
    const total = status.packageCount ?? 0;
    return `${version} · ${total} ${total === 1 ? "package" : "packages"}`;
  }

  const direct = packages.filter((pkg) => pkg.direct).length;
  const transitive = packages.length - direct;

  // With nothing indirect to contrast against, "direct" reads oddly — just say
  // "packages". Otherwise split the counts so the number matches the screen.
  if (transitive === 0) {
    return `${version} · ${direct} ${direct === 1 ? "package" : "packages"}`;
  }
  return `${version} · ${direct} direct, ${transitive} indirect`;
}

function Centered({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="grid h-full place-items-center bg-cg-editor px-6">
      <p
        className={`m-0 max-w-[280px] text-center text-[12px] leading-snug ${
          tone === "danger" ? "text-cg-danger" : "text-cg-muted"
        }`}
      >
        {children}
      </p>
    </div>
  );
}
