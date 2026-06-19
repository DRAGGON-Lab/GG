import { useState } from "react";

import {
  AI_MEMORY_KIND_LABELS,
  type AiMemoryConclusion,
  deleteAiMemory,
  listAiMemory,
  setAiMemoryStatus,
  updateAiMemory,
} from "@/features/settings/memory-service";
import { useAsyncResource } from "@/lib/use-async-resource";
import { AlertCircle, Button, Eye, EyeOff, Trash2 } from "@/ui";

const settingsSectionClassName =
  "grid max-w-[760px] gap-3.5 [@container(max-width:520px)]:gap-3";

const rowInputClassName =
  "h-7 w-full min-w-0 rounded-[6px] border border-transparent bg-transparent px-1.5 font-[inherit] text-[12.5px] leading-none text-cg-fg outline-0 hover:border-cg-border focus-visible:border-cg-focus focus-visible:bg-cg-editor focus-visible:outline-0";

const rowButtonClassName =
  "size-7 rounded-[6px] border-transparent bg-transparent p-0 text-cg-muted hover:border-transparent hover:bg-cg-surface-hover hover:text-cg-fg";

export function AiMemorySettingsSection() {
  const [revision, setRevision] = useState(0);
  const memoryResource = useAsyncResource(`ai-memory:${revision}`, () =>
    listAiMemory(),
  );
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conclusions = memoryResource.data ?? [];
  const activeCount = conclusions.filter(
    (conclusion) => conclusion.status === "active",
  ).length;
  const status = memoryResource.loading
    ? "Loading"
    : error || memoryResource.error
      ? "Memory Error"
      : activeCount > 0
        ? `${activeCount} active`
        : "None";

  function refresh() {
    setRevision((revision) => revision + 1);
  }

  async function handleCommitContent(
    conclusion: AiMemoryConclusion,
    content: string,
  ) {
    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed === conclusion.content) {
      return;
    }
    setError(null);
    try {
      await updateAiMemory(conclusion.id, { content: trimmed });
      refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function handleToggleStatus(conclusion: AiMemoryConclusion) {
    setError(null);
    setConfirmingDelete(null);
    try {
      await setAiMemoryStatus(
        conclusion.id,
        conclusion.status === "active" ? "invalidated" : "active",
      );
      refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function handleDelete(id: string) {
    if (confirmingDelete !== id) {
      setConfirmingDelete(id);
      return;
    }
    setError(null);
    setConfirmingDelete(null);
    try {
      await deleteAiMemory(id);
      refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <section
      className={`${settingsSectionClassName} mb-6`}
      aria-labelledby="ai-memory"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5 [@container(max-width:520px)]:items-start [@container(max-width:520px)]:gap-2 [@container(max-width:520px)]:self-start [@container(max-width:520px)]:flex-col">
        <h2
          className="m-0 text-[14px] font-bold leading-none text-cg-fg"
          id="ai-memory"
        >
          AI Memory
        </h2>
        <span
          className="flex-none text-[11px] font-semibold leading-none text-cg-muted [&[data-error]]:text-cg-danger"
          data-error={error || memoryResource.error ? "" : undefined}
        >
          {status}
        </span>
      </header>

      <p className="m-0 text-[11.5px] leading-relaxed text-cg-muted">
        The AI accumulates durable conclusions about you from conversations
        (e.g., your background, goals, preferences, projects, struggles, and
        conventions) and reads them at the start of each session. Edit or remove
        anything here; hidden conclusions stay out of the AI's context.
      </p>

      {conclusions.length === 0 ? (
        <div className="grid min-w-0 gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2">
          <div className="text-[12.5px] font-bold leading-tight text-cg-fg">
            Nothing remembered yet
          </div>
          <div className="text-[11.5px] font-medium leading-snug text-cg-muted">
            Conclusions appear here as you work with the AI.
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {AI_MEMORY_KIND_LABELS.map(({ kind, label }) => {
            const items = conclusions.filter(
              (conclusion) => conclusion.kind === kind,
            );
            if (items.length === 0) {
              return null;
            }
            return (
              <div className="grid min-w-0 gap-1.5" key={kind}>
                <h3 className="m-0 text-[11px] font-bold uppercase leading-none tracking-wide text-cg-muted">
                  {label}
                </h3>
                <div className="grid min-w-0 overflow-hidden rounded-[7px] border border-cg-border bg-cg-surface">
                  {items.map((conclusion) => (
                    <MemoryRow
                      confirmingDelete={confirmingDelete === conclusion.id}
                      conclusion={conclusion}
                      key={conclusion.id}
                      onCommitContent={handleCommitContent}
                      onDelete={handleDelete}
                      onToggleStatus={handleToggleStatus}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error || memoryResource.error ? (
        <div className="flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-danger/35 bg-cg-danger/10 px-2.5 py-2 text-[11.5px] leading-snug text-cg-danger">
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 flex-none"
            size={14}
            strokeWidth={1.8}
          />
          <span className="min-w-0">{error ?? memoryResource.error}</span>
        </div>
      ) : null}
    </section>
  );
}

function MemoryRow({
  confirmingDelete,
  conclusion,
  onCommitContent,
  onDelete,
  onToggleStatus,
}: {
  confirmingDelete: boolean;
  conclusion: AiMemoryConclusion;
  onCommitContent: (conclusion: AiMemoryConclusion, content: string) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (conclusion: AiMemoryConclusion) => void;
}) {
  const [draft, setDraft] = useState(conclusion.content);
  const hidden = conclusion.status === "invalidated";

  const [prevContent, setPrevContent] = useState(conclusion.content);
  if (prevContent !== conclusion.content) {
    setPrevContent(conclusion.content);
    setDraft(conclusion.content);
  }

  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_max-content] items-center gap-2 border-b border-cg-border px-1.5 py-1 last:border-b-0 ${
        hidden ? "opacity-60" : ""
      }`}
    >
      <input
        aria-label={`Edit memory: ${conclusion.content}`}
        autoComplete="off"
        className={`${rowInputClassName} ${hidden ? "line-through" : ""}`}
        onBlur={() => onCommitContent(conclusion, draft)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(conclusion.content);
          }
        }}
        spellCheck={false}
        type="text"
        value={draft}
      />
      <div className="flex items-center gap-1">
        <Button
          aria-label={hidden ? "Restore this memory" : "Hide this memory"}
          className={rowButtonClassName}
          onClick={() => onToggleStatus(conclusion)}
          size="none"
          title={
            hidden
              ? "Restore so it is included in the AI's context again"
              : "Hide so it is kept but excluded from the AI's context"
          }
          variant="bare"
        >
          {hidden ? (
            <EyeOff aria-hidden="true" size={13} strokeWidth={1.8} />
          ) : (
            <Eye aria-hidden="true" size={13} strokeWidth={1.8} />
          )}
        </Button>
        <Button
          aria-label={
            confirmingDelete
              ? "Confirm deleting this memory"
              : "Delete this memory"
          }
          className={
            confirmingDelete
              ? "h-7 rounded-[6px] px-2 text-[11.5px] text-cg-danger"
              : rowButtonClassName
          }
          onClick={() => onDelete(conclusion.id)}
          size="none"
          title={confirmingDelete ? "Click again to delete" : "Delete"}
          variant={confirmingDelete ? "ghost" : "bare"}
        >
          <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
          {confirmingDelete ? "Confirm" : null}
        </Button>
      </div>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
