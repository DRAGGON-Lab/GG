import { NODE_SPECS, type NodeKind } from "@/features/circuit/core/loica-model";
import {
  FolderOpen,
  IconButton,
  Plus,
  Save,
  SidebarHeader,
  sidebarHeaderIconButtonClassName,
  sidebarRowClassName,
  SidebarSectionLabel,
} from "@/ui";

const SPECIES_KINDS: NodeKind[] = ["regulator", "reporter", "supplement"];
const OPERATOR_KINDS: NodeKind[] = [
  "source",
  "receiver",
  "hill1",
  "hill2",
  "sum",
];

/// The circuit sidebar: an explorer-style header owning the circuit file actions
/// (New / Open / Save), over the node palette. Clicking a row adds a node; a row
/// can also be dragged onto the canvas.
export function NodePalette({
  circuitName,
  dirty,
  onAdd,
  onNew,
  onOpen,
  onSave,
}: {
  circuitName: string;
  dirty: boolean;
  onAdd: (kind: NodeKind) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
}) {
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      <SidebarHeader
        actions={
          <>
            <IconButton
              className={sidebarHeaderIconButtonClassName}
              label="New circuit"
              onClick={onNew}
              title="New circuit"
              variant="ghost"
            >
              <Plus aria-hidden="true" size={15} strokeWidth={1.9} />
            </IconButton>
            <IconButton
              className={sidebarHeaderIconButtonClassName}
              label="Open circuit"
              onClick={onOpen}
              title="Open circuit…"
              variant="ghost"
            >
              <FolderOpen aria-hidden="true" size={14} strokeWidth={1.8} />
            </IconButton>
            <IconButton
              className={sidebarHeaderIconButtonClassName}
              label="Save circuit"
              onClick={onSave}
              title="Save (⌘S)"
              variant="ghost"
            >
              <Save aria-hidden="true" size={14} strokeWidth={1.8} />
            </IconButton>
          </>
        }
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{circuitName}</span>
            {dirty ? (
              <span
                aria-label="Unsaved changes"
                className="size-1.5 shrink-0 rounded-full bg-cg-accent"
                title="Unsaved changes"
              />
            ) : null}
          </span>
        }
      />

      <div className="min-h-0 min-w-0 overflow-auto p-2">
        <PaletteGroup kinds={SPECIES_KINDS} onAdd={onAdd} title="Species" />
        <PaletteGroup kinds={OPERATOR_KINDS} onAdd={onAdd} title="Operators" />
      </div>
    </div>
  );
}

function PaletteGroup({
  kinds,
  onAdd,
  title,
}: {
  kinds: NodeKind[];
  onAdd: (kind: NodeKind) => void;
  title: string;
}) {
  return (
    <div>
      <SidebarSectionLabel>{title}</SidebarSectionLabel>
      <div className="grid min-w-0 gap-[1px]">
        {kinds.map((kind) => {
          const spec = NODE_SPECS[kind];
          return (
            <button
              className={`${sidebarRowClassName} grid-cols-[max-content_minmax(0,1fr)]`}
              draggable
              key={kind}
              onClick={() => onAdd(kind)}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/gg-circuit-node", kind);
                event.dataTransfer.effectAllowed = "move";
              }}
              title={spec.description}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: spec.accent }}
              />
              <span className="min-w-0 truncate text-[12px] font-medium leading-none">
                {spec.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
