//! Persistent user memory: durable conclusions about the user derived from
//! completed AI exchanges. One global representation spans all conversations and
//! agents; conclusions are refined in place (update/invalidate) rather than
//! appended forever. Full-text search runs over an FTS5 mirror kept in sync here.

use rusqlite::{params, OptionalExtension};

use crate::Database;

use super::storage::generated_id;
use super::AiMemoryConclusion;

/// The categories a conclusion can have; mirrors the table's CHECK constraint.
pub const AI_MEMORY_KINDS: &[&str] = &[
    "background",
    "goal",
    "preference",
    "project",
    "struggle",
    "convention",
];

impl Database {
    pub fn list_ai_memory(
        &self,
        include_invalidated: bool,
    ) -> Result<Vec<AiMemoryConclusion>, String> {
        let connection = self.connection()?;
        let sql = format!(
            r#"
            SELECT id, kind, content, confidence, status, source_conversation_id,
                   created_at, updated_at
            FROM ai_memory_conclusions
            {}
            ORDER BY kind, confidence DESC, updated_at DESC
            "#,
            if include_invalidated {
                ""
            } else {
                "WHERE status = 'active'"
            }
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], row_to_conclusion)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn search_ai_memory(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<AiMemoryConclusion>, String> {
        let Some(fts_query) = fts_query(query) else {
            return Ok(Vec::new());
        };
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT m.id, m.kind, m.content, m.confidence, m.status,
                       m.source_conversation_id, m.created_at, m.updated_at
                FROM ai_memory_conclusions_fts f
                JOIN ai_memory_conclusions m ON m.id = f.conclusion_id
                WHERE ai_memory_conclusions_fts MATCH ?1 AND m.status = 'active'
                ORDER BY rank
                LIMIT ?2
                "#,
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![fts_query, limit as i64], row_to_conclusion)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    }

    pub fn insert_ai_memory(
        &self,
        kind: &str,
        content: &str,
        confidence: f64,
        source_conversation_id: Option<&str>,
    ) -> Result<AiMemoryConclusion, String> {
        validate_kind(kind)?;
        let content = content.trim();
        if content.is_empty() {
            return Err("Memory conclusions need content".to_string());
        }
        let id = generated_id("mem");
        let connection = self.connection()?;
        connection
            .execute(
                r#"
                INSERT INTO ai_memory_conclusions
                    (id, kind, content, confidence, source_conversation_id)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                params![
                    id,
                    kind,
                    content,
                    confidence.clamp(0.0, 1.0),
                    source_conversation_id
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO ai_memory_conclusions_fts (conclusion_id, content) VALUES (?1, ?2)",
                params![id, content],
            )
            .map_err(|error| error.to_string())?;
        drop(connection);
        self.get_ai_memory(&id)?
            .ok_or_else(|| "created memory conclusion not found".to_string())
    }

    pub fn update_ai_memory(
        &self,
        id: &str,
        content: Option<&str>,
        kind: Option<&str>,
        confidence: Option<f64>,
    ) -> Result<Option<AiMemoryConclusion>, String> {
        if let Some(kind) = kind {
            validate_kind(kind)?;
        }
        if let Some(content) = content {
            if content.trim().is_empty() {
                return Err("Memory conclusions need content".to_string());
            }
        }
        let connection = self.connection()?;
        let updated = connection
            .execute(
                r#"
                UPDATE ai_memory_conclusions
                SET content = COALESCE(?2, content),
                    kind = COALESCE(?3, kind),
                    confidence = COALESCE(?4, confidence),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?1
                "#,
                params![
                    id,
                    content.map(str::trim),
                    kind,
                    confidence.map(|value| value.clamp(0.0, 1.0))
                ],
            )
            .map_err(|error| error.to_string())?;
        if updated == 0 {
            return Ok(None);
        }
        if let Some(content) = content {
            connection
                .execute(
                    "UPDATE ai_memory_conclusions_fts SET content = ?2 WHERE conclusion_id = ?1",
                    params![id, content.trim()],
                )
                .map_err(|error| error.to_string())?;
        }
        drop(connection);
        self.get_ai_memory(id)
    }

    pub fn set_ai_memory_status(&self, id: &str, status: &str) -> Result<bool, String> {
        if status != "active" && status != "invalidated" {
            return Err(format!("Unknown memory status: {status}"));
        }
        let connection = self.connection()?;
        let updated = connection
            .execute(
                r#"
                UPDATE ai_memory_conclusions
                SET status = ?2, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?1
                "#,
                params![id, status],
            )
            .map_err(|error| error.to_string())?;
        Ok(updated > 0)
    }

    pub fn delete_ai_memory(&self, id: &str) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .execute(
                "DELETE FROM ai_memory_conclusions_fts WHERE conclusion_id = ?1",
                params![id],
            )
            .map_err(|error| error.to_string())?;
        let deleted = connection
            .execute(
                "DELETE FROM ai_memory_conclusions WHERE id = ?1",
                params![id],
            )
            .map_err(|error| error.to_string())?;
        Ok(deleted > 0)
    }

    pub fn count_active_ai_memory(&self) -> Result<usize, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT COUNT(*) FROM ai_memory_conclusions WHERE status = 'active'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count as usize)
            .map_err(|error| error.to_string())
    }

    /// The compact view injected into agent system prompts: the strongest, most
    /// recently touched active conclusions, at most `per_kind` per kind.
    pub fn ai_memory_working_representation(
        &self,
        per_kind: usize,
    ) -> Result<Vec<AiMemoryConclusion>, String> {
        let all = self.list_ai_memory(false)?;
        let mut taken: Vec<AiMemoryConclusion> = Vec::new();
        for conclusion in all {
            let count = taken
                .iter()
                .filter(|existing| existing.kind == conclusion.kind)
                .count();
            if count < per_kind {
                taken.push(conclusion);
            }
        }
        Ok(taken)
    }

    fn get_ai_memory(&self, id: &str) -> Result<Option<AiMemoryConclusion>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                r#"
                SELECT id, kind, content, confidence, status, source_conversation_id,
                       created_at, updated_at
                FROM ai_memory_conclusions
                WHERE id = ?1
                "#,
                params![id],
                row_to_conclusion,
            )
            .optional()
            .map_err(|error| error.to_string())
    }
}

fn row_to_conclusion(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiMemoryConclusion> {
    Ok(AiMemoryConclusion {
        id: row.get(0)?,
        kind: row.get(1)?,
        content: row.get(2)?,
        confidence: row.get(3)?,
        status: row.get(4)?,
        source_conversation_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn validate_kind(kind: &str) -> Result<(), String> {
    if AI_MEMORY_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(format!("Unknown memory kind: {kind}"))
    }
}

fn fts_query(query: &str) -> Option<String> {
    let tokens = query
        .split(|character: char| !character.is_alphanumeric())
        .filter_map(|token| {
            let token = token.trim().to_lowercase();
            if token.is_empty() {
                None
            } else {
                Some(format!("{token}*"))
            }
        })
        .collect::<Vec<_>>();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use crate::Database;
    use std::{
        env, fs, process,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_database(name: &str) -> Database {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = env::temp_dir().join(format!(
            "gg-data-memory-{name}-{}-{timestamp}.sqlite3",
            process::id()
        ));
        let _ = fs::remove_file(&path);
        Database::open(path).expect("test database should open")
    }

    #[test]
    fn memory_roundtrip_search_and_status() {
        let database = test_database("roundtrip");

        let conclusion = database
            .insert_ai_memory(
                "project",
                "Working through Hartshorne chapter II on schemes",
                0.8,
                Some("ai-test"),
            )
            .expect("insert should succeed");
        assert_eq!(conclusion.kind, "project");
        assert_eq!(conclusion.status, "active");

        let hits = database
            .search_ai_memory("hartshorne schemes", 10)
            .expect("search should succeed");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, conclusion.id);

        let updated = database
            .update_ai_memory(
                &conclusion.id,
                Some("Finished Hartshorne chapter II; starting chapter III"),
                None,
                Some(0.9),
            )
            .expect("update should succeed")
            .expect("conclusion should exist");
        assert!(updated.content.contains("chapter III"));
        assert!((updated.confidence - 0.9).abs() < f64::EPSILON);

        let hits = database
            .search_ai_memory("chapter III", 10)
            .expect("search should reflect the FTS resync");
        assert_eq!(hits.len(), 1);

        assert!(database
            .set_ai_memory_status(&conclusion.id, "invalidated")
            .expect("status change should succeed"));
        assert!(database
            .search_ai_memory("hartshorne", 10)
            .expect("search should succeed")
            .is_empty());
        assert!(database
            .list_ai_memory(false)
            .expect("list should succeed")
            .is_empty());
        assert_eq!(database.list_ai_memory(true).expect("list all").len(), 1);

        assert!(database
            .delete_ai_memory(&conclusion.id)
            .expect("delete should succeed"));
        assert_eq!(database.count_active_ai_memory().expect("count"), 0);
    }

    #[test]
    fn working_representation_caps_each_kind() {
        let database = test_database("representation");
        for index in 0..7 {
            database
                .insert_ai_memory("preference", &format!("Preference {index}"), 0.5, None)
                .expect("insert should succeed");
        }
        database
            .insert_ai_memory("goal", "Model a genetic toggle switch", 0.7, None)
            .expect("insert should succeed");

        let representation = database
            .ai_memory_working_representation(5)
            .expect("representation should build");
        assert_eq!(
            representation
                .iter()
                .filter(|conclusion| conclusion.kind == "preference")
                .count(),
            5
        );
        assert_eq!(
            representation
                .iter()
                .filter(|conclusion| conclusion.kind == "goal")
                .count(),
            1
        );
    }

    #[test]
    fn rejects_unknown_kind() {
        let database = test_database("kinds");
        assert!(database
            .insert_ai_memory("mood", "happy", 0.5, None)
            .is_err());
    }
}
