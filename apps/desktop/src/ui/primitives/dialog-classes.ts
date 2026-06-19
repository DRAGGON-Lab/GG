/// Shared chrome for the app's centered modal dialogs (Base UI `Dialog`), so
/// they enter and exit with one consistent gesture instead of copy-pasted
/// class strings drifting apart. Each dialog appends its own layout classes
/// (width, padding, grid rows) via `cx`.
///
/// Base UI keeps a closing Popup/Backdrop mounted while a CSS animation runs
/// and marks it with `data-ending-style`; the exit keyframes hang off that.
/// Exits resolve a touch faster than entrances — the system responding, not
/// arriving.
///
/// The CommandPalette deliberately opts out: it's keyboard-driven and opened
/// dozens of times a session, so it should open and close instantly.

export const appDialogBackdropClassName =
  "fixed inset-0 bg-cg-overlay animate-[app-command-backdrop-in_120ms_ease] data-[ending-style]:animate-[app-command-backdrop-out_100ms_ease] motion-reduce:animate-none";

export const appDialogPopupClassName =
  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-cg-command-border bg-cg-command text-cg-fg shadow-[var(--cg-command-shadow)] animate-[app-command-popup-in_140ms_var(--ease-out-strong)] data-[ending-style]:animate-[app-command-popup-out_120ms_var(--ease-out-strong)] focus-visible:outline-none motion-reduce:animate-none";
