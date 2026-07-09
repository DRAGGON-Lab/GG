import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { SbolPartRef } from "@/features/circuit/core/loica-model";
import { loadObjects } from "@/features/data/core/data-service";
import type { SbolObject } from "@/features/data/core/data-types";
import { shortIri } from "@/features/data/core/format";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "@/ui";
import { cx } from "@/ui/class-name";

const SBOL_COMPONENT_CLASS = "https://sbols.org/v3#Component";
const PAGE_SIZE = 200;

type RoleHint =
  | "promoter"
  | "rbs"
  | "cds"
  | "stability"
  | "terminator"
  | "engineered region"
  | "other";

type NodeSbolPartsProps = {
  onChange: (parts: SbolPartRef[]) => void;
  parts: SbolPartRef[];
};

export function NodeSbolParts({ onChange, parts }: NodeSbolPartsProps) {
  const [objects, setObjects] = useState<SbolObject[]>([]);
  const [selectedIri, setSelectedIri] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void loadSbolObjects().then(
      (list) => {
        if (cancelled) return;
        setObjects(list);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load SBOL objects",
        );
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [revision]);

  const selectedIris = useMemo(
    () => new Set(parts.map((part) => part.iri)),
    [parts],
  );

  const availableObjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return objects.filter((object) => {
      if (selectedIris.has(object.iri)) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return objectSearchText(object).includes(needle);
    });
  }, [objects, query, selectedIris]);

  const selectedObject =
    availableObjects.find((object) => object.iri === selectedIri) ??
    availableObjects[0] ??
    null;

  const addSelected = () => {
    if (!selectedObject) {
      return;
    }
    onChange([...parts, toSbolPartRef(selectedObject)]);
    setSelectedIri("");
  };

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-[11px] text-cg-muted">
        <span>SBOL assembly</span>
        <button
          className="grid size-6 cursor-pointer place-items-center rounded-[6px] border border-cg-border bg-transparent text-cg-muted transition-colors hover:bg-cg-surface-hover hover:text-cg-fg disabled:cursor-default disabled:opacity-40"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
          title="Reload SBOL objects"
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={loading ? "animate-spin" : undefined}
            size={12}
          />
        </button>
      </div>

      <section className="grid gap-2 rounded-[6px] border border-cg-border bg-cg-surface px-2.5 py-2 text-[11px]">
        {parts.length > 0 ? (
          <ol className="grid gap-1">
            {parts.map((part, index) => (
              <li
                className="grid grid-cols-[18px_1fr_auto] items-center gap-1.5 rounded-[5px] border border-cg-border bg-cg-editor px-1.5 py-1"
                key={`${part.iri}:${index}`}
              >
                <span className="text-center font-mono text-[10px] text-cg-muted">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-cg-fg">
                    {part.displayId ?? part.name ?? shortIri(part.iri)}
                  </div>
                  <div className="flex min-w-0 gap-1.5">
                    <span className="shrink-0 font-mono text-[9.5px] text-cg-muted">
                      {part.roleHint ?? "other"}
                    </span>
                    <span
                      className="truncate font-mono text-[9.5px] text-cg-muted/70"
                      title={part.iri}
                    >
                      {shortIri(part.iri)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <IconControl
                    disabled={index === 0}
                    label="Move SBOL object up"
                    onClick={() => onChange(movePart(parts, index, index - 1))}
                  >
                    <ArrowUp aria-hidden="true" size={11} />
                  </IconControl>
                  <IconControl
                    disabled={index === parts.length - 1}
                    label="Move SBOL object down"
                    onClick={() => onChange(movePart(parts, index, index + 1))}
                  >
                    <ArrowDown aria-hidden="true" size={11} />
                  </IconControl>
                  <IconControl
                    label="Remove SBOL object"
                    onClick={() =>
                      onChange(parts.filter((_, current) => current !== index))
                    }
                  >
                    <Trash2 aria-hidden="true" size={11} />
                  </IconControl>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[10.5px] text-cg-muted">
            No SBOL objects connected.
          </p>
        )}

        <div className="grid gap-1">
          <input
            className="rounded-[6px] border border-cg-border bg-cg-editor px-2 py-1 text-[11.5px] text-cg-fg outline-none focus:border-cg-accent"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter SBOL objects"
            spellCheck={false}
            value={query}
          />
          <div className="flex gap-1">
            <select
              className="min-w-0 flex-1 rounded-[6px] border border-cg-border bg-cg-editor px-2 py-1 text-[11.5px] text-cg-fg outline-none focus:border-cg-accent"
              disabled={availableObjects.length === 0}
              onChange={(event) => setSelectedIri(event.target.value)}
              value={selectedObject?.iri ?? ""}
            >
              {availableObjects.length === 0 ? (
                <option value="">
                  {loading ? "Loading SBOL objects..." : "No matching objects"}
                </option>
              ) : (
                availableObjects.map((object) => (
                  <option key={object.iri} value={object.iri}>
                    {objectLabel(object)}
                  </option>
                ))
              )}
            </select>
            <button
              className="flex items-center gap-1 rounded-[6px] border border-cg-border bg-transparent px-2 text-[11.5px] font-medium text-cg-muted transition-colors hover:border-cg-accent/50 hover:bg-cg-accent/10 hover:text-cg-accent disabled:opacity-40"
              disabled={!selectedObject}
              onClick={addSelected}
              type="button"
            >
              <Plus aria-hidden="true" size={12} strokeWidth={1.8} />
              Add
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-[5px] border border-cg-danger/30 bg-cg-danger/10 px-2 py-1 text-[10.5px] text-cg-danger">
            {error}
          </div>
        ) : null}
      </section>
    </div>
  );
}

async function loadSbolObjects(): Promise<SbolObject[]> {
  const componentList = await loadObjects({
    limit: PAGE_SIZE,
    sbolClass: SBOL_COMPONENT_CLASS,
  });
  if (componentList.objects.length > 0) {
    return componentList.objects;
  }
  const fallbackList = await loadObjects({ limit: PAGE_SIZE });
  return fallbackList.objects;
}

function IconControl({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cx(
        "grid size-5 place-items-center rounded-[4px] text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg",
        disabled ? "cursor-default opacity-35" : "cursor-pointer",
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function movePart(
  parts: SbolPartRef[],
  fromIndex: number,
  toIndex: number,
): SbolPartRef[] {
  const next = [...parts];
  const [part] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, part);
  return next;
}

function toSbolPartRef(object: SbolObject): SbolPartRef {
  return {
    displayId: object.displayId,
    graphId: object.graphId,
    iri: object.iri,
    name: object.name,
    roleHint: inferRole(object),
    roles: object.roles,
    sbolClass: object.sbolClass,
  };
}

function objectLabel(object: SbolObject): string {
  const role = inferRole(object);
  const label = object.displayId ?? object.name ?? shortIri(object.iri);
  return role === "other" ? label : `${label} (${role})`;
}

function objectSearchText(object: SbolObject): string {
  return [
    object.displayId,
    object.name,
    object.iri,
    object.sbolClass,
    inferRole(object),
    ...object.roles,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function inferRole(object: SbolObject): RoleHint {
  const text = [
    object.displayId,
    object.name,
    object.iri,
    object.sbolClass,
    ...object.roles,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (text.includes("promoter") || text.includes("so:0000167")) {
    return "promoter";
  }
  if (
    text.includes("ribosome") ||
    text.includes("rbs") ||
    text.includes("so:0000139")
  ) {
    return "rbs";
  }
  if (
    text.includes("cds") ||
    text.includes("coding") ||
    text.includes("so:0000316")
  ) {
    return "cds";
  }
  if (text.includes("stability") || text.includes("degradation")) {
    return "stability";
  }
  if (text.includes("terminator") || text.includes("so:0000141")) {
    return "terminator";
  }
  if (text.includes("engineered") || text.includes("so:0000804")) {
    return "engineered region";
  }
  return "other";
}
