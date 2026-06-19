use rusqlite::{params, Connection, OptionalExtension};

struct Migration {
    name: &'static str,
    sql: &'static str,
    version: i64,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_settings",
        sql: r#"
            CREATE TABLE settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        "#,
    },
    Migration {
        version: 2,
        name: "create_ai_conversations",
        sql: r#"
            CREATE TABLE ai_conversations (
                id TEXT PRIMARY KEY NOT NULL,
                agent_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE ai_context_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                label TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE ai_transcript_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                payload_json TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE ai_model_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
                message_json TEXT NOT NULL,
                sort_order INTEGER NOT NULL
            );

            CREATE INDEX ai_conversations_updated_at_idx
                ON ai_conversations(updated_at);
            CREATE INDEX ai_context_conversation_idx
                ON ai_context_attachments(conversation_id, sort_order);
            CREATE INDEX ai_transcript_conversation_idx
                ON ai_transcript_entries(conversation_id, sort_order);
            CREATE INDEX ai_model_messages_conversation_idx
                ON ai_model_messages(conversation_id, sort_order);
        "#,
    },
    Migration {
        version: 3,
        name: "create_backup_activity",
        sql: r#"
            CREATE TABLE backup_activity (
                id TEXT PRIMARY KEY NOT NULL,
                provider TEXT NOT NULL DEFAULT 'local',
                operation TEXT NOT NULL CHECK (operation IN ('backup', 'restore', 'retention')),
                status TEXT NOT NULL CHECK (status IN ('started', 'complete', 'failed', 'skipped')),
                snapshot_id TEXT,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                bytes_total INTEGER NOT NULL DEFAULT 0,
                bytes_completed INTEGER NOT NULL DEFAULT 0,
                error_code TEXT,
                error_message TEXT,
                message TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX backup_activity_started_at_idx
                ON backup_activity(started_at);
            CREATE INDEX backup_activity_status_idx
                ON backup_activity(status, started_at);
        "#,
    },
    Migration {
        version: 4,
        name: "add_ai_platform_conversation_id",
        sql: r#"
            ALTER TABLE ai_conversations ADD COLUMN platform_conversation_id TEXT;
        "#,
    },
    Migration {
        version: 5,
        name: "create_ai_memory",
        sql: r#"
            CREATE TABLE ai_memory_conclusions (
                id TEXT PRIMARY KEY NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('background', 'goal', 'preference', 'project', 'struggle', 'convention')),
                content TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalidated')),
                source_conversation_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX ai_memory_status_kind_idx
                ON ai_memory_conclusions(status, kind, updated_at);

            CREATE VIRTUAL TABLE ai_memory_conclusions_fts USING fts5(
                conclusion_id UNINDEXED,
                content
            );
        "#,
    },
    Migration {
        version: 6,
        name: "create_mcp_servers",
        sql: r#"
            CREATE TABLE mcp_servers (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL UNIQUE,
                transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
                command TEXT NOT NULL DEFAULT '',
                args_json TEXT NOT NULL DEFAULT '[]',
                env_json TEXT NOT NULL DEFAULT '{}',
                url TEXT NOT NULL DEFAULT '',
                headers_json TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                auto_allow_tools INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        "#,
    },
    Migration {
        version: 7,
        name: "create_telemetry_outbox",
        sql: r#"
            CREATE TABLE telemetry_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_name TEXT NOT NULL,
                properties_json TEXT NOT NULL DEFAULT '{}',
                session_id TEXT,
                client_time_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        "#,
    },
];

pub(super) fn migrate(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )
        .map_err(|error| error.to_string())?;

    for migration in MIGRATIONS {
        let already_applied = connection
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = ?1",
                params![migration.version],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .is_some();

        if already_applied {
            continue;
        }

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(migration.sql)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![migration.version, migration.name],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }

    Ok(())
}
