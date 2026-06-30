/// Pure formatting helpers shared across the Data views. Kept separate from
/// the component module so fast-refresh treats that file as components-only.

const integerFormatter = new Intl.NumberFormat("en-US");

export const monoClass = "font-mono text-[12px]";

export function formatInt(value: number) {
  return integerFormatter.format(value);
}

export function formatDuration(durationMs: number) {
  if (durationMs < 1) {
    return "<1 ms";
  }
  if (durationMs < 1000) {
    return `${durationMs >= 100 ? Math.round(durationMs) : durationMs.toFixed(1)} ms`;
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
}

/// Last path/fragment segment of an IRI, for compact display.
export function shortIri(iri: string): string {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0 && hash < iri.length - 1) {
    return iri.slice(hash + 1);
  }
  const slash = iri.lastIndexOf("/");
  if (slash >= 0 && slash < iri.length - 1) {
    return iri.slice(slash + 1);
  }
  return iri;
}
