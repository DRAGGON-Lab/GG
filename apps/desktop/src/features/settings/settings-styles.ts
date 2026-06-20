// Shared styling primitives for the settings sections. Each section renders the
// same field, input, and section-shell shapes, so they live here once.

export const settingsSectionClassName =
  "grid max-w-[760px] gap-3.5 [@container(max-width:520px)]:gap-3";

export const settingsFieldClassName =
  "grid gap-[7px] [&>span]:text-[11px] [&>span]:font-bold [&>span]:leading-none [&>span]:text-cg-muted";

export const settingsInputClassName =
  "h-8 w-full min-w-0 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 font-[inherit] text-[13px] leading-none text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";
