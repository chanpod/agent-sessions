pub mod pty_manager;
pub mod stream_parser;
pub mod session_state;
pub mod event_batcher;
pub mod commands;
mod bridge;

use std::sync::Arc;
use tauri::Manager;

/// Initialize and run the Tauri application.
/// This is the main entry point called from both the binary and the cdylib.
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize the PTY manager and start the background process monitor
            let pty_manager = Arc::new(pty_manager::PtyManager::new());
            pty_manager.start_monitor();

            // Initialize the session state manager
            let session_manager = Arc::new(session_state::SessionManager::new());

            // Initialize the event batcher (flushes every 16ms for ~60fps updates)
            let event_batcher = Arc::new(event_batcher::EventBatcher::new(
                app_handle.clone(),
                16,
            ));

            // Wire up the PTY → parser → state → batcher pipeline
            bridge::start_event_pipeline(
                app_handle.clone(),
                pty_manager.clone(),
                session_manager.clone(),
                event_batcher.clone(),
            );

            // Register state with Tauri so commands can access it
            app.manage(pty_manager);
            app.manage(session_manager);
            app.manage(event_batcher);

            log::info!("ToolChain backend initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_terminal,
            commands::write_terminal,
            commands::resize_terminal,
            commands::kill_terminal,
            commands::list_terminals,
            commands::spawn_agent,
            commands::send_agent_message,
            commands::kill_agent,
            commands::get_terminal_state,
            commands::get_session_messages,
            commands::get_context_usage,
            commands::get_default_shell,
            commands::get_system_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ToolChain");
}
