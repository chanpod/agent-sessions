use std::sync::Arc;
use serde::Serialize;
use tauri::State;

use crate::event_batcher::EventBatcher;
use crate::pty_manager::{CreateTerminalOptions, PtyManager, TerminalInfo};
use crate::session_state::SessionManager;
use crate::session_state::AgentMessage;

// -- State type aliases for Tauri managed state --
pub type PtyManagerState = Arc<PtyManager>;
pub type SessionManagerState = Arc<SessionManager>;
pub type EventBatcherState = Arc<EventBatcher>;

// ---------------------------------------------------------------------------
// Terminal / PTY commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_terminal(
    pty_manager: State<'_, PtyManagerState>,
    cwd: Option<String>,
    shell: Option<String>,
    hidden: Option<bool>,
    initial_command: Option<String>,
    title: Option<String>,
) -> Result<TerminalInfo, String> {
    pty_manager.create_terminal(CreateTerminalOptions {
        cwd,
        shell,
        hidden: hidden.unwrap_or(false),
        initial_command,
        title,
        ..Default::default()
    })
}

#[tauri::command]
pub fn write_terminal(
    pty_manager: State<'_, PtyManagerState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    pty_manager.write(&terminal_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_terminal(
    pty_manager: State<'_, PtyManagerState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_manager.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn kill_terminal(
    pty_manager: State<'_, PtyManagerState>,
    terminal_id: String,
) -> Result<(), String> {
    pty_manager.kill(&terminal_id)
}

#[tauri::command]
pub fn list_terminals(
    pty_manager: State<'_, PtyManagerState>,
) -> Result<Vec<TerminalInfo>, String> {
    Ok(pty_manager.list())
}

// ---------------------------------------------------------------------------
// Agent commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn spawn_agent(
    pty_manager: State<'_, PtyManagerState>,
    project_path: String,
    model: String,
    _system_prompt: Option<String>,
    session_id: Option<String>,
    context: Option<String>,
) -> Result<TerminalInfo, String> {
    // Build the claude CLI command
    let mut cmd_parts = vec![
        "cat".to_string(),
        "|".to_string(),
        "claude".to_string(),
        "-p".to_string(),
        "--verbose".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--model".to_string(),
        model.clone(),
    ];

    if let Some(ref sid) = session_id {
        cmd_parts.push("--resume".to_string());
        cmd_parts.push(sid.clone());
    }

    if let Some(ref ctx) = context {
        if !ctx.is_empty() {
            cmd_parts.push("--append-system-prompt".to_string());
            // Quote the context string for shell safety
            cmd_parts.push(format!("\"{}\"", ctx.replace('"', "\\\"")));
        }
    }

    let command = cmd_parts.join(" ");
    log::info!("[spawn_agent] command: {}", command);
    log::info!("[spawn_agent] cwd: {} model: {} session_id: {:?}", project_path, model, session_id);

    pty_manager.create_terminal(CreateTerminalOptions {
        cwd: Some(project_path),
        shell: None,
        hidden: true,
        initial_command: Some(command),
        title: Some("Claude Agent".to_string()),
        ..Default::default()
    })
}

#[tauri::command]
pub async fn send_agent_message(
    pty_manager: State<'_, PtyManagerState>,
    terminal_id: String,
    message: String,
    session_id: String,
) -> Result<(), String> {
    log::info!(
        "[send_agent_message] terminal={} message_len={} session_id='{}'",
        &terminal_id[..8.min(terminal_id.len())],
        message.len(),
        session_id
    );

    // Build stream-json formatted message
    let payload = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": message
        },
        "session_id": session_id
    });

    let mut data = serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize message: {e}"))?;
    data.push('\n');

    log::debug!("[send_agent_message] writing {} bytes to PTY", data.len());

    // Use chunked write for large messages to avoid overwhelming the PTY buffer
    pty_manager
        .write_chunked(&terminal_id, data.as_bytes(), 4096)
        .await
}

#[tauri::command]
pub fn kill_agent(
    pty_manager: State<'_, PtyManagerState>,
    terminal_id: String,
) -> Result<(), String> {
    pty_manager.kill(&terminal_id)
}

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_terminal_state(
    session_manager: State<'_, SessionManagerState>,
    terminal_id: String,
) -> Result<serde_json::Value, String> {
    session_manager
        .get_terminal_state(&terminal_id)
        .map(|state| serde_json::to_value(state).unwrap_or(serde_json::Value::Null))
        .ok_or_else(|| format!("No state found for terminal {terminal_id}"))
}

#[tauri::command]
pub fn get_session_messages(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<Vec<AgentMessage>, String> {
    Ok(session_manager.get_session_messages(&session_id))
}

#[tauri::command]
pub fn get_context_usage(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<Option<crate::stream_parser::TokenUsage>, String> {
    Ok(session_manager.get_context_usage(&session_id))
}

// ---------------------------------------------------------------------------
// System commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_default_shell() -> Result<String, String> {
    #[cfg(unix)]
    {
        std::env::var("SHELL").or_else(|_| Ok("/bin/bash".to_string()))
    }

    #[cfg(windows)]
    {
        Ok(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub platform: String,
    pub arch: String,
    pub hostname: String,
}

#[tauri::command]
pub fn get_system_info() -> Result<SystemInfo, String> {
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
    .to_string();

    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        std::env::consts::ARCH
    }
    .to_string();

    let hostname = {
        #[cfg(unix)]
        {
            nix::unistd::gethostname()
                .map(|h| h.to_string_lossy().into_owned())
                .unwrap_or_else(|_| "unknown".to_string())
        }
        #[cfg(not(unix))]
        {
            std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
        }
    };

    Ok(SystemInfo {
        platform,
        arch,
        hostname,
    })
}
