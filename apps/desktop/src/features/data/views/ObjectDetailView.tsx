import { useState } from "react";

import {
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/features/data/components/shared";
import { exportObject, loadObject } from "@/features/data/core/data-service";
import type { ExportFormat } from "@/features/data/core/data-types";
import { monoClass, shortIri } from "@/features/data/core/format";
import { useAsyncResource } from "@/lib/use-async-resource";
import { ArrowUp, Button, Copy } from "@/ui";
import { cx } from "@/ui/class-name";

const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "turtle", label: "Turtle" },
  { id: "jsonld", label: "JSON-LD" },
  { id: "ntriples", label: "N-Triples" },
  { id: "rdfxml", label: "RDF/XML" },
];

export function ObjectDetailView({
  iri,
  onBack,
}: {
  iri: string;
  onBack: () => void;
}) {
  const resource = useAsyncResource(`object:${iri}`, () => loadObject(iri));
  const [exported, setExported] = useState<{
    body: string;
    format: ExportFormat;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const object = resource.data;

  const runExport = async (format: ExportFormat) => {
    setExportError(null);
    try {
      const body = await exportObject(iri, format);
      setExported({ body, format });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="min-w-0">
      <SectionHeader
        actions={
          <Button onClick={onBack} size="sm" variant="ghost">
            <ArrowUp aria-hidden="true" size={14} />
            Back to objects
          </Button>
        }
        subtitle={iri}
        title={object?.displayId ?? object?.name ?? shortIri(iri)}
      />

      {resource.error ? <ErrorState message={resource.error} /> : null}
      {!object && resource.loading ? <LoadingState /> : null}

      {object ? (
        <div className="grid gap-5">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[140px_minmax(0,1fr)]">
            <Field label="IRI" value={object.iri} mono />
            <Field label="SBOL class" value={object.sbolClass} mono />
            <Field label="Display ID" value={object.displayId ?? "—"} />
            <Field label="Name" value={object.name ?? "—"} />
            <Field label="Description" value={object.description ?? "—"} />
            <Field
              label="Graph"
              value={object.graphId ?? "—"}
              mono={Boolean(object.graphId)}
            />
            <Field
              label="Roles"
              value={object.roles.length ? object.roles.join("\n") : "—"}
              mono
            />
            <Field
              label="Types"
              value={object.types.length ? object.types.join("\n") : "—"}
              mono
            />
          </dl>

          <div>
            <h3 className="m-0 mb-2 text-[13px] font-semibold text-cg-fg">
              Export RDF
            </h3>
            <div className="flex flex-wrap gap-2">
              {EXPORT_FORMATS.map((format) => (
                <Button
                  key={format.id}
                  onClick={() => runExport(format.id)}
                  size="sm"
                  variant="subtle"
                >
                  {format.label}
                </Button>
              ))}
            </div>
            {exportError ? (
              <div className="mt-2">
                <ErrorState message={exportError} />
              </div>
            ) : null}
            {exported ? (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-[11px] text-cg-muted">
                  <span>{exported.format}</span>
                  <Button
                    onClick={() =>
                      navigator.clipboard?.writeText(exported.body)
                    }
                    size="sm"
                    variant="ghost"
                  >
                    <Copy aria-hidden="true" size={13} />
                    Copy
                  </Button>
                </div>
                <pre className="max-h-80 overflow-auto rounded-[7px] border border-cg-border bg-cg-editor p-3 font-mono text-[11.5px] leading-relaxed text-cg-fg">
                  {exported.body}
                </pre>
              </div>
            ) : null}
          </div>

          <div>
            <h3 className="m-0 mb-2 text-[13px] font-semibold text-cg-fg">
              Properties
            </h3>
            <pre className="max-h-96 overflow-auto rounded-[7px] border border-cg-border bg-cg-editor p-3 font-mono text-[11.5px] leading-relaxed text-cg-fg">
              {JSON.stringify(object.data, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <>
      <dt className="text-[11.5px] uppercase tracking-[0.03em] text-cg-muted">
        {label}
      </dt>
      <dd
        className={cx(
          "m-0 min-w-0 whitespace-pre-wrap break-words text-[12.5px] text-cg-fg",
          mono && monoClass,
        )}
      >
        {value}
      </dd>
    </>
  );
}
