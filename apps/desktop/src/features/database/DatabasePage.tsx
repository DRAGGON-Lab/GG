import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ConfirmDialog } from "@/features/database/components/ConfirmDialog";
import {
  DataGrid,
  type DataGridEditing,
} from "@/features/database/components/DataGrid";
import { SchemaPanel } from "@/features/database/components/SchemaPanel";
import { SqlConsole } from "@/features/database/components/SqlConsole";
import {
  formatBytes,
  formatRowCount,
} from "@/features/database/core/cell-format";
import {
  deleteTableRows,
  loadDatabaseOverview,
  loadTableRows,
  loadTableSchema,
  updateTableCell,
} from "@/features/database/core/database-service";
import type {
  TableRowsPage,
  TableSchema,
  TableSort,
  TableSummary,
} from "@/features/database/types";
import { useAppSettings } from "@/features/settings";
import { useAsyncResource } from "@/lib/use-async-resource";
import type { PageRuntime } from "@/pages/page.types";
import {
  AlertCircle,
  Button,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  LoaderCircle,
  Lock,
  LockOpen,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  useTheme,
} from "@/ui";
import { cx } from "@/ui/class-name";
import { dockviewThemeByMode } from "@/workbench/theme";

const TABLE_PAGE_SIZE = 500;

type Selection = { kind: "console" } | { kind: "table"; name: string };

type TableViewTab = "data" | "schema";

type DatabaseDockPanelParams = {
  render: () => ReactNode;
};

const DATABASE_DOCK_PANEL_COMPONENTS = {
  databasePanel: DatabaseDockPanel,
};

const DATABASE_DOCK_PANEL_IDS = {
  data: "database-data",
  schema: "database-schema",
} as const satisfies Record<TableViewTab, string>;

const tableRowButtonClassName =
  "!grid h-7 w-full grid-cols-[15px_minmax(0,1fr)_max-content] items-center justify-stretch gap-[7px] rounded-[7px] border-transparent bg-transparent px-2 text-left text-cg-sidebar-fg hover:border-transparent hover:bg-cg-sidebar-hover hover:text-cg-fg data-active:border-cg-border data-active:bg-cg-sidebar-hover data-active:font-semibold data-active:text-cg-fg";

const sidebarIconButtonClassName =
  "size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg";

const databaseDockHeaderButtonClassName =
  "size-6 rounded-[6px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg";

export function DatabasePage(_props: PageRuntime) {
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [rowsRevision, setRowsRevision] = useState(0);
  const [selection, setSelection] = useState<Selection>({ kind: "console" });
  const [tableFilter, setTableFilter] = useState("");
  const [showInternal, setShowInternal] = useState(false);
  const [tableTab, setTableTab] = useState<TableViewTab>("data");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [schemaByTable, setSchemaByTable] = useState<
    Record<string, TableSchema>
  >({});
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [consoleSql, setConsoleSql] = useState("");
  const [pathCopied, setPathCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [confirmEditOpen, setConfirmEditOpen] = useState(false);
  const databaseDockApiRef = useRef<DockviewApi | null>(null);

  const selectedTable = selection.kind === "table" ? selection.name : null;
  const selectedSchema = selectedTable ? schemaByTable[selectedTable] : null;

  const overviewResource = useAsyncResource(String(overviewRevision), () =>
    loadDatabaseOverview(),
  );
  const overview = overviewResource.data;
  const overviewError = overviewResource.error;
  const overviewLoading = overviewResource.loading;

  const refreshOverview = useCallback(() => {
    setOverviewRevision((revision) => revision + 1);
  }, []);

  const rowsKey = selectedTable
    ? [
        rowsRevision,
        offset,
        sort?.column ?? "",
        sort?.descending ?? false,
        selectedTable,
      ].join("|")
    : null;
  const rowsResource = useAsyncResource<TableRowsPage>(rowsKey, () =>
    loadTableRows({
      descending: sort?.descending ?? false,
      limit: TABLE_PAGE_SIZE,
      offset,
      orderBy: sort?.column ?? null,
      table: selectedTable ?? "",
    }),
  );
  const rowsPage = rowsResource.data;
  const rowsError = rowsResource.error;
  const rowsLoading = rowsResource.loading;
  const clearRows = rowsResource.mutate;

  const refreshRows = useCallback(() => {
    setRowsRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (
      !selectedTable ||
      tableTab !== "schema" ||
      schemaByTable[selectedTable]
    ) {
      return;
    }

    loadTableSchema(selectedTable)
      .then((schema) => {
        setSchemaByTable((cache) => ({ ...cache, [selectedTable]: schema }));
        setSchemaError(null);
      })
      .catch((error: unknown) => {
        setSchemaError(error instanceof Error ? error.message : String(error));
      });
  }, [schemaByTable, selectedTable, tableTab]);

  const selectTable = useCallback(
    (name: string) => {
      setSelection({ kind: "table", name });
      setTableTab("data");
      setOffset(0);
      setSort(null);
      clearRows(null);
      setEditMode(false);
    },
    [clearRows],
  );

  const commitCell = useCallback(
    async (rowIndex: number, columnIndex: number, value: string | null) => {
      const rowIds = rowsPage?.rowIds;
      if (!selectedTable || !rowsPage || !rowIds) {
        throw new Error("this table cannot be edited");
      }

      // Text comes back from the editor; numeric cells keep their storage
      // class so no-affinity columns don't silently turn into text.
      const cell = rowsPage.result.rows[rowIndex][columnIndex];
      let outgoing: string | number | null = value;
      if (
        value !== null &&
        value.trim() !== "" &&
        (cell.type === "integer" || cell.type === "real")
      ) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          outgoing = numeric;
        }
      }

      await updateTableCell({
        column: rowsPage.result.columns[columnIndex],
        rowId: rowIds[rowIndex],
        table: selectedTable,
        value: outgoing,
      });
      refreshRows();
    },
    [refreshRows, rowsPage, selectedTable],
  );

  const deleteRows = useCallback(
    async (rowIndexes: readonly number[]) => {
      const rowIds = rowsPage?.rowIds;
      if (!selectedTable || !rowIds) {
        throw new Error("this table cannot be edited");
      }

      await deleteTableRows({
        rowIds: rowIndexes.map((rowIndex) => rowIds[rowIndex]),
        table: selectedTable,
      });
      refreshOverview();
      refreshRows();
    },
    [refreshOverview, refreshRows, rowsPage, selectedTable],
  );

  const handleSort = useCallback((column: string) => {
    setOffset(0);
    setSort((current) => {
      const next =
        current?.column !== column
          ? { column, descending: false }
          : current.descending
            ? null
            : { column, descending: true };
      return next;
    });
  }, []);

  /// After any successful write, counts, rows, and cached schemas may all be
  /// stale — drop everything and refetch what is visible.
  const handleDidWrite = useCallback(() => {
    setSchemaByTable({});
    refreshOverview();
    refreshRows();
  }, [refreshOverview, refreshRows]);

  const openInConsole = useCallback((table: string) => {
    setConsoleSql(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 100;`);
    setSelection({ kind: "console" });
  }, []);

  const panelRenders = useMemo(
    () => ({
      data: () => (
        <div className="grid h-full min-h-0 min-w-0 p-4">
          <TableDataView
            editMode={editMode}
            error={rowsError}
            loading={rowsLoading}
            offset={offset}
            onCommitCell={commitCell}
            onDeleteRows={deleteRows}
            onPage={setOffset}
            onSort={handleSort}
            page={rowsPage}
            sort={sort}
          />
        </div>
      ),
      schema: () => (
        <div className="grid h-full min-h-0 min-w-0 p-4">
          {selectedSchema ? (
            <SchemaPanel schema={selectedSchema} />
          ) : schemaError ? (
            <ErrorNote message={schemaError} />
          ) : (
            <LoadingNote label="Loading schema…" />
          )}
        </div>
      ),
    }),
    [
      commitCell,
      deleteRows,
      editMode,
      handleSort,
      offset,
      rowsError,
      rowsLoading,
      rowsPage,
      schemaError,
      selectedSchema,
      sort,
    ],
  );

  const handleDatabaseDockReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      databaseDockApiRef.current = api;

      const dataPanel = api.addPanel<DatabaseDockPanelParams>({
        component: "databasePanel",
        id: DATABASE_DOCK_PANEL_IDS.data,
        params: { render: panelRenders.data },
        title: "Data",
      });
      api.addPanel<DatabaseDockPanelParams>({
        component: "databasePanel",
        id: DATABASE_DOCK_PANEL_IDS.schema,
        params: { render: panelRenders.schema },
        position: { direction: "within", referencePanel: dataPanel },
        title: "Schema",
      });

      api.onDidActivePanelChange((panel) => {
        const isSchema = panel?.id === DATABASE_DOCK_PANEL_IDS.schema;
        setTableTab(isSchema ? "schema" : "data");
      });

      requestAnimationFrame(() => {
        api.getPanel(DATABASE_DOCK_PANEL_IDS.data)?.api.setActive();
      });
    },
    [panelRenders],
  );

  useEffect(() => {
    const api = databaseDockApiRef.current;

    if (!api) {
      return;
    }

    api
      .getPanel(DATABASE_DOCK_PANEL_IDS.data)
      ?.api.updateParameters({ render: panelRenders.data });
    api
      .getPanel(DATABASE_DOCK_PANEL_IDS.schema)
      ?.api.updateParameters({ render: panelRenders.schema });
  }, [panelRenders]);

  useEffect(() => {
    if (!selectedTable) {
      return;
    }

    databaseDockApiRef.current
      ?.getPanel(DATABASE_DOCK_PANEL_IDS.data)
      ?.api.setActive();
  }, [selectedTable]);

  useEffect(() => {
    if (selection.kind !== "table") {
      databaseDockApiRef.current = null;
    }
  }, [selection.kind]);

  useEffect(
    () => () => {
      databaseDockApiRef.current = null;
    },
    [],
  );

  const DatabaseDockRightActions = useMemo(
    () =>
      function DatabaseDockRightActions(_props: IDockviewHeaderActionsProps) {
        if (selection.kind !== "table") {
          return null;
        }

        return (
          <div className="flex h-full items-center gap-0.5 px-1">
            {tableTab === "data" ? (
              <Button
                aria-label={editMode ? "Disable edit mode" : "Enable edit mode"}
                className={cx(
                  databaseDockHeaderButtonClassName,
                  editMode ? "text-cg-danger hover:text-cg-danger" : undefined,
                )}
                disabled={rowsPage !== null && rowsPage.rowIds === null}
                onClick={() => {
                  if (editMode) {
                    setEditMode(false);
                  } else {
                    setConfirmEditOpen(true);
                  }
                }}
                size="none"
                title={
                  rowsPage !== null && rowsPage.rowIds === null
                    ? "This table cannot be edited (rows are not rowid-addressable)"
                    : editMode
                      ? "Disable edit mode"
                      : "Enable edit mode"
                }
                variant="bare"
              >
                {editMode ? (
                  <LockOpen aria-hidden="true" size={14} strokeWidth={1.8} />
                ) : (
                  <Lock aria-hidden="true" size={14} strokeWidth={1.8} />
                )}
              </Button>
            ) : null}
            <Button
              aria-label="Open in SQL console"
              className={databaseDockHeaderButtonClassName}
              onClick={() => openInConsole(selection.name)}
              size="none"
              title="Open in SQL console"
              variant="bare"
            >
              <Code2 aria-hidden="true" size={14} strokeWidth={1.8} />
            </Button>
          </div>
        );
      },
    [editMode, openInConsole, rowsPage, selection, tableTab],
  );

  const { groups: tableGroups, internalTables } = useMemo(
    () => groupTables(overview?.tables ?? [], tableFilter),
    [overview, tableFilter],
  );

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[248px_minmax(0,1fr)] bg-cg-editor">
      <aside
        aria-label="Database tables"
        className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-cg-border bg-cg-sidebar"
      >
        <div className="grid min-w-0 gap-2 border-b border-cg-border px-3 pb-2.5 pt-3">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_max-content] items-center gap-2">
            <div className="text-[13px] font-[690] leading-none text-cg-fg">
              Database
            </div>
            <div className="flex items-center gap-0.5">
              <Button
                aria-label="Refresh"
                className={sidebarIconButtonClassName}
                onClick={refreshOverview}
                size="none"
                title="Refresh"
                variant="bare"
              >
                {overviewLoading ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={14}
                    strokeWidth={1.8}
                  />
                ) : (
                  <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
                )}
              </Button>
            </div>
          </div>
          <label className="grid h-7 min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-[7px] rounded-[7px] border border-cg-border bg-cg-surface px-[9px] text-cg-muted focus-within:border-cg-focus">
            <Search aria-hidden="true" size={14} strokeWidth={1.8} />
            <span className="sr-only">Filter tables</span>
            <input
              className="min-w-0 border-0 bg-transparent font-[inherit] text-[12px] leading-none text-cg-fg outline-0 placeholder:text-cg-muted"
              onChange={(event) => setTableFilter(event.currentTarget.value)}
              placeholder="Filter tables"
              value={tableFilter}
            />
          </label>
        </div>

        <nav
          aria-label="Tables"
          className="grid min-h-0 min-w-0 content-start gap-0.5 overflow-auto p-2"
        >
          <Button
            aria-current={selection.kind === "console" ? "page" : undefined}
            className={tableRowButtonClassName}
            data-active={selection.kind === "console" ? "" : undefined}
            onClick={() => setSelection({ kind: "console" })}
            size="none"
            variant="bare"
          >
            <Code2 aria-hidden="true" size={14} strokeWidth={1.75} />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] leading-none">
              SQL Console
            </span>
            <span />
          </Button>

          {tableGroups.map((group) => (
            <div
              className="mt-1 grid min-w-0 content-start gap-0.5 border-t border-cg-border pt-2"
              key={group.label}
            >
              <div className="px-2 pb-0.5 text-[10.5px] font-bold uppercase leading-none text-cg-muted">
                {group.label}
              </div>
              {group.tables.map((table) => (
                <TableRowButton
                  key={table.name}
                  onSelect={selectTable}
                  selected={selectedTable === table.name}
                  table={table}
                />
              ))}
            </div>
          ))}

          {internalTables.length > 0 ? (
            <div className="mt-1 grid min-w-0 content-start gap-0.5 border-t border-cg-border pt-2">
              <button
                aria-expanded={showInternal}
                className="grid h-6 w-full cursor-default grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-[5px] rounded-[5px] border border-transparent bg-transparent px-1.5 text-left font-[inherit] text-cg-muted hover:bg-cg-sidebar-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus"
                onClick={() => setShowInternal((show) => !show)}
                type="button"
              >
                {showInternal ? (
                  <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} />
                ) : (
                  <ChevronRight
                    aria-hidden="true"
                    size={13}
                    strokeWidth={1.8}
                  />
                )}
                <span className="text-[10.5px] font-bold uppercase leading-none">
                  Internal
                </span>
                <span className="text-[10.5px] font-medium leading-none">
                  {internalTables.length}
                </span>
              </button>
              {showInternal
                ? internalTables.map((table) => (
                    <TableRowButton
                      key={table.name}
                      onSelect={selectTable}
                      selected={selectedTable === table.name}
                      table={table}
                    />
                  ))
                : null}
            </div>
          ) : null}

          {overview !== null &&
          tableGroups.length === 0 &&
          internalTables.length === 0 ? (
            <div className="px-2 py-3 text-[12px] font-medium leading-normal text-cg-muted">
              No matching tables
            </div>
          ) : null}
        </nav>

        <footer className="grid min-w-0 gap-1 border-t border-cg-border px-3 py-2">
          {overview ? (
            <>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span
                  className="min-w-0 truncate font-mono text-[11px] font-bold leading-none text-cg-sidebar-fg"
                  title={overview.path}
                >
                  {fileName(overview.path)}
                </span>
                <Button
                  aria-label={pathCopied ? "Copied" : "Copy database path"}
                  className="size-6 rounded-[6px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(shellQuote(overview.path))
                      .then(() => {
                        setPathCopied(true);
                        window.setTimeout(() => setPathCopied(false), 1600);
                      });
                  }}
                  size="none"
                  title={pathCopied ? "Copied" : "Copy database path"}
                  variant="bare"
                >
                  {pathCopied ? (
                    <CheckCircle2
                      aria-hidden="true"
                      size={12}
                      strokeWidth={1.9}
                    />
                  ) : (
                    <Copy aria-hidden="true" size={12} strokeWidth={1.9} />
                  )}
                </Button>
              </div>
              <span className="text-[10.5px] leading-[1.5] text-cg-muted">
                {overview.fileSizeBytes !== null
                  ? `${formatBytes(overview.fileSizeBytes)} · `
                  : ""}
                schema v{overview.schemaVersion} · SQLite{" "}
                {overview.sqliteVersion} · journal {overview.journalMode}
              </span>
            </>
          ) : overviewError ? (
            <span
              className="inline-flex min-w-0 items-center gap-1.5 text-[10.5px] leading-[1.5] text-cg-danger"
              title={overviewError}
            >
              <AlertCircle
                aria-hidden="true"
                className="shrink-0"
                size={12}
                strokeWidth={1.9}
              />
              <span className="min-w-0 truncate">{overviewError}</span>
            </span>
          ) : (
            <span className="text-[10.5px] leading-[1.5] text-cg-muted">
              Loading database overview…
            </span>
          )}
        </footer>
      </aside>

      <section className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden">
        {selection.kind === "console" ? (
          <div className="grid min-h-0 min-w-0 p-4">
            <SqlConsole
              onDidWrite={handleDidWrite}
              onSqlChange={setConsoleSql}
              resolvedTheme={resolvedTheme}
              sql={consoleSql}
              textEditorSettings={settings.textEditor}
            />
          </div>
        ) : (
          <div className="grid min-h-0 min-w-0">
            <DockviewReact
              components={DATABASE_DOCK_PANEL_COMPONENTS}
              dndStrategy="pointer"
              noPanelsOverlay="emptyGroup"
              onReady={handleDatabaseDockReady}
              rightHeaderActionsComponent={DatabaseDockRightActions}
              theme={dockviewThemeByMode[resolvedTheme]}
            />

            <ConfirmDialog
              confirmLabel="Enable Editing"
              description="Edit mode lets you change cell values and delete rows directly — there is no undo. Consider creating a backup first (Settings → Backup). Editing turns off when you pick another table."
              onConfirm={() => {
                setEditMode(true);
                setConfirmEditOpen(false);
              }}
              onOpenChange={setConfirmEditOpen}
              open={confirmEditOpen}
              title="Enable edit mode?"
            />
          </div>
        )}
      </section>
    </div>
  );
}

function DatabaseDockPanel({
  params,
}: IDockviewPanelProps<DatabaseDockPanelParams>) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      {params.render()}
    </div>
  );
}

function TableDataView({
  editMode,
  error,
  loading,
  offset,
  onCommitCell,
  onDeleteRows,
  onPage,
  onSort,
  page,
  sort,
}: {
  editMode: boolean;
  error: string | null;
  loading: boolean;
  offset: number;
  onCommitCell: (
    rowIndex: number,
    columnIndex: number,
    value: string | null,
  ) => Promise<void>;
  onDeleteRows: (rowIndexes: number[]) => Promise<void>;
  onPage: (offset: number) => void;
  onSort: (column: string) => void;
  page: TableRowsPage | null;
  sort: TableSort | null;
}) {
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [prevPage, setPrevPage] = useState(page);

  if (prevPage !== page) {
    setPrevPage(page);
    setSelectedRows(new Set());
    setDeleteError(null);
  }

  if (error) {
    return <ErrorNote message={error} />;
  }

  if (!page) {
    return <LoadingNote label="Loading rows…" />;
  }

  const firstRow = page.totalRows === 0 ? 0 : offset + 1;
  const lastRow = Math.min(offset + page.result.rows.length, page.totalRows);
  const editing: DataGridEditing | undefined =
    editMode && page.rowIds !== null
      ? {
          onCommitCell,
          onToggleAllRows: () =>
            setSelectedRows((current) =>
              current.size === page.result.rows.length
                ? new Set()
                : new Set(page.result.rows.map((_, rowIndex) => rowIndex)),
            ),
          onToggleRow: (rowIndex) =>
            setSelectedRows((current) => {
              const next = new Set(current);
              if (next.has(rowIndex)) {
                next.delete(rowIndex);
              } else {
                next.add(rowIndex);
              }
              return next;
            }),
          selectedRows,
        }
      : undefined;
  const selectedCount = selectedRows.size;

  function confirmDelete() {
    if (deleteBusy) {
      return;
    }

    setDeleteBusy(true);
    onDeleteRows([...selectedRows])
      .then(() => {
        setSelectedRows(new Set());
        setDeleteError(null);
      })
      .catch((error: unknown) => {
        setDeleteError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setDeleteBusy(false);
        setConfirmDeleteOpen(false);
      });
  }

  return (
    <div
      className={cx(
        "grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2",
        loading ? "opacity-60" : undefined,
      )}
    >
      <DataGrid
        editing={editing}
        emptyMessage="This table is empty."
        onSort={onSort}
        result={page.result}
        sortColumn={sort?.column ?? null}
        sortDescending={sort?.descending ?? false}
      />
      <footer className="flex items-center gap-2 text-[11.5px] leading-none text-cg-muted">
        <span>
          {formatRowCount(firstRow)}–{formatRowCount(lastRow)} of{" "}
          {formatRowCount(page.totalRows)} rows
        </span>
        {editing && selectedCount > 0 ? (
          <Button
            className="h-[22px] border-cg-danger px-2 text-[11.5px] text-cg-danger hover:border-cg-danger hover:text-cg-danger"
            disabled={deleteBusy}
            onClick={() => setConfirmDeleteOpen(true)}
            size="none"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" size={12} strokeWidth={1.9} />
            Delete {formatRowCount(selectedCount)} row
            {selectedCount === 1 ? "" : "s"}
          </Button>
        ) : null}
        {deleteError ? (
          <span className="min-w-0 truncate text-cg-danger">{deleteError}</span>
        ) : null}
        <ConfirmDialog
          confirmLabel={`Delete ${formatRowCount(selectedCount)} Row${selectedCount === 1 ? "" : "s"}`}
          description="Deleted rows cannot be recovered. Foreign-key cascades may also remove related rows in other tables."
          onConfirm={confirmDelete}
          onOpenChange={setConfirmDeleteOpen}
          open={confirmDeleteOpen}
          title={`Delete ${formatRowCount(selectedCount)} selected row${selectedCount === 1 ? "" : "s"}?`}
        />
        <span className="ml-auto inline-flex items-center gap-1">
          <Button
            disabled={offset === 0 || loading}
            onClick={() => onPage(Math.max(0, offset - TABLE_PAGE_SIZE))}
            size="sm"
            variant="ghost"
          >
            <ChevronRight
              aria-hidden="true"
              className="rotate-180"
              size={12}
              strokeWidth={2}
            />
            Previous
          </Button>
          <Button
            disabled={lastRow >= page.totalRows || loading}
            onClick={() => onPage(offset + TABLE_PAGE_SIZE)}
            size="sm"
            variant="ghost"
          >
            Next
            <ChevronRight aria-hidden="true" size={12} strokeWidth={2} />
          </Button>
        </span>
      </footer>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 self-start rounded-[7px] border border-cg-danger px-3 py-2.5 text-[12.5px] leading-relaxed text-cg-danger">
      <AlertCircle
        aria-hidden="true"
        className="mt-[1px] shrink-0"
        size={14}
        strokeWidth={1.9}
      />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

function LoadingNote({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-2 self-start px-1 py-2 text-[12.5px] text-cg-muted">
      <LoaderCircle
        aria-hidden="true"
        className="animate-spin"
        size={14}
        strokeWidth={1.9}
      />
      {label}
    </div>
  );
}

function fileName(path: string) {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

// Escape a filesystem path for safe pasting into a terminal. Windows paths
// (e.g. "C:\…") are wrapped in double quotes, which both cmd.exe and
// PowerShell accept and which leaves the backslash separators intact. POSIX
// paths get spaces and shell metacharacters backslash-escaped (e.g.
// "Application Support" becomes "Application\ Support").
function shellQuote(path: string) {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) {
    return `"${path}"`;
  }
  return path.replace(/[^A-Za-z0-9,._+:@%/-]/g, "\\$&");
}

function TableRowButton({
  onSelect,
  selected,
  table,
}: {
  onSelect: (name: string) => void;
  selected: boolean;
  table: TableSummary;
}) {
  return (
    <Button
      aria-current={selected ? "page" : undefined}
      className={tableRowButtonClassName}
      data-active={selected ? "" : undefined}
      onClick={() => onSelect(table.name)}
      size="none"
      variant="bare"
    >
      <Table2 aria-hidden="true" size={14} strokeWidth={1.75} />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] leading-none">
        {table.name}
      </span>
      <span className="text-[11px] font-medium leading-none tabular-nums text-cg-muted">
        {table.rowCount !== null ? formatRowCount(table.rowCount) : ""}
      </span>
    </Button>
  );
}

function groupTables(tables: readonly TableSummary[], filter: string) {
  const query = filter.trim().toLowerCase();
  const matches = (table: TableSummary) =>
    query === "" || table.name.toLowerCase().includes(query);

  const groups = [
    {
      label: "Tables",
      tables: tables.filter(
        (table) => table.kind === "table" && matches(table),
      ),
    },
    {
      label: "Search Indexes",
      tables: tables.filter(
        (table) => table.kind === "virtual" && matches(table),
      ),
    },
    {
      label: "Views",
      tables: tables.filter((table) => table.kind === "view" && matches(table)),
    },
  ];

  return {
    groups: groups.filter((group) => group.tables.length > 0),
    internalTables: tables.filter(
      (table) =>
        (table.kind === "shadow" || table.kind === "internal") &&
        matches(table),
    ),
  };
}
