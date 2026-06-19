mod agent;
mod ai;
mod backup;
mod inspector;
mod mcp;
mod python;
mod secrets;
mod settings;
mod skills;
mod workspace;

use bioeng_data::Database;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(agent::AgentState::default())
        .manage(agent::MemoryDeriverState::default())
        .manage(mcp::McpRegistry::default())
        .manage(backup::commands::BackupTaskState::default())
        .manage(secrets::KeychainSecretStore::default())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(std::io::Error::other)?;
            let app_cache_backup_dir = app
                .path()
                .app_cache_dir()
                .map_err(std::io::Error::other)?
                .join("backup");
            backup::apply_pending_restore(&app_cache_backup_dir, &app_data_dir)
                .map_err(std::io::Error::other)?;
            let database_path = app_data_dir.join("bioeng.sqlite3");
            let legacy_settings_path = app_data_dir.join("settings.sqlite3");
            let database =
                Database::open_with_legacy_settings(database_path, &legacy_settings_path)
                    .map_err(std::io::Error::other)?;

            app.manage(database);
            let resource_dir = app.path().resource_dir().ok();
            app.manage(python::PythonState::new(resource_dir));
            backup::start_backup_scheduler(app.handle().clone());
            mcp::spawn_initial_connect(app.handle().clone());

            // A custom-scheme open hands the browser back to us: bring the
            // window forward.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |_event| {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let _ = backup::commands::run_close_backup_if_due(window.app_handle());
                let registry = window.app_handle().state::<mcp::McpRegistry>();
                tauri::async_runtime::block_on(registry.shutdown_all());
            }
        })
        .invoke_handler(tauri::generate_handler![
            backup::commands::backup_key_status,
            backup::commands::backup_recovery_key_export,
            backup::commands::backup_local_create,
            backup::commands::backup_local_list,
            backup::commands::backup_local_restore_plan,
            backup::commands::backup_local_restore_execute,
            backup::commands::backup_task_status,
            backup::commands::backup_activity_list,
            ai::commands::ai_conversation_context_set,
            ai::commands::ai_conversation_create,
            ai::commands::ai_conversation_delete,
            ai::commands::ai_conversation_get,
            ai::commands::ai_conversation_title_generate,
            ai::commands::ai_conversation_title_update,
            ai::commands::ai_conversations_list,
            ai::commands::ai_memory_delete,
            ai::commands::ai_memory_list,
            ai::commands::ai_memory_set_status,
            ai::commands::ai_memory_update,
            agent::commands::agent_interrupt,
            inspector::commands::database_inspector_cell_update,
            inspector::commands::database_inspector_overview,
            inspector::commands::database_inspector_query,
            inspector::commands::database_inspector_rows_delete,
            inspector::commands::database_inspector_table_rows,
            inspector::commands::database_inspector_table_schema,
            agent::commands::agent_respond_permission,
            agent::commands::agent_send,
            secrets::commands::secret_status,
            secrets::commands::secret_delete,
            secrets::commands::ai_provider_key_save,
            secrets::commands::ai_provider_key_status,
            secrets::commands::ai_provider_key_statuses,
            secrets::commands::ai_provider_key_validate,
            secrets::commands::ai_provider_key_delete,
            settings::commands::settings_get,
            settings::commands::settings_list_monospace_fonts,
            settings::commands::settings_save,
            skills::commands::skill_delete,
            skills::commands::skill_read,
            skills::commands::skill_write,
            skills::commands::skills_list,
            mcp::commands::mcp_server_delete,
            mcp::commands::mcp_server_reconnect,
            mcp::commands::mcp_server_save,
            mcp::commands::mcp_server_toggle,
            mcp::commands::mcp_servers_list,
            python::commands::python_run_script,
            python::commands::python_runtime_status,
            python::commands::python_env_status,
            python::commands::python_env_create,
            python::commands::python_packages_list,
            python::commands::python_packages_install,
            python::commands::python_packages_uninstall,
            python::commands::python_lsp_document_open,
            python::commands::python_lsp_document_change,
            python::commands::python_lsp_document_close,
            python::commands::python_lsp_hover,
            python::commands::python_lsp_completions,
            python::commands::python_lsp_definition,
            python::commands::python_lsp_references,
            python::commands::python_lsp_document_symbols,
            python::commands::python_lsp_diagnostics,
            workspace::history::workspace_history_status,
            workspace::history::workspace_history_init_repo,
            workspace::history::workspace_history_checkpoint,
            workspace::history::workspace_history_checkpoint_selective,
            workspace::history::workspace_history_list,
            workspace::history::workspace_history_changes,
            workspace::history::workspace_history_working_changes,
            workspace::history::workspace_history_working_file_diff,
            workspace::history::workspace_history_file_diff,
            workspace::history::workspace_history_file_at,
            workspace::history::workspace_history_restore_file,
            workspace::history::workspace_history_restore_workspace,
            workspace::history::workspace_history_discard_working_changes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
