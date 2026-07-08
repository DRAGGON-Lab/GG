import { useState } from "react";

import {
  Button,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  IconButton,
  PanelLeftClose,
  Plus,
  Save,
  SidebarHeader,
  sidebarHeaderIconButtonClassName,
} from "@/ui";

export type FileNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
};

type EditorExplorerProps = {
  activePath: string | null;
  /// Bare folder name of the open workspace, or null when none is open.
  workspaceName: string | null;
  nodes: FileNode[];
  loading: boolean;
  /// Bare name of the document the editor is focused on, or null.
  activeDocumentName: string | null;
  runtimeLabel: string;
  runtimeAvailable: boolean;
  onCollapse: () => void;
  onNewFile: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  /// Single-click: open as a preview tab.
  onOpenFile: (node: FileNode) => void;
  /// Double-click: open as a persistent tab.
  onConfirmOpenFile: (node: FileNode) => void;
};

// The file explorer rows: 28px rows, chevron/folder/file icons, a clear active
// highlight — substantial, not a dim text list.
const treeFolderButtonClassName =
  "grid h-[28px] w-full cursor-default grid-cols-[max-content_max-content_minmax(0,1fr)] items-center gap-[5px] rounded-[5px] border border-transparent bg-transparent px-1.5 text-left font-[inherit] text-cg-sidebar-fg hover:bg-cg-sidebar-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

const treeFileButtonClassName =
  "grid h-[28px] w-full cursor-default grid-cols-[13px_max-content_minmax(0,1fr)] items-center gap-[5px] rounded-[5px] border border-transparent bg-transparent px-1.5 text-left font-[inherit] text-cg-sidebar-fg hover:bg-cg-sidebar-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus data-active:border-cg-border data-active:bg-cg-sidebar-hover data-active:text-cg-fg";

// Header/footer affordances reuse the shared Button primitive so they match the
// rest of the app (theme-aware ghost hover + brand press motion) instead of a
// flat grey rectangle. These tune only sizing on top of the variants.
const saveButtonClassName = sidebarHeaderIconButtonClassName;

/// The explorer sidebar owns the workspace + file actions (header) and a
/// status/save footer, wrapping a recursive Python file tree. Single-click
/// previews a file; double-click opens it persistently.
export function EditorExplorer({
  activePath,
  workspaceName,
  nodes,
  loading,
  activeDocumentName,
  runtimeLabel,
  runtimeAvailable,
  onCollapse,
  onNewFile,
  onOpenFolder,
  onSave,
  onOpenFile,
  onConfirmOpenFile,
}: EditorExplorerProps) {
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <SidebarHeader
        actions={
          <>
            <IconButton
              className={sidebarHeaderIconButtonClassName}
              label="New file"
              onClick={onNewFile}
              title="New file"
              variant="ghost"
            >
              <Plus aria-hidden="true" size={15} strokeWidth={1.9} />
            </IconButton>
            <IconButton
              className={sidebarHeaderIconButtonClassName}
              label="Open folder"
              onClick={onOpenFolder}
              title="Open folder…"
              variant="ghost"
            >
              <FolderOpen aria-hidden="true" size={14} strokeWidth={1.8} />
            </IconButton>
            <IconButton
              className={`${sidebarHeaderIconButtonClassName} ml-0.5`}
              label="Hide explorer"
              onClick={onCollapse}
              title="Hide explorer"
              variant="ghost"
            >
              <PanelLeftClose aria-hidden="true" size={14} strokeWidth={1.8} />
            </IconButton>
          </>
        }
        title={workspaceName ?? "Explorer"}
      />

      <div className="min-h-0 min-w-0 overflow-auto p-2">
        {workspaceName === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-3.5 px-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-cg-md border border-cg-border bg-cg-surface text-cg-muted">
              <FolderOpen aria-hidden="true" size={20} strokeWidth={1.6} />
            </span>
            <div className="grid gap-1">
              <p className="text-[12px] font-medium text-cg-fg">
                No folder open
              </p>
              <p className="text-balance text-[11px] leading-relaxed text-cg-muted">
                Open a folder to browse and edit its Python files.
              </p>
            </div>
            <Button
              className="gap-1.5 rounded-cg-md text-[11.5px] font-medium"
              onClick={onOpenFolder}
              size="sm"
              variant="subtle"
            >
              <Folder aria-hidden="true" size={13} strokeWidth={1.9} />
              Open a folder
            </Button>
          </div>
        ) : loading ? (
          <div className="px-1.5 py-1 text-[11px] text-cg-muted">Loading…</div>
        ) : nodes.length ? (
          <div className="grid min-w-0 gap-[1px]">
            {nodes.map((node) => (
              <TreeNode
                activePath={activePath}
                depth={0}
                key={node.path}
                node={node}
                onConfirmOpenFile={onConfirmOpenFile}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : (
          <div className="px-1.5 py-1 text-[11px] text-cg-muted">
            No Python files found.
          </div>
        )}
      </div>

      <footer className="flex min-w-0 items-center gap-1.5 border-t border-cg-border px-2.5 py-2">
        <span
          aria-hidden="true"
          className={`size-[6px] shrink-0 rounded-full ${
            runtimeAvailable ? "bg-cg-success" : "bg-cg-warning"
          }`}
        />
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-medium leading-none text-cg-muted"
          title={
            activeDocumentName
              ? `${activeDocumentName} · ${runtimeLabel}`
              : runtimeLabel
          }
        >
          {activeDocumentName ? `${activeDocumentName} · ` : ""}
          {runtimeLabel}
        </span>
        <IconButton
          className={saveButtonClassName}
          disabled={activeDocumentName === null}
          label="Save file"
          onClick={onSave}
          title="Save (⌘S)"
          variant="ghost"
        >
          <Save aria-hidden="true" size={14} strokeWidth={1.8} />
        </IconButton>
      </footer>
    </div>
  );
}

function TreeNode({
  activePath,
  depth,
  node,
  onConfirmOpenFile,
  onOpenFile,
}: {
  activePath: string | null;
  depth: number;
  node: FileNode;
  onConfirmOpenFile: (node: FileNode) => void;
  onOpenFile: (node: FileNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const indent = { paddingLeft: `${6 + depth * 13}px` };

  if (node.isDirectory) {
    const ChevronIcon = expanded ? ChevronDown : ChevronRight;
    const FolderIcon = expanded ? FolderOpen : Folder;

    return (
      <div className="grid min-w-0 gap-[1px]">
        <button
          className={treeFolderButtonClassName}
          onClick={() => setExpanded((value) => !value)}
          style={indent}
          title={node.path}
          type="button"
        >
          <ChevronIcon
            aria-hidden="true"
            className="text-cg-muted"
            size={14}
            strokeWidth={1.9}
          />
          <FolderIcon
            aria-hidden="true"
            className="text-cg-muted"
            size={14}
            strokeWidth={1.8}
          />
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold leading-none">
            {node.name}
          </span>
        </button>
        {expanded
          ? node.children?.map((child) => (
              <TreeNode
                activePath={activePath}
                depth={depth + 1}
                key={child.path}
                node={child}
                onConfirmOpenFile={onConfirmOpenFile}
                onOpenFile={onOpenFile}
              />
            ))
          : null}
      </div>
    );
  }

  const isActive = activePath === node.path;

  return (
    <button
      className={treeFileButtonClassName}
      data-active={isActive ? "" : undefined}
      onClick={() => onOpenFile(node)}
      onDoubleClick={() => onConfirmOpenFile(node)}
      style={indent}
      title={node.path}
      type="button"
    >
      <span className="w-[13px]" />
      <FileText
        aria-hidden="true"
        className="text-cg-muted"
        size={14}
        strokeWidth={1.8}
      />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium leading-none">
        {node.name}
      </span>
    </button>
  );
}
