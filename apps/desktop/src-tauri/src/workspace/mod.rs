//! Workspace git-history commands. History is a general-purpose view and
//! manager of a workspace's real git branch (HEAD): the same for every repo,
//! whether the app created it or the user opened a folder of their own.
//! Commands take just the workspace `root` path and are stateless.

pub mod history;

/// Run blocking git work off the async runtime, flattening the join error into
/// the command's `String` error.
async fn run_blocking<F, T>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}
