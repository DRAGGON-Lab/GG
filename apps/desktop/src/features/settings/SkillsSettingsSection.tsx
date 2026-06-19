import { useState } from "react";

import {
  deleteSkill,
  listSkills,
  readSkill,
  type SkillMeta,
  writeSkill,
} from "@/features/settings/skills-service";
import { useAsyncResource } from "@/lib/use-async-resource";
import {
  AlertCircle,
  Button,
  LoaderCircle,
  Plus,
  Trash2,
  WandSparkles,
} from "@/ui";

const settingsSectionClassName =
  "grid max-w-[760px] gap-3.5 [@container(max-width:520px)]:gap-3";

const settingsFieldClassName =
  "grid gap-[7px] [&>span]:text-[11px] [&>span]:font-bold [&>span]:leading-none [&>span]:text-cg-muted";

const settingsInputClassName =
  "h-8 w-full min-w-0 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 font-[inherit] text-[13px] leading-none text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

const bodyTextareaClassName =
  "min-h-[180px] w-full min-w-0 resize-y rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

const compactButtonClassName = "h-7 rounded-[6px] px-2 text-[11.5px]";

type SkillDraft = {
  slug: string | null;
  name: string;
  description: string;
  body: string;
};

type SkillsAction = "save" | `open:${string}` | `delete:${string}` | null;

export function SkillsSettingsSection() {
  const [revision, setRevision] = useState(0);
  const skillsResource = useAsyncResource(`skills:${revision}`, () =>
    listSkills(),
  );
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [action, setAction] = useState<SkillsAction>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skills = skillsResource.data ?? [];
  const busy = action !== null;
  const status = skillsResource.loading
    ? "Loading"
    : action === "save"
      ? "Saving"
      : error || skillsResource.error
        ? "Skill Error"
        : skills.length > 0
          ? `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`
          : "None";

  function refresh() {
    setRevision((revision) => revision + 1);
  }

  function handleAdd() {
    setError(null);
    setConfirmingDelete(null);
    setDraft({ slug: null, name: "", description: "", body: "" });
  }

  async function handleOpen(skill: SkillMeta) {
    setAction(`open:${skill.slug}`);
    setError(null);
    setConfirmingDelete(null);
    try {
      const full = await readSkill(skill.slug);
      setDraft({
        slug: full.slug,
        name: full.name,
        description: full.description,
        body: full.body,
      });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function handleSave() {
    if (!draft) {
      return;
    }
    setAction("save");
    setError(null);
    try {
      await writeSkill(draft);
      setDraft(null);
      refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function handleDelete(slug: string) {
    if (confirmingDelete !== slug) {
      setConfirmingDelete(slug);
      return;
    }
    setAction(`delete:${slug}`);
    setError(null);
    setConfirmingDelete(null);
    try {
      await deleteSkill(slug);
      if (draft?.slug === slug) {
        setDraft(null);
      }
      refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAction(null);
    }
  }

  return (
    <section
      className={`${settingsSectionClassName} mb-6`}
      aria-labelledby="skills"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5 [@container(max-width:520px)]:items-start [@container(max-width:520px)]:gap-2 [@container(max-width:520px)]:self-start [@container(max-width:520px)]:flex-col">
        <h2
          className="m-0 text-[14px] font-bold leading-none text-cg-fg"
          id="skills"
        >
          Skills
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex-none text-[11px] font-semibold leading-none text-cg-muted [&[data-error]]:text-cg-danger"
            data-error={error || skillsResource.error ? "" : undefined}
          >
            {status}
          </span>
          <Button
            aria-label="Add skill"
            className="size-7 rounded-[6px] p-0"
            disabled={busy || draft !== null}
            onClick={handleAdd}
            size="none"
            title="Add skill"
            variant="ghost"
          >
            <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
          </Button>
        </div>
      </header>

      <div className="grid gap-1.5">
        {skills.length === 0 && !draft ? (
          <div className="grid min-w-0 gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2">
            <div className="text-[12.5px] font-bold leading-tight text-cg-fg">
              No skills yet
            </div>
            <div className="text-[11.5px] font-medium leading-snug text-cg-muted">
              Skills are named instruction sets the AI loads when they match the
              task, for example a house style for genetic circuits or
              conventions for simulation code.
            </div>
          </div>
        ) : (
          skills.map((skill) => (
            <SkillRow
              busy={busy}
              confirmingDelete={confirmingDelete === skill.slug}
              key={skill.slug}
              onDelete={handleDelete}
              onOpen={handleOpen}
              opening={action === `open:${skill.slug}`}
              skill={skill}
            />
          ))
        )}
      </div>

      {draft ? (
        <div className="grid min-w-0 gap-3 rounded-[7px] border border-cg-border bg-cg-surface p-3">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3 [@container(max-width:520px)]:gap-2.5">
            <label className={settingsFieldClassName}>
              <span>Name</span>
              <input
                aria-label="Skill name"
                autoComplete="off"
                className={settingsInputClassName}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.currentTarget.value })
                }
                placeholder="Genetic circuit style"
                spellCheck={false}
                type="text"
                value={draft.name}
              />
            </label>
            <label className={settingsFieldClassName}>
              <span>Description</span>
              <input
                aria-label="Skill description"
                autoComplete="off"
                className={settingsInputClassName}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.currentTarget.value })
                }
                placeholder="When to use this skill"
                type="text"
                value={draft.description}
              />
            </label>
          </div>
          <label className={settingsFieldClassName}>
            <span>Instructions</span>
            <textarea
              aria-label="Skill instructions"
              className={bodyTextareaClassName}
              onChange={(event) =>
                setDraft({ ...draft, body: event.currentTarget.value })
              }
              placeholder="Markdown instructions the AI follows when it loads this skill."
              spellCheck={false}
              value={draft.body}
            />
          </label>
          <div className="flex min-w-0 justify-end gap-2">
            <Button
              className={compactButtonClassName}
              disabled={busy}
              onClick={() => {
                setError(null);
                setDraft(null);
              }}
              size="none"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              className={compactButtonClassName}
              disabled={busy || draft.name.trim().length === 0}
              onClick={handleSave}
              size="none"
              variant="default"
            >
              {action === "save" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                  size={13}
                  strokeWidth={1.8}
                />
              ) : null}
              Save Skill
            </Button>
          </div>
        </div>
      ) : null}

      {error || skillsResource.error ? (
        <div className="flex min-w-0 items-start gap-2 rounded-[7px] border border-cg-danger/35 bg-cg-danger/10 px-2.5 py-2 text-[11.5px] leading-snug text-cg-danger">
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 flex-none"
            size={14}
            strokeWidth={1.8}
          />
          <span className="min-w-0">{error ?? skillsResource.error}</span>
        </div>
      ) : null}
    </section>
  );
}

function SkillRow({
  busy,
  confirmingDelete,
  onDelete,
  onOpen,
  opening,
  skill,
}: {
  busy: boolean;
  confirmingDelete: boolean;
  onDelete: (slug: string) => void;
  onOpen: (skill: SkillMeta) => void;
  opening: boolean;
  skill: SkillMeta;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)_max-content] items-center gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 py-2 text-cg-fg">
      <WandSparkles aria-hidden="true" className="text-cg-muted" size={16} />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-bold leading-tight text-cg-fg">
          {skill.name}
        </div>
        {skill.description ? (
          <div className="truncate text-[10.5px] font-semibold leading-tight text-cg-muted">
            {skill.description}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Button
          className={compactButtonClassName}
          disabled={busy}
          onClick={() => onOpen(skill)}
          size="none"
          variant="ghost"
        >
          {opening ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
              size={13}
              strokeWidth={1.8}
            />
          ) : null}
          Edit
        </Button>
        <Button
          aria-label={
            confirmingDelete
              ? `Confirm deleting ${skill.name}`
              : `Delete ${skill.name}`
          }
          className={
            confirmingDelete
              ? `${compactButtonClassName} text-cg-danger`
              : "size-7 rounded-[6px] p-0"
          }
          disabled={busy}
          onClick={() => onDelete(skill.slug)}
          size="none"
          title={confirmingDelete ? "Click again to delete" : "Delete"}
          variant="ghost"
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
