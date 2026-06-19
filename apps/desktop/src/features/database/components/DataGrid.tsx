import { useState } from "react";

import {
  cellDetailText,
  cellText,
  formatBytes,
} from "@/features/database/core/cell-format";
import type { CellValue, QueryResult } from "@/features/database/types";
import { ArrowDown, ArrowUp, Button, Dialog } from "@/ui";
import { cx } from "@/ui/class-name";
import {
  appDialogBackdropClassName,
  appDialogPopupClassName,
} from "@/ui/primitives/dialog-classes";

const MAX_INLINE_CELL_CHARS = 200;

type SelectedCell = {
  cell: CellValue;
  column: string;
  columnIndex: number;
  rowIndex: number;
};

export type DataGridEditing = {
  onCommitCell: (
    rowIndex: number,
    columnIndex: number,
    value: string | null,
  ) => Promise<void>;
  onToggleAllRows: () => void;
  onToggleRow: (rowIndex: number) => void;
  selectedRows: ReadonlySet<number>;
};

type DataGridProps = {
  editing?: DataGridEditing;
  emptyMessage?: string;
  onSort?: (column: string) => void;
  result: QueryResult;
  sortColumn?: string | null;
  sortDescending?: boolean;
};

export function DataGrid({
  editing,
  emptyMessage = "No rows.",
  onSort,
  result,
  sortColumn = null,
  sortDescending = false,
}: DataGridProps) {
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  if (result.columns.length === 0) {
    return null;
  }

  const allRowsSelected =
    editing !== undefined &&
    result.rows.length > 0 &&
    editing.selectedRows.size === result.rows.length;

  return (
    <div className="min-h-0 min-w-0 overflow-auto rounded-[7px] border border-cg-border bg-cg-editor">
      <table className="w-full border-collapse font-mono text-[12px] leading-[1.35]">
        <thead>
          <tr>
            {editing ? (
              <th
                className="sticky top-0 z-[1] w-7 bg-cg-titlebar px-2 py-[7px] shadow-[inset_0_-1px_0_var(--cg-border)]"
                scope="col"
              >
                <input
                  aria-label="Select all rows"
                  checked={allRowsSelected}
                  className="block size-[13px] accent-cg-accent"
                  onChange={editing.onToggleAllRows}
                  type="checkbox"
                />
              </th>
            ) : null}
            {result.columns.map((column) => (
              <th
                className={cx(
                  // shadow, not border-b: collapsed borders detach from
                  // sticky headers and scroll away with the rows
                  "sticky top-0 z-[1] whitespace-nowrap bg-cg-titlebar px-2.5 py-[7px] text-left text-[11px] font-bold text-cg-muted shadow-[inset_0_-1px_0_var(--cg-border)]",
                  onSort
                    ? "cursor-default select-none hover:text-cg-fg"
                    : undefined,
                )}
                key={column}
                onClick={onSort ? () => onSort(column) : undefined}
                scope="col"
              >
                <span className="inline-flex items-center gap-1">
                  {column}
                  {sortColumn === column ? (
                    sortDescending ? (
                      <ArrowDown aria-label="sorted descending" size={11} />
                    ) : (
                      <ArrowUp aria-label="sorted ascending" size={11} />
                    )
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr
              className={cx(
                "hover:bg-cg-surface-hover",
                editing?.selectedRows.has(rowIndex)
                  ? "bg-cg-surface-hover"
                  : undefined,
              )}
              key={rowIndex}
            >
              {editing ? (
                <td className="w-7 border-b border-cg-border px-2 py-[5px] align-top">
                  <input
                    aria-label={`Select row ${rowIndex + 1}`}
                    checked={editing.selectedRows.has(rowIndex)}
                    className="block size-[13px] accent-cg-accent"
                    onChange={() => editing.onToggleRow(rowIndex)}
                    type="checkbox"
                  />
                </td>
              ) : null}
              {row.map((cell, columnIndex) => (
                <GridCell
                  cell={cell}
                  key={columnIndex}
                  onSelect={() =>
                    setSelectedCell({
                      cell,
                      column: result.columns[columnIndex],
                      columnIndex,
                      rowIndex,
                    })
                  }
                />
              ))}
            </tr>
          ))}
          {result.rows.length === 0 ? (
            <tr>
              <td
                className="px-2.5 py-6 text-center font-sans text-[12px] text-cg-muted"
                colSpan={result.columns.length + (editing ? 1 : 0)}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <CellDetailDialog
        onClose={() => setSelectedCell(null)}
        onCommitCell={editing?.onCommitCell}
        selectedCell={selectedCell}
      />
    </div>
  );
}

function GridCell({
  cell,
  onSelect,
}: {
  cell: CellValue;
  onSelect: () => void;
}) {
  const numeric = cell.type === "integer" || cell.type === "real";
  let content: string;
  let clipped = false;

  if (cell.type === "null") {
    content = "NULL";
  } else if (cell.type === "blob") {
    content = `BLOB · ${formatBytes(cell.length)}`;
  } else {
    content = cellText(cell);
    if (content.length > MAX_INLINE_CELL_CHARS) {
      content = `${content.slice(0, MAX_INLINE_CELL_CHARS)}…`;
      clipped = true;
    }
    if (cell.type === "text" && cell.fullLength !== undefined) {
      clipped = true;
    }
  }

  return (
    <td
      className={cx(
        "max-w-[420px] cursor-default truncate whitespace-pre border-b border-cg-border px-2.5 py-[5px] align-top text-cg-fg",
        numeric ? "text-right tabular-nums" : undefined,
        cell.type === "null" ? "italic text-cg-muted" : undefined,
        cell.type === "blob" ? "text-cg-muted" : undefined,
      )}
      onClick={onSelect}
      title={clipped ? "Click to view the full value" : undefined}
    >
      {content}
    </td>
  );
}

function CellDetailDialog({
  onClose,
  onCommitCell,
  selectedCell,
}: {
  onClose: () => void;
  onCommitCell?: (
    rowIndex: number,
    columnIndex: number,
    value: string | null,
  ) => Promise<void>;
  selectedCell: SelectedCell | null;
}) {
  const [draft, setDraft] = useState("");
  const [draftIsNull, setDraftIsNull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [prevSelectedCell, setPrevSelectedCell] = useState(selectedCell);

  if (prevSelectedCell !== selectedCell) {
    setPrevSelectedCell(selectedCell);
    if (selectedCell) {
      setDraft(
        selectedCell.cell.type === "null" ? "" : cellText(selectedCell.cell),
      );
      setDraftIsNull(selectedCell.cell.type === "null");
      setSaving(false);
      setSaveError(null);
    }
  }

  const cell = selectedCell?.cell ?? null;
  const truncatedText = cell?.type === "text" && cell.fullLength !== undefined;
  const editable =
    onCommitCell !== undefined &&
    cell !== null &&
    cell.type !== "blob" &&
    !truncatedText;

  const detail = selectedCell ? cellDetailText(selectedCell.cell) : "";
  const truncationNote = truncatedText
    ? `Showing the first ${cell.value.length.toLocaleString()} of ${cell.fullLength?.toLocaleString()} characters${onCommitCell ? "; values this large cannot be edited here" : ""}.`
    : cell?.type === "blob"
      ? `Hex preview of the first bytes; the value is ${formatBytes(cell.length)}${onCommitCell ? ". Blobs cannot be edited here" : ""}.`
      : null;

  function save() {
    if (!selectedCell || !onCommitCell || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    onCommitCell(
      selectedCell.rowIndex,
      selectedCell.columnIndex,
      draftIsNull ? null : draft,
    )
      .then(onClose)
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setSaving(false));
  }

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={selectedCell !== null}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={appDialogBackdropClassName} />
        <Dialog.Popup
          className={cx(
            appDialogPopupClassName,
            "grid max-h-[min(560px,calc(100vh_-_48px))] w-[min(640px,calc(100vw_-_32px))] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-4",
          )}
        >
          <header className="grid gap-1">
            <Dialog.Title className="m-0 font-mono text-[13px] font-bold leading-tight text-cg-fg">
              {selectedCell?.column}
            </Dialog.Title>
            <Dialog.Description className="m-0 text-[11.5px] leading-relaxed text-cg-muted">
              Row {selectedCell ? selectedCell.rowIndex + 1 : 0} ·{" "}
              {selectedCell?.cell.type.toUpperCase()}
              {truncationNote ? ` — ${truncationNote}` : ""}
            </Dialog.Description>
          </header>

          {editable ? (
            <textarea
              aria-label="Cell value"
              className="m-0 min-h-[140px] resize-none overflow-auto rounded-[7px] border border-cg-border bg-cg-editor px-3 py-2.5 font-mono text-[12px] leading-[1.5] text-cg-fg outline-0 placeholder:italic placeholder:text-cg-muted focus-visible:border-cg-focus"
              disabled={saving}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setDraftIsNull(false);
              }}
              placeholder={draftIsNull ? "NULL" : undefined}
              value={draftIsNull ? "" : draft}
            />
          ) : (
            <pre className="m-0 min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-cg-border bg-cg-editor px-3 py-2.5 font-mono text-[12px] leading-[1.5] text-cg-fg">
              {selectedCell?.cell.type === "null" ? "NULL" : detail}
            </pre>
          )}

          <footer className="flex min-w-0 items-center gap-2">
            {saveError ? (
              <span className="min-w-0 truncate text-[11.5px] text-cg-danger">
                {saveError}
              </span>
            ) : null}
            <span className="ml-auto inline-flex items-center gap-2">
              {editable ? (
                <Button
                  disabled={draftIsNull || saving}
                  onClick={() => {
                    setDraftIsNull(true);
                    setSaveError(null);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Set NULL
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(detail);
                }}
                size="sm"
                variant="subtle"
              >
                Copy Value
              </Button>
              {editable ? (
                <Button disabled={saving} onClick={save} size="sm">
                  {saving ? "Saving…" : "Save"}
                </Button>
              ) : (
                <Dialog.Close
                  render={
                    <Button size="sm" variant="default">
                      Done
                    </Button>
                  }
                />
              )}
            </span>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
