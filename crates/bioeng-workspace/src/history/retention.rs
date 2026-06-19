//! Checkpoint retention — intentionally a no-op seam for now.
//!
//! Source trees are tiny and libgit2 has no garbage collection, so rewriting
//! old checkpoints would not reclaim disk; the UI thins visually by grouping
//! checkpoints per day instead. A later layer (off-machine backup) may
//! introduce real thinning, which belongs here.

/// Placeholder policy. When real retention lands, this gains fields (e.g. keep
/// every checkpoint for N days, then one per day) and a plan/apply pair.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Default)]
pub struct RetentionPolicy;
