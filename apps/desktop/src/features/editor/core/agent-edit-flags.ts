/// Set while the agent-edit applier mutates a Monaco model. The undo reconciler
/// reads it to tell the applier's own edits apart from a user's manual edit (so
/// it doesn't mistake the agent's insertion for a user undo). A plain
/// module-scope box rather than a ref/context so the applier and any editor code
/// share one flag without prop-drilling — both import this module directly.
export const agentEditInProgress = { current: false };
