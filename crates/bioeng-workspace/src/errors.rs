//! Error type for the workspace foundation layer.

use std::fmt;

pub type WorkspaceResult<T> = Result<T, WorkspaceError>;

/// Failures from workspace history operations. Everything funnels to a `String`
/// at the Tauri boundary.
#[derive(Debug)]
pub enum WorkspaceError {
    /// Underlying filesystem failure.
    Io(std::io::Error),
    /// A failure from libgit2 (the checkpoint engine).
    Git(git2::Error),
    /// A precondition was not met or an operation was rejected, with a
    /// user-facing explanation.
    Message(String),
}

impl WorkspaceError {
    pub fn message(text: impl Into<String>) -> Self {
        Self::Message(text.into())
    }
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{error}"),
            Self::Git(error) => write!(f, "{}", error.message()),
            Self::Message(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for WorkspaceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Git(error) => Some(error),
            Self::Message(_) => None,
        }
    }
}

impl From<std::io::Error> for WorkspaceError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<git2::Error> for WorkspaceError {
    fn from(error: git2::Error) -> Self {
        Self::Git(error)
    }
}

impl From<WorkspaceError> for String {
    fn from(error: WorkspaceError) -> Self {
        error.to_string()
    }
}
