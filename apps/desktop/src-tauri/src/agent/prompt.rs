//! Per-send system prompt assembly: the agent's static prompt first (a stable
//! prompt-cache prefix), then the dynamic sections — the skills index and, for
//! memory-enabled agents, the working representation of the user.

use tauri::{AppHandle, Manager};

use gg_agent::AgentMode;
use gg_data::Database;

use super::agents::AgentDefinition;

/// At most this many conclusions per kind reach the prompt; memory_search covers
/// the long tail.
const MEMORY_PER_KIND: usize = 5;

pub fn build_system_prompt(app: &AppHandle, agent: &AgentDefinition, mode: AgentMode) -> String {
    let mut prompt = agent.system_prompt.to_string();
    if agent.use_skills {
        if let Some(section) = skills_section(app) {
            prompt.push_str(&section);
        }
    }
    if agent.use_memory {
        if let Some(section) = memory_section(app) {
            prompt.push_str(&section);
        }
    }
    prompt.push_str(mode_section(mode));
    prompt
}

/// The autonomy note, appended last so the stable prompt prefix stays cacheable.
fn mode_section(mode: AgentMode) -> &'static str {
    match mode {
        AgentMode::Review => "\n\n## Mode: Review\nYour file edits and new files appear as pending changes the user accepts or rejects, and deletions and moves require explicit approval. Do not ask for permission in chat — the review happens on each change itself. Proceed and make the changes; if the user rejects one, take a different approach.",
        AgentMode::Agentic => "\n\n## Mode: Agentic\nYour edits, new files, deletions, and moves are applied immediately without per-change review. Work autonomously toward the goal without asking for confirmation. Be deliberate — especially with deletions and moves — and prefer the smallest changes that accomplish the task.",
    }
}

fn memory_section(app: &AppHandle) -> Option<String> {
    let conclusions = app
        .state::<Database>()
        .ai_memory_working_representation(MEMORY_PER_KIND)
        .ok()?;
    if conclusions.is_empty() {
        return None;
    }
    let mut section = String::from(
        "\n\n## What you know about this user\nAccumulated from past sessions; may be incomplete — prefer what the user says in this conversation. Use memory_search to recall more.\n",
    );
    let labels = [
        ("background", "Background"),
        ("goal", "Goals"),
        ("preference", "Preferences"),
        ("project", "Projects"),
        ("struggle", "Struggles"),
        ("convention", "Conventions"),
    ];
    for (kind, label) in labels {
        let items = conclusions
            .iter()
            .filter(|conclusion| conclusion.kind == kind)
            .collect::<Vec<_>>();
        if items.is_empty() {
            continue;
        }
        section.push_str(label);
        section.push_str(":\n");
        for item in items {
            section.push_str("- ");
            section.push_str(&item.content);
            section.push('\n');
        }
    }
    Some(section)
}

fn skills_section(app: &AppHandle) -> Option<String> {
    let skills = crate::skills::list_skills(app).ok()?;
    if skills.is_empty() {
        return None;
    }
    let mut section = String::from(
        "\n\n## Skills\nThe user has authored skills — named instruction sets for specific tasks. When one matches the task at hand, call skill(name) to load its full instructions before proceeding, and follow them.\n",
    );
    for skill in skills {
        section.push_str("- ");
        section.push_str(&skill.name);
        if !skill.description.is_empty() {
            section.push_str(": ");
            section.push_str(&skill.description);
        }
        section.push('\n');
    }
    Some(section)
}
