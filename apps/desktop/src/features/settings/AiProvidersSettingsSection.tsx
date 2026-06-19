import { useState } from "react";

import {
  AI_PROVIDERS,
  type AiProviderKeyStatus,
  type AiProviderMeta,
  deleteProviderKey,
  listProviderKeyStatuses,
  providerErrorMessage,
  saveProviderKey,
  validateProviderKey,
} from "@/features/settings/ai-providers";
import { useAsyncResource } from "@/lib/use-async-resource";
import { AlertCircle, Button, CheckCircle2, LoaderCircle, Trash2 } from "@/ui";

const settingsSectionClassName =
  "grid max-w-[760px] gap-3.5 [@container(max-width:520px)]:gap-3";

const settingsInputClassName =
  "h-8 w-full min-w-0 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 font-[inherit] text-[13px] leading-none text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

type PendingAction = "save" | "validate" | "delete" | null;

export function AiProvidersSettingsSection() {
  const [revision, setRevision] = useState(0);
  const statusesResource = useAsyncResource(`ai-providers:${revision}`, () =>
    listProviderKeyStatuses(),
  );
  const statuses = statusesResource.data ?? [];
  const configuredCount = statuses.filter((status) => status.present).length;
  const sectionStatus = statusesResource.loading
    ? "Loading"
    : statusesResource.error
      ? "Provider Error"
      : configuredCount > 0
        ? `${configuredCount} configured`
        : "None configured";

  function refresh() {
    setRevision((revision) => revision + 1);
  }

  return (
    <section
      className={`${settingsSectionClassName} mb-6`}
      aria-labelledby="ai-providers"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5">
        <h2
          className="m-0 text-[14px] font-bold leading-none text-cg-fg"
          id="ai-providers"
        >
          AI Providers
        </h2>
        <span className="flex-none text-[11px] font-semibold leading-none text-cg-muted">
          {sectionStatus}
        </span>
      </header>

      <p className="m-0 text-[11.5px] leading-relaxed text-cg-muted">
        Keys are stored in your OS keychain and used to call each provider
        directly.
      </p>

      <div className="grid gap-1.5">
        {AI_PROVIDERS.map((meta) => (
          <ProviderRow
            key={meta.provider}
            meta={meta}
            onChanged={refresh}
            status={statuses.find(
              (status) => status.provider === meta.provider,
            )}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderRow({
  meta,
  onChanged,
  status,
}: {
  meta: AiProviderMeta;
  onChanged: () => void;
  status: AiProviderKeyStatus | undefined;
}) {
  // `null` means "not editing": when a key is stored we render masked dots
  // (the provider's typical key length); focusing the field begins an edit.
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  // Validation isn't persisted, so this reflects the result within this
  // session: "valid" after a successful check, "invalid" after a failed one.
  const [validation, setValidation] = useState<"unknown" | "valid" | "invalid">(
    "unknown",
  );
  const present = status?.present ?? false;
  const editing = keyDraft !== null;
  const hasSavableDraft = editing && keyDraft.trim().length > 0;
  const inputValue = editing
    ? keyDraft
    : present
      ? "•".repeat(meta.maskedKeyLength)
      : "";

  async function run(action: PendingAction, work: () => Promise<unknown>) {
    setPending(action);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (caught) {
      setError(providerErrorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  // Records the validation result without throwing, so a failed check reads as
  // "invalid" (a status), not as a failed operation.
  async function validate() {
    try {
      await validateProviderKey(meta.provider);
      setValidation("valid");
      setError(null);
    } catch (caught) {
      setValidation("invalid");
      setError(providerErrorMessage(caught));
    }
  }

  function handleSave() {
    const key = (keyDraft ?? "").trim();
    if (!key) {
      return;
    }
    setValidation("unknown");
    void run("save", async () => {
      await saveProviderKey(meta.provider, key);
      // Drop back to the masked-dots view, then validate the stored key.
      setKeyDraft(null);
      await validate();
    });
  }

  function handleValidate() {
    void run("validate", validate);
  }

  function handleDelete() {
    setValidation("unknown");
    setKeyDraft(null);
    void run("delete", () => deleteProviderKey(meta.provider));
  }

  return (
    <div className="grid min-w-0 gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[12.5px] font-bold leading-tight text-cg-fg">
          {meta.label}
        </span>
        {pending === "save" || pending === "validate" ? (
          <LoaderCircle
            aria-label="Validating"
            className="flex-none animate-spin text-cg-muted motion-reduce:animate-none"
            size={14}
            strokeWidth={1.9}
          />
        ) : present ? (
          <button
            aria-label={
              validation === "valid"
                ? `${meta.label} key verified`
                : `Verify ${meta.label} key`
            }
            className="flex flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 transition-opacity duration-150 ease-out hover:opacity-70 motion-reduce:transition-none"
            onClick={handleValidate}
            title={
              validation === "valid"
                ? "Verified"
                : validation === "invalid"
                  ? (error ?? "Verification failed — click to retry")
                  : "Saved — click to verify"
            }
            type="button"
          >
            {validation === "invalid" ? (
              <AlertCircle
                aria-hidden="true"
                className="text-cg-danger"
                size={15}
                strokeWidth={2}
              />
            ) : (
              <CheckCircle2
                aria-hidden="true"
                className={
                  validation === "valid" ? "text-cg-success" : "text-cg-muted"
                }
                size={15}
                strokeWidth={2}
              />
            )}
          </button>
        ) : (
          <span className="flex-none text-[10.5px] font-semibold leading-none text-cg-muted">
            Not set
          </span>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2">
        <input
          aria-label={`${meta.label} API key`}
          autoComplete="off"
          className={settingsInputClassName}
          onBlur={() => {
            // Abandon an empty edit so the masked dots return.
            if (keyDraft !== null && keyDraft.trim().length === 0) {
              setKeyDraft(null);
            }
          }}
          onChange={(event) => setKeyDraft(event.currentTarget.value)}
          onFocus={() => {
            if (keyDraft === null) {
              setKeyDraft("");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleSave();
            }
          }}
          placeholder={present && !editing ? "" : meta.keyPlaceholder}
          spellCheck={false}
          type="password"
          value={inputValue}
        />
        <div className="flex flex-none items-center gap-1.5">
          <Button
            className="h-8 rounded-[6px] px-2.5 text-[11.5px]"
            disabled={pending !== null || !hasSavableDraft}
            onClick={handleSave}
            size="none"
          >
            {pending === "save" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={13}
                strokeWidth={1.8}
              />
            ) : null}
            Save
          </Button>
          <Button
            aria-label={`Remove ${meta.label} key`}
            className="size-8 rounded-[6px] p-0"
            disabled={pending !== null || !present}
            onClick={handleDelete}
            size="none"
            title="Remove key"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="text-[11px] font-medium leading-snug text-cg-danger">
          {error}
        </div>
      ) : null}
    </div>
  );
}
