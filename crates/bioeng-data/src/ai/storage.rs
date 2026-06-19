use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::Database;

use super::{
    AiContextAttachment, AiContextAttachmentInput, AiConversation, AiConversationCreateInput,
    AiConversationSummary, AiTranscriptEntry,
};

static AI_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

impl Database {
    pub fn list_ai_conversations(&self) -> Result<Vec<AiConversationSummary>, String> {
        let connection = self.connection()?;
        list_conversations(&connection)
    }

    pub fn create_ai_conversation(
        &self,
        input: AiConversationCreateInput,
    ) -> Result<AiConversation, String> {
        let id = generated_id("ai");
        let agent_id = non_empty(input.agent_id, "workspace-ai");
        let title = input
            .title
            .and_then(|title| non_empty_option(title.trim().to_string()))
            .unwrap_or_else(|| "AI".to_string());
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;

        transaction
            .execute(
                r#"
                INSERT INTO ai_conversations (id, agent_id, title)
                VALUES (?1, ?2, ?3)
                "#,
                params![id, agent_id, title],
            )
            .map_err(|error| error.to_string())?;
        replace_context_attachments(&transaction, &id, input.context_attachments)?;
        transaction.commit().map_err(|error| error.to_string())?;
        drop(connection);

        self.get_ai_conversation(&id)?
            .ok_or_else(|| "created AI conversation not found".to_string())
    }

    pub fn get_ai_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Option<AiConversation>, String> {
        let connection = self.connection()?;
        get_conversation(&connection, conversation_id)
    }

    pub fn delete_ai_conversation(&self, conversation_id: &str) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .execute(
                "DELETE FROM ai_conversations WHERE id = ?1",
                params![conversation_id],
            )
            .map(|deleted| deleted > 0)
            .map_err(|error| error.to_string())
    }

    pub fn ai_conversation_exists(&self, conversation_id: &str) -> Result<bool, String> {
        let connection = self.connection()?;
        conversation_exists(&connection, conversation_id)
    }

    /// The platform conversation id (`conv_…`) mirrored for this local
    /// conversation, if one has been created.
    pub fn get_ai_platform_conversation_id(
        &self,
        conversation_id: &str,
    ) -> Result<Option<String>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT platform_conversation_id FROM ai_conversations WHERE id = ?1",
                params![conversation_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(Option::flatten)
            .map_err(|error| error.to_string())
    }

    pub fn set_ai_platform_conversation_id(
        &self,
        conversation_id: &str,
        platform_conversation_id: &str,
    ) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE ai_conversations SET platform_conversation_id = ?2 WHERE id = ?1",
                params![conversation_id, platform_conversation_id],
            )
            .map(|updated| updated > 0)
            .map_err(|error| error.to_string())
    }

    pub fn update_ai_conversation_title(
        &self,
        conversation_id: &str,
        title: &str,
    ) -> Result<Option<AiConversation>, String> {
        let title = non_empty(title.trim().to_string(), "AI");
        let connection = self.connection()?;
        let updated = connection
            .execute(
                r#"
                UPDATE ai_conversations
                SET title = ?2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?1
                "#,
                params![conversation_id, title],
            )
            .map_err(|error| error.to_string())?;

        if updated == 0 {
            Ok(None)
        } else {
            get_conversation(&connection, conversation_id)
        }
    }

    pub fn set_ai_context_attachments(
        &self,
        conversation_id: &str,
        attachments: Vec<AiContextAttachmentInput>,
    ) -> Result<Option<AiConversation>, String> {
        let mut connection = self.connection()?;

        if !conversation_exists(&connection, conversation_id)? {
            return Ok(None);
        }

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        replace_context_attachments(&transaction, conversation_id, attachments)?;
        touch_conversation(&transaction, conversation_id)?;
        transaction.commit().map_err(|error| error.to_string())?;

        get_conversation(&connection, conversation_id)
    }

    pub fn append_ai_transcript_entry(
        &self,
        conversation_id: &str,
        role: &str,
        payload: &Value,
    ) -> Result<Option<AiTranscriptEntry>, String> {
        let connection = self.connection()?;

        if !conversation_exists(&connection, conversation_id)? {
            return Ok(None);
        }

        let sort_order = next_sort_order(&connection, "ai_transcript_entries", conversation_id)?;
        let payload_json = serde_json::to_string(payload).map_err(|error| error.to_string())?;
        connection
            .execute(
                r#"
                INSERT INTO ai_transcript_entries (
                    conversation_id,
                    role,
                    payload_json,
                    sort_order
                )
                VALUES (?1, ?2, ?3, ?4)
                "#,
                params![conversation_id, role, payload_json, sort_order],
            )
            .map_err(|error| error.to_string())?;
        touch_conversation(&connection, conversation_id)?;

        let id = connection.last_insert_rowid();
        transcript_entry_by_id(&connection, id).map(Some)
    }

    pub fn load_ai_model_messages(&self, conversation_id: &str) -> Result<Vec<Value>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT message_json
                FROM ai_model_messages
                WHERE conversation_id = ?1
                ORDER BY sort_order ASC, id ASC
                "#,
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![conversation_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let mut messages = Vec::new();

        for row in rows {
            let raw = row.map_err(|error| error.to_string())?;
            messages.push(serde_json::from_str(&raw).map_err(|error| error.to_string())?);
        }

        Ok(messages)
    }

    pub fn replace_ai_model_messages(
        &self,
        conversation_id: &str,
        messages: &[Value],
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;

        transaction
            .execute(
                "DELETE FROM ai_model_messages WHERE conversation_id = ?1",
                params![conversation_id],
            )
            .map_err(|error| error.to_string())?;

        for (index, message) in messages.iter().enumerate() {
            let message_json = serde_json::to_string(message).map_err(|error| error.to_string())?;
            transaction
                .execute(
                    r#"
                    INSERT INTO ai_model_messages (
                        conversation_id,
                        message_json,
                        sort_order
                    )
                    VALUES (?1, ?2, ?3)
                    "#,
                    params![conversation_id, message_json, index as i64],
                )
                .map_err(|error| error.to_string())?;
        }

        touch_conversation(&transaction, conversation_id)?;
        transaction.commit().map_err(|error| error.to_string())
    }
}

fn list_conversations(connection: &Connection) -> Result<Vec<AiConversationSummary>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                c.id,
                c.agent_id,
                c.title,
                c.created_at,
                c.updated_at,
                (
                    SELECT COUNT(*)
                    FROM ai_transcript_entries e
                    WHERE e.conversation_id = c.id
                ) AS message_count
            FROM ai_conversations c
            WHERE EXISTS (
                SELECT 1
                FROM ai_transcript_entries e
                WHERE e.conversation_id = c.id
            )
            ORDER BY c.updated_at DESC, c.created_at DESC
            "#,
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut conversations = Vec::new();

    for row in rows {
        let (id, agent_id, title, created_at, updated_at, message_count) =
            row.map_err(|error| error.to_string())?;
        conversations.push(AiConversationSummary {
            context_attachments: list_context_attachments(connection, &id)?,
            agent_id,
            created_at,
            id,
            message_count,
            title,
            updated_at,
        });
    }

    Ok(conversations)
}

fn get_conversation(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<AiConversation>, String> {
    let row: Option<(String, String, String, String, String)> = connection
        .query_row(
            r#"
            SELECT id, agent_id, title, created_at, updated_at
            FROM ai_conversations
            WHERE id = ?1
            "#,
            params![conversation_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let Some((id, agent_id, title, created_at, updated_at)) = row else {
        return Ok(None);
    };

    Ok(Some(AiConversation {
        context_attachments: list_context_attachments(connection, &id)?,
        transcript_entries: list_transcript_entries(connection, &id)?,
        agent_id,
        created_at,
        id,
        title,
        updated_at,
    }))
}

fn conversation_exists(connection: &Connection, conversation_id: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT 1 FROM ai_conversations WHERE id = ?1",
            params![conversation_id],
            |_| Ok(()),
        )
        .optional()
        .map(|value| value.is_some())
        .map_err(|error| error.to_string())
}

fn replace_context_attachments(
    connection: &Connection,
    conversation_id: &str,
    attachments: Vec<AiContextAttachmentInput>,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM ai_context_attachments WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| error.to_string())?;

    for (index, attachment) in attachments.into_iter().enumerate() {
        let attachment = attachment.normalized();
        let payload_json =
            serde_json::to_string(&attachment.payload).map_err(|error| error.to_string())?;
        connection
            .execute(
                r#"
                INSERT INTO ai_context_attachments (
                    conversation_id,
                    kind,
                    label,
                    payload_json,
                    sort_order
                )
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                params![
                    conversation_id,
                    attachment.kind,
                    attachment.label,
                    payload_json,
                    index as i64
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn list_context_attachments(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<AiContextAttachment>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, kind, label, payload_json
            FROM ai_context_attachments
            WHERE conversation_id = ?1
            ORDER BY sort_order ASC, id ASC
            "#,
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut attachments = Vec::new();

    for row in rows {
        let (id, kind, label, payload_json) = row.map_err(|error| error.to_string())?;
        let payload = serde_json::from_str(&payload_json).map_err(|error| error.to_string())?;
        attachments.push(AiContextAttachment {
            id: Some(id),
            kind,
            label,
            payload,
        });
    }

    Ok(attachments)
}

fn list_transcript_entries(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<AiTranscriptEntry>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, role, payload_json, created_at
            FROM ai_transcript_entries
            WHERE conversation_id = ?1
            ORDER BY sort_order ASC, id ASC
            "#,
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut entries = Vec::new();

    for row in rows {
        let (id, role, payload_json, created_at) = row.map_err(|error| error.to_string())?;
        let payload = serde_json::from_str(&payload_json).map_err(|error| error.to_string())?;
        entries.push(AiTranscriptEntry {
            created_at,
            id,
            payload,
            role,
        });
    }

    Ok(entries)
}

fn transcript_entry_by_id(
    connection: &Connection,
    entry_id: i64,
) -> Result<AiTranscriptEntry, String> {
    let (id, role, payload_json, created_at) = connection
        .query_row(
            r#"
            SELECT id, role, payload_json, created_at
            FROM ai_transcript_entries
            WHERE id = ?1
            "#,
            params![entry_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let payload = serde_json::from_str(&payload_json).map_err(|error| error.to_string())?;
    Ok(AiTranscriptEntry {
        created_at,
        id,
        payload,
        role,
    })
}

fn next_sort_order(
    connection: &Connection,
    table: &str,
    conversation_id: &str,
) -> Result<i64, String> {
    let sql =
        format!("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {table} WHERE conversation_id = ?1");
    connection
        .query_row(&sql, params![conversation_id], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn touch_conversation(connection: &Connection, conversation_id: &str) -> Result<(), String> {
    connection
        .execute(
            r#"
            UPDATE ai_conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?1
            "#,
            params![conversation_id],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(super) fn generated_id(prefix: &str) -> String {
    let counter = AI_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{prefix}-{timestamp:x}-{counter:x}")
}

fn non_empty(value: String, fallback: &str) -> String {
    non_empty_option(value).unwrap_or_else(|| fallback.to_string())
}

fn non_empty_option(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::AiConversationCreateInput;
    use std::{env, fs, process};

    fn test_database(name: &str) -> Database {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = env::temp_dir().join(format!(
            "bioeng-data-ai-{name}-{}-{timestamp}.sqlite3",
            process::id()
        ));
        let _ = fs::remove_file(&path);
        Database::open(path).expect("test database should open")
    }

    #[test]
    fn ai_conversation_roundtrip_persists_context_transcript_and_model_messages() {
        let database = test_database("roundtrip");
        let conversation = database
            .create_ai_conversation(AiConversationCreateInput {
                agent_id: "workspace-ai".to_string(),
                context_attachments: vec![AiContextAttachmentInput {
                    kind: "editorCursor".to_string(),
                    label: "model.py:4".to_string(),
                    payload: serde_json::json!({
                        "uri": "file:///model.py",
                        "line": 3,
                        "character": 2
                    }),
                }],
                title: Some("Circuit model".to_string()),
            })
            .expect("conversation should be created");

        assert_eq!(conversation.title, "Circuit model");
        assert_eq!(conversation.context_attachments.len(), 1);

        let summaries = database
            .list_ai_conversations()
            .expect("empty conversations should be listable");
        assert!(
            summaries.is_empty(),
            "empty conversations should not appear in history"
        );

        database
            .append_ai_transcript_entry(
                &conversation.id,
                "user",
                &serde_json::json!({
                    "role": "user",
                    "id": "user-1",
                    "text": "Explain this goal"
                }),
            )
            .expect("user transcript should persist")
            .expect("conversation should exist");
        database
            .append_ai_transcript_entry(
                &conversation.id,
                "assistant",
                &serde_json::json!({
                    "role": "assistant",
                    "id": "ai-1",
                    "blocks": [{ "type": "text", "text": "Introduce the hypothesis." }],
                    "done": true
                }),
            )
            .expect("AI transcript should persist")
            .expect("conversation should exist");

        let messages = vec![
            serde_json::json!({
                "role": "user",
                "content": [{ "type": "text", "text": "Explain this goal" }]
            }),
            serde_json::json!({
                "role": "assistant",
                "content": [{ "type": "text", "text": "Introduce the hypothesis." }]
            }),
        ];
        database
            .replace_ai_model_messages(&conversation.id, &messages)
            .expect("model messages should persist");

        let loaded = database
            .get_ai_conversation(&conversation.id)
            .expect("conversation should load")
            .expect("conversation should exist");
        assert_eq!(loaded.transcript_entries.len(), 2);
        assert_eq!(loaded.transcript_entries[0].payload["role"], "user");

        let loaded_messages = database
            .load_ai_model_messages(&conversation.id)
            .expect("model messages should load");
        assert_eq!(loaded_messages, messages);

        let summaries = database
            .list_ai_conversations()
            .expect("summaries should load");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].message_count, 2);

        assert!(
            database
                .delete_ai_conversation(&conversation.id)
                .expect("conversation should delete"),
            "existing conversation should report deletion"
        );
        assert!(
            database
                .get_ai_conversation(&conversation.id)
                .expect("deleted conversation lookup should succeed")
                .is_none(),
            "deleted conversation should not load"
        );
        assert!(
            database
                .list_ai_conversations()
                .expect("summaries should load after delete")
                .is_empty(),
            "deleted conversation should disappear from history"
        );
        assert!(
            database
                .load_ai_model_messages(&conversation.id)
                .expect("deleted model messages lookup should succeed")
                .is_empty(),
            "model messages should cascade on delete"
        );
        assert!(
            !database
                .delete_ai_conversation(&conversation.id)
                .expect("second delete should succeed"),
            "missing conversation should report no deletion"
        );
    }
}
