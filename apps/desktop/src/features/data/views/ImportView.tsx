import { useRef, useState } from "react";

import { ErrorState, SectionHeader } from "@/features/data/components/shared";
import { importDocument } from "@/features/data/core/data-service";
import type { ImportReport } from "@/features/data/core/data-types";
import { formatInt } from "@/features/data/core/format";
import { Button, CheckCircle2, FolderOpen, LoaderCircle } from "@/ui";
import { cx } from "@/ui/class-name";

const FORMAT_OPTIONS = [
  "turtle",
  "jsonld",
  "rdfxml",
  "ntriples",
  "trig",
  "nquads",
  "json",
  "genbank",
  "fasta",
] as const;

type Format = (typeof FORMAT_OPTIONS)[number];

function formatFromExtension(filename: string): Format | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "json":
      return "json";
    case "jsonld":
      return "jsonld";
    case "rdf":
    case "xml":
    case "rdfxml":
      return "rdfxml";
    case "ttl":
    case "turtle":
      return "turtle";
    case "trig":
      return "trig";
    case "nt":
    case "ntriples":
      return "ntriples";
    case "nq":
    case "nquads":
      return "nquads";
    case "gb":
    case "gbk":
    case "genbank":
      return "genbank";
    case "fa":
    case "fasta":
    case "fna":
    case "faa":
      return "fasta";
    default:
      return null;
  }
}

export function ImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<Format>("turtle");
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const acceptFile = async (file: File) => {
    setError(null);
    setReport(null);
    const inferred = formatFromExtension(file.name);
    if (inferred) {
      setFormat(inferred);
    }
    if (!name) {
      setName(file.name);
    }
    setBody(await file.text());
  };

  const run = async () => {
    setError(null);
    setReport(null);
    setRunning(true);
    try {
      const result = await importDocument({
        body,
        format,
        name: name.trim() || null,
      });
      setReport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-w-0">
      <SectionHeader
        subtitle="Load SBOL (RDF), GenBank, or FASTA documents into the store."
        title="Import"
      />

      <div
        className={cx(
          "mb-4 grid cursor-default place-items-center gap-2 rounded-[10px] border-2 border-dashed px-4 py-8 text-center transition-colors",
          dragging
            ? "border-cg-accent bg-cg-accent/5"
            : "border-cg-border bg-cg-surface",
        )}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) {
            void acceptFile(file);
          }
        }}
      >
        <FolderOpen aria-hidden="true" className="text-cg-muted" size={22} />
        <div className="text-[12.5px] text-cg-fg">
          Drop a file here, or click to choose
        </div>
        <div className="text-[11px] text-cg-muted">
          .ttl · .jsonld · .rdf · .nt · .gb · .fasta
        </div>
        <input
          accept=".ttl,.turtle,.jsonld,.json,.rdf,.xml,.nt,.ntriples,.trig,.nq,.nquads,.gb,.gbk,.genbank,.fa,.fasta,.fna,.faa"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void acceptFile(file);
            }
            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <label className="grid gap-1 text-[11px] text-cg-muted">
          Format
          <select
            className="rounded-[6px] border border-cg-border bg-cg-editor px-2.5 py-1.5 text-[12.5px] text-cg-fg outline-none focus:border-cg-focus"
            onChange={(event) => setFormat(event.target.value as Format)}
            value={format}
          >
            {FORMAT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] text-cg-muted">
          Name (optional)
          <input
            className="rounded-[6px] border border-cg-border bg-cg-editor px-2.5 py-1.5 text-[12.5px] text-cg-fg outline-none focus:border-cg-focus"
            onChange={(event) => setName(event.target.value)}
            placeholder="document name"
            value={name}
          />
        </label>
      </div>

      <textarea
        className="mt-3 min-h-[160px] w-full rounded-[7px] border border-cg-border bg-cg-editor p-3 font-mono text-[12px] text-cg-fg outline-none focus:border-cg-focus"
        onChange={(event) => setBody(event.target.value)}
        placeholder="…or paste document contents here"
        spellCheck={false}
        value={body}
      />

      <div className="mt-2 flex justify-end">
        <Button
          disabled={running || body.trim().length === 0}
          onClick={run}
          size="sm"
          variant="default"
        >
          {running ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin"
              size={14}
            />
          ) : (
            <FolderOpen aria-hidden="true" size={14} />
          )}
          Import
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      ) : null}

      {report ? (
        <div className="mt-3 flex items-start gap-2 rounded-[7px] border border-cg-success/40 bg-cg-success/5 px-3 py-2.5 text-[12.5px] text-cg-fg">
          <CheckCircle2
            aria-hidden="true"
            className="mt-px shrink-0 text-cg-success"
            size={15}
          />
          <div>
            <div className="font-medium">Imported successfully</div>
            <div className="mt-0.5 text-cg-muted">
              {formatInt(report.objectCount)} objects ·{" "}
              {formatInt(report.tripleCount)} triples · validation{" "}
              {report.validationStatus}
              {report.validationIssueCount > 0
                ? ` (${formatInt(report.validationIssueCount)} issues)`
                : ""}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
