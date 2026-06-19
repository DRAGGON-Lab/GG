use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard},
};

use tauri::async_runtime::JoinHandle;
use tokio::sync::oneshot;

use bioeng_agent::Message;

/// Host-side agent state: per-session conversation history + running task, and the
/// permission requests currently awaiting a webview decision.
#[derive(Default)]
pub struct AgentState {
    inner: Mutex<AgentInner>,
}

#[derive(Default)]
struct AgentInner {
    sessions: HashMap<String, SessionEntry>,
    pending: HashMap<String, PendingPermission>,
    next_permission: u64,
    next_task: u64,
}

#[derive(Default)]
struct SessionEntry {
    history: Vec<Message>,
    task_id: Option<u64>,
    task: Option<JoinHandle<()>>,
}

struct PendingPermission {
    session_id: String,
    task_id: u64,
    sender: oneshot::Sender<bool>,
}

impl AgentState {
    fn lock(&self) -> MutexGuard<'_, AgentInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(super) fn history(&self, session_id: &str) -> Vec<Message> {
        self.lock()
            .sessions
            .get(session_id)
            .map(|entry| entry.history.clone())
            .unwrap_or_default()
    }

    pub(super) fn set_history(&self, session_id: &str, history: Vec<Message>) {
        self.lock()
            .sessions
            .entry(session_id.to_string())
            .or_default()
            .history = history;
    }

    pub(super) fn start_task(&self, session_id: &str) -> u64 {
        let mut inner = self.lock();
        let task_id = inner.next_task;
        inner.next_task += 1;

        let old_task_id = {
            let entry = inner.sessions.entry(session_id.to_string()).or_default();
            let old_task = entry.task.take();
            let old_task_id = entry.task_id.replace(task_id);
            if let Some(task) = old_task {
                task.abort();
            }
            old_task_id
        };
        remove_pending(&mut inner, session_id, old_task_id);
        task_id
    }

    pub(super) fn attach_task(&self, session_id: &str, task_id: u64, task: JoinHandle<()>) {
        let mut inner = self.lock();
        let Some(entry) = inner.sessions.get_mut(session_id) else {
            task.abort();
            return;
        };
        if entry.task_id != Some(task_id) {
            task.abort();
            return;
        }
        if let Some(old_task) = entry.task.replace(task) {
            old_task.abort();
        }
    }

    pub(super) fn clear_task(&self, session_id: &str, task_id: u64) {
        let mut inner = self.lock();
        let should_clear = inner
            .sessions
            .get(session_id)
            .is_some_and(|entry| entry.task_id == Some(task_id));
        if should_clear {
            if let Some(entry) = inner.sessions.get_mut(session_id) {
                entry.task = None;
                entry.task_id = None;
            }
            remove_pending(&mut inner, session_id, Some(task_id));
        }
    }

    pub(super) fn abort(&self, session_id: &str) -> bool {
        let mut inner = self.lock();
        let (active, task) = if let Some(entry) = inner.sessions.get_mut(session_id) {
            let task_id = entry.task_id.take();
            let task = entry.task.take();
            let active = task_id.is_some();
            remove_pending(&mut inner, session_id, task_id);
            (active, task)
        } else {
            (false, None)
        };
        if let Some(task) = task {
            task.abort();
        }
        active
    }

    pub(super) fn park_permission(
        &self,
        session_id: &str,
        task_id: u64,
        sender: oneshot::Sender<bool>,
    ) -> String {
        let mut inner = self.lock();
        let id = inner.next_permission;
        inner.next_permission += 1;
        let request_id = format!("perm-{id}");
        inner.pending.insert(
            request_id.clone(),
            PendingPermission {
                session_id: session_id.to_string(),
                task_id,
                sender,
            },
        );
        request_id
    }

    pub(super) fn resolve_permission(&self, request_id: &str, allow: bool) {
        let pending = self.lock().pending.remove(request_id);
        if let Some(pending) = pending {
            let _ = pending.sender.send(allow);
        }
    }
}

fn remove_pending(inner: &mut AgentInner, session_id: &str, task_id: Option<u64>) {
    inner.pending.retain(|_, pending| {
        let session_matches = pending.session_id == session_id;
        let task_matches = task_id.map(|id| pending.task_id == id).unwrap_or(true);
        !(session_matches && task_matches)
    });
}
