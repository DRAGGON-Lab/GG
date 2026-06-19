use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};

use crate::Database;

use super::{McpServerConfig, McpServerInput, McpTransport};

static MCP_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

impl Database {
    pub fn list_mcp_servers(&self) -> Result<Vec<McpServerConfig>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, name, transport, command, args_json, env_json, url, headers_json,
                       enabled, auto_allow_tools, created_at, updated_at
                FROM mcp_servers
                ORDER BY name COLLATE NOCASE
                "#,
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], row_to_config)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows.into_iter().collect()
    }

    pub fn get_mcp_server(&self, id: &str) -> Result<Option<McpServerConfig>, String> {
        let connection = self.connection()?;
        let row = connection
            .query_row(
                r#"
                SELECT id, name, transport, command, args_json, env_json, url, headers_json,
                       enabled, auto_allow_tools, created_at, updated_at
                FROM mcp_servers
                WHERE id = ?1
                "#,
                params![id],
                row_to_config,
            )
            .optional()
            .map_err(|error| error.to_string())?;
        row.transpose()
    }

    pub fn save_mcp_server(&self, input: McpServerInput) -> Result<McpServerConfig, String> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err("An MCP server needs a name".to_string());
        }
        match input.transport {
            McpTransport::Stdio if input.command.trim().is_empty() => {
                return Err("A stdio MCP server needs a command".to_string());
            }
            McpTransport::Http if input.url.trim().is_empty() => {
                return Err("An HTTP MCP server needs a URL".to_string());
            }
            _ => {}
        }
        let args_json = serde_json::to_string(&input.args).map_err(|error| error.to_string())?;
        let env_json = serde_json::to_string(&input.env).map_err(|error| error.to_string())?;
        let headers_json =
            serde_json::to_string(&input.headers).map_err(|error| error.to_string())?;
        let connection = self.connection()?;
        let id = match input.id.filter(|id| !id.is_empty()) {
            Some(id) => {
                connection
                    .execute(
                        r#"
                        UPDATE mcp_servers
                        SET name = ?2, transport = ?3, command = ?4, args_json = ?5,
                            env_json = ?6, url = ?7, headers_json = ?8, enabled = ?9,
                            auto_allow_tools = ?10, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?1
                        "#,
                        params![
                            id,
                            name,
                            input.transport.as_str(),
                            input.command.trim(),
                            args_json,
                            env_json,
                            input.url.trim(),
                            headers_json,
                            input.enabled,
                            input.auto_allow_tools,
                        ],
                    )
                    .map_err(rename_collision)?;
                id
            }
            None => {
                let id = generated_id();
                connection
                    .execute(
                        r#"
                        INSERT INTO mcp_servers
                            (id, name, transport, command, args_json, env_json, url,
                             headers_json, enabled, auto_allow_tools)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                        "#,
                        params![
                            id,
                            name,
                            input.transport.as_str(),
                            input.command.trim(),
                            args_json,
                            env_json,
                            input.url.trim(),
                            headers_json,
                            input.enabled,
                            input.auto_allow_tools,
                        ],
                    )
                    .map_err(rename_collision)?;
                id
            }
        };
        drop(connection);
        self.get_mcp_server(&id)?
            .ok_or_else(|| "saved MCP server not found".to_string())
    }

    pub fn set_mcp_server_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<Option<McpServerConfig>, String> {
        let connection = self.connection()?;
        let updated = connection
            .execute(
                "UPDATE mcp_servers SET enabled = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![id, enabled],
            )
            .map_err(|error| error.to_string())?;
        drop(connection);
        if updated == 0 {
            return Ok(None);
        }
        self.get_mcp_server(id)
    }

    pub fn delete_mcp_server(&self, id: &str) -> Result<bool, String> {
        let connection = self.connection()?;
        let deleted = connection
            .execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        Ok(deleted > 0)
    }
}

fn row_to_config(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<McpServerConfig, String>> {
    let transport_raw: String = row.get(2)?;
    let args_json: String = row.get(4)?;
    let env_json: String = row.get(5)?;
    let headers_json: String = row.get(7)?;
    Ok((|| {
        Ok(McpServerConfig {
            id: row.get(0).map_err(stringify)?,
            name: row.get(1).map_err(stringify)?,
            transport: McpTransport::parse(&transport_raw)?,
            command: row.get(3).map_err(stringify)?,
            args: serde_json::from_str(&args_json).map_err(stringify)?,
            env: serde_json::from_str(&env_json).map_err(stringify)?,
            url: row.get(6).map_err(stringify)?,
            headers: serde_json::from_str::<BTreeMap<String, String>>(&headers_json)
                .map_err(stringify)?,
            enabled: row.get(8).map_err(stringify)?,
            auto_allow_tools: row.get(9).map_err(stringify)?,
            created_at: row.get(10).map_err(stringify)?,
            updated_at: row.get(11).map_err(stringify)?,
        })
    })())
}

fn stringify<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn rename_collision(error: rusqlite::Error) -> String {
    if let rusqlite::Error::SqliteFailure(failure, _) = &error {
        if failure.code == rusqlite::ErrorCode::ConstraintViolation {
            return "An MCP server with that name already exists".to_string();
        }
    }
    error.to_string()
}

fn generated_id() -> String {
    let counter = MCP_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("mcp-{timestamp:x}-{counter:x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, process};

    fn test_database(name: &str) -> Database {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = env::temp_dir().join(format!(
            "bioeng-data-mcp-{name}-{}-{timestamp}.sqlite3",
            process::id()
        ));
        let _ = fs::remove_file(&path);
        Database::open(path).expect("test database should open")
    }

    fn stdio_input(name: &str) -> McpServerInput {
        McpServerInput {
            id: None,
            name: name.to_string(),
            transport: McpTransport::Stdio,
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "server-everything".to_string()],
            env: BTreeMap::new(),
            url: String::new(),
            headers: BTreeMap::new(),
            enabled: true,
            auto_allow_tools: false,
        }
    }

    #[test]
    fn mcp_server_crud_roundtrip() {
        let database = test_database("crud");
        let saved = database
            .save_mcp_server(stdio_input("arxiv"))
            .expect("save should succeed");
        assert_eq!(saved.transport, McpTransport::Stdio);
        assert_eq!(saved.args.len(), 2);

        let listed = database.list_mcp_servers().expect("list should succeed");
        assert_eq!(listed.len(), 1);

        let toggled = database
            .set_mcp_server_enabled(&saved.id, false)
            .expect("toggle should succeed")
            .expect("server should exist");
        assert!(!toggled.enabled);

        let mut update = stdio_input("arxiv");
        update.id = Some(saved.id.clone());
        update.command = "uvx".to_string();
        let updated = database
            .save_mcp_server(update)
            .expect("update should succeed");
        assert_eq!(updated.command, "uvx");
        assert_eq!(updated.id, saved.id);

        assert!(database.delete_mcp_server(&saved.id).expect("delete"));
        assert!(database.list_mcp_servers().expect("list").is_empty());
    }

    #[test]
    fn duplicate_names_are_rejected() {
        let database = test_database("dupe");
        database
            .save_mcp_server(stdio_input("dup"))
            .expect("first save should succeed");
        let error = database
            .save_mcp_server(stdio_input("dup"))
            .expect_err("duplicate name should fail");
        assert!(error.contains("already exists"));
    }

    #[test]
    fn validates_required_fields() {
        let database = test_database("validate");
        let mut missing_command = stdio_input("x");
        missing_command.command = String::new();
        assert!(database.save_mcp_server(missing_command).is_err());
    }
}
