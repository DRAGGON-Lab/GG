import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
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
  Dna,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "@/ui";

/// The tool stack from the synthetic-biology DBTL workflow: design (loica,
/// sbol3, sbol-utilities), build (pudupy → Opentrons), and test/learn
/// (pyflapjack). Installed together by "Set up synthetic biology project".
const SYNBIO_PACKAGES = [
  "loica",
  "sbol3",
  "sbol-utilities",
  "pudupy",
  "pyflapjack",
];

/// Runnable starter scripts dropped into a new synthetic-biology project, one
/// per DBTL workflow. They use only the standard display protocol — `plt.show()`
/// for figures and `display(obj)` for tables and plate-shaped DataFrames — so
/// they run identically in Bio Eng Studio and any Jupyter environment, with no
/// app-specific import. Existing files of the same name are never overwritten.
const SYNBIO_STARTERS: Record<string, string> = {
  "dbtl_01_design_simulate.py": `"""Design + simulate stage (DBTL design-build-test-learn, simulated build).

A three-node repressilator — the genetic oscillator LOICA generates from NOT-gate
parameters. The dynamics are integrated directly so this runs without external
services; swap in \`loica\` to design from characterized parts. Output renders
through the standard display protocol — \`plt.show()\` for the figure and
\`display(df)\` for the table — so the same code runs in any Jupyter environment.
"""

try:
    display  # Provided by Bio Eng Studio and Jupyter as a builtin.
except NameError:
    from IPython.display import display

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.integrate import odeint
from scipy.signal import find_peaks


def repressilator(state, _t, alpha=216.0, hill=2.0, beta=0.2):
    mrna, protein = state[:3], state[3:]
    repressor = protein[[2, 0, 1]]
    d_mrna = -mrna + alpha / (1.0 + repressor**hill)
    d_protein = -beta * (protein - mrna)
    return np.concatenate([d_mrna, d_protein])


time = np.linspace(0, 60, 2000)
solution = odeint(repressilator, [0.2, 0.1, 0.3, 0.1, 0.4, 0.2], time)
proteins = solution[:, 3:]
labels = ["CFP (cI)", "GFP (LacI)", "RFP (TetR)"]

figure, axes = plt.subplots(figsize=(7, 3))
for index, label in enumerate(labels):
    axes.plot(time, proteins[:, index], label=label)
axes.set(xlabel="time (a.u.)", ylabel="reporter (a.u.)", title="Repressilator")
axes.legend(loc="upper right", fontsize=8)
plt.show()

# A functional oscillator shows more than two peaks per reporter.
peaks = []
for index, label in enumerate(labels):
    found, _ = find_peaks(proteins[:, index], prominence=proteins[:, index].max() * 0.1)
    peaks.append(
        {
            "reporter": label,
            "peaks": len(found),
            "functional": "yes" if len(found) > 2 else "no",
        }
    )
display(pd.DataFrame(peaks))
`,
  "dbtl_02_manual_build.py": `"""Build (manual) + learn stage (DBTL with manual build).

Compare constitutive GFP expression across degradation tags. Software automates
design and learn; the build (assembly, transformation, plating) is manual.
Output renders through the standard display protocol, so the same script runs in
any Jupyter environment.
"""

try:
    display  # Provided by Bio Eng Studio and Jupyter as a builtin.
except NameError:
    from IPython.display import display

import matplotlib.pyplot as plt
import pandas as pd

reporters = pd.DataFrame(
    [
        {"id": "GD0004", "CDS": "sfGFP", "tag": "dum0", "terminator": "B0015"},
        {"id": "GD0005", "CDS": "sfGFP", "tag": "dum33", "terminator": "B0015"},
        {"id": "GD0006", "CDS": "sfGFP", "tag": "M0050", "terminator": "B0015"},
        {"id": "GD0007", "CDS": "GFPmut3", "tag": "dum0", "terminator": "B0015"},
        {"id": "GD0008", "CDS": "GFPmut3", "tag": "dum33", "terminator": "B0015"},
        {"id": "GD0009", "CDS": "GFPmut3", "tag": "M0050", "terminator": "B0015"},
    ]
)
display(reporters)

# A plate-shaped DataFrame (rows A-H, cols 1-12) renders as a 96-well map; in a
# notebook it shows as a table. Each Reporter occupies 4 replicate wells.
plate = pd.DataFrame(index=list("ABCDEFGH"), columns=range(1, 13), dtype=object)
for row, reporter_id in zip("ABCDEF", reporters["id"]):
    for col in range(1, 5):
        plate.loc[row, col] = reporter_id
display(plate)

# The M0050 degradation tag depresses expression and delays growth.
tag_effect = {"dum0": 1.0, "dum33": 0.95, "M0050": 0.45}
reporters["expression"] = [
    tag_effect[tag] * (1.1 if cds == "sfGFP" else 1.0)
    for cds, tag in zip(reporters["CDS"], reporters["tag"])
]
figure, axes = plt.subplots(figsize=(7, 3))
axes.bar(reporters["id"], reporters["expression"], color="#128a3e")
axes.set(ylabel="mean expression rate (MEFL)", title="Degradation-tag effect (N=3)")
plt.setp(axes.get_xticklabels(), rotation=30, ha="right", fontsize=8)
plt.show()
`,
  "dbtl_03_automated_build.py": `"""Build (automated) + learn stage (DBTL with automated build).

Six repressible promoters as constitutive Sources driving sfGFP, assembled by
Golden Gate on an Opentrons OT-2 via PUDU. Output renders through the standard
display protocol; swap the tables for live \`pudupy\` protocol generation to
drive the robot.
"""

try:
    display  # Provided by Bio Eng Studio and Jupyter as a builtin.
except NameError:
    from IPython.display import display

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

promoters = ["GVP0008", "GVP0010", "GVP0012", "GVP0013", "GVP0016", "GVP0017"]
devices = pd.DataFrame(
    [
        {
            "device": f"GVD{11 + index:04d}",
            "promoter": promoter,
            "rbs": "B0034",
            "cds": "sfGFP",
            "terminator": "B0015",
            "receiver": "Odd_1",
        }
        for index, promoter in enumerate(promoters)
    ]
)
display(devices)

# OT-2 deck layout: each device in 4 replicate wells of a 96-well plate.
plate = pd.DataFrame(index=list("ABCDEFGH"), columns=range(1, 13), dtype=object)
for index, device_id in enumerate(devices["device"]):
    for row in "EFGH":
        plate.loc[row, 4 + index] = device_id
display(plate)

rng = np.random.default_rng(1)
figure, axes = plt.subplots(figsize=(7, 3))
axes.bar(promoters, rng.uniform(0.3, 1.0, size=len(promoters)), color="#128a3e")
axes.set(ylabel="mean expression rate (MEFL)", title="Repressible-promoter Sources")
plt.setp(axes.get_xticklabels(), rotation=30, ha="right", fontsize=8)
plt.show()
`,
};

/// Write the starter scripts into the workspace, skipping any that already
/// exist (never clobber the user's files). Returns the names actually written.
async function writeSynbioStarters(root: string): Promise<string[]> {
  const written: string[] = [];
  for (const [name, content] of Object.entries(SYNBIO_STARTERS)) {
    const path = `${root}/${name}`;
    if (await exists(path)) {
      continue;
    }
    await writeTextFile(path, content);
    written.push(name);
  }
  return written;
}

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

  // Stand up a full synthetic-biology DBTL project: ensure the venv, install the
  // tool stack, and drop the runnable starter scripts.
  const setUpSynbio = () =>
    void runOperation(async () => {
      if (!status?.hasVenv) {
        await pythonEnvCreate(root);
      }
      await pythonPackagesInstall(root, SYNBIO_PACKAGES);
      const written = await writeSynbioStarters(root);
      refreshTree();
      setNotice(
        written.length
          ? `Synthetic biology project ready — added ${written.join(", ")}.`
          : "Synthetic biology stack installed. Starter scripts already present.",
      );
    });

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
        onSetUpSynbio={setUpSynbio}
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
        <button
          className="flex w-fit cursor-pointer items-center gap-1 rounded-[6px] border-none bg-transparent p-0 text-[11px] font-medium text-cg-accent transition-opacity duration-150 ease-out hover:opacity-80 disabled:pointer-events-none disabled:opacity-45"
          disabled={busy}
          onClick={setUpSynbio}
          title="Install the loica / sbol3 / sbol-utilities / pudupy / pyflapjack stack and add DBTL starter scripts"
          type="button"
        >
          <Dna aria-hidden="true" size={12} strokeWidth={1.8} />
          Add synthetic biology stack
        </button>
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
  onSetUpSynbio,
  root,
}: {
  busy: boolean;
  log: string[];
  logRef: React.RefObject<HTMLDivElement | null>;
  notice: string | null;
  onCreate: () => void;
  onSetUpSynbio: () => void;
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
            packages and run your scripts against them, all from this panel.
          </p>
          {notice ? (
            <p className="m-0 text-[11px] leading-snug text-cg-danger">
              {notice}
            </p>
          ) : null}
          <Button
            className="mt-1 gap-1.5"
            disabled={busy}
            onClick={onSetUpSynbio}
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
            ) : (
              <Dna aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            Set up synthetic biology project
          </Button>
          <p className="m-0 max-w-[280px] text-[10.5px] leading-snug text-cg-muted">
            Installs the DBTL stack — loica, sbol3, sbol-utilities, pudupy,
            pyflapjack — and adds three runnable starter scripts.
          </p>
          <button
            className="cursor-pointer rounded-[6px] border-none bg-transparent p-0 text-[11px] font-medium text-cg-muted underline-offset-2 hover:text-cg-fg hover:underline disabled:pointer-events-none disabled:opacity-45"
            disabled={busy}
            onClick={onCreate}
            type="button"
          >
            or create an empty environment
          </button>
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
