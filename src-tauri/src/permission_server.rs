use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::State as AxumState;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::permission_manager::{
    PermissionDecision, PermissionManager, PermissionRequest,
    PermissionResponse, PermissionSource, DEFAULT_TIMEOUT_SECS,
};

// =============================================================================
// Server State
// =============================================================================

/// Shared state accessible from axum route handlers.
struct ServerState {
    auth_token: String,
    permission_manager: Arc<PermissionManager>,
    app_handle: AppHandle,
}

/// Public state exposed via Tauri managed state.
pub struct PermissionServerState {
    pub port: u16,
    pub auth_token: String,
    pub permission_manager: Arc<PermissionManager>,
}

// =============================================================================
// Request/Response types for Claude CLI hooks
// =============================================================================

/// Claude CLI PreToolUse hook sends this as POST body.
#[derive(Debug, Deserialize)]
struct ClaudeHookRequest {
    session_id: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    hook_event_name: Option<String>,
    tool_name: Option<String>,
    tool_input: Option<serde_json::Value>,
    #[serde(default)]
    #[allow(dead_code)]
    tool_use_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
}

/// Response format expected by Claude CLI HTTP hooks.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeHookResponse {
    hook_specific_output: ClaudeHookOutput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeHookOutput {
    hook_event_name: String,
    permission_decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission_decision_reason: Option<String>,
}

// =============================================================================
// Server Status
// =============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionServerStatus {
    pub running: bool,
    pub port: u16,
    pub hooks_url: String,
}

// =============================================================================
// Server Implementation
// =============================================================================

/// Start the permission HTTP server. Returns the bound port and auth token.
pub async fn start_server(
    app_handle: AppHandle,
    permission_manager: Arc<PermissionManager>,
) -> Result<(u16, String), String> {
    // Generate random auth token
    let auth_token = generate_auth_token();

    let state = Arc::new(ServerState {
        auth_token: auth_token.clone(),
        permission_manager,
        app_handle,
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/permission", post(claude_permission_handler))
        .with_state(state);

    // Bind to random port on localhost
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind permission server: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();

    log::info!(
        "[permission_server] Starting on http://127.0.0.1:{}",
        port
    );

    // Spawn the server task
    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("[permission_server] Server error: {}", e);
        }
    });

    // Write server info to disk so hooks can discover us
    write_server_info(port, &auth_token);

    Ok((port, auth_token))
}

// =============================================================================
// Route Handlers
// =============================================================================

async fn health_handler() -> &'static str {
    "ok"
}

/// Handle Claude CLI PreToolUse HTTP hook requests.
async fn claude_permission_handler(
    AxumState(state): AxumState<Arc<ServerState>>,
    headers: HeaderMap,
    Json(body): Json<ClaudeHookRequest>,
) -> impl IntoResponse {
    // Validate auth token
    if !validate_auth(&headers, &state.auth_token) {
        log::warn!(
            "[permission_server] Unauthorized request — auth token mismatch. \
             Expected token starting with '{}...', check ~/.claude/settings.json hook config.",
            &state.auth_token[..state.auth_token.len().min(8)]
        );
        return (
            StatusCode::UNAUTHORIZED,
            Json(make_claude_response("deny", Some("Auth failed — token mismatch. Restart ToolChain or reinstall hooks."))),
        );
    }

    let tool_name = body.tool_name.unwrap_or_default();
    let tool_input = body.tool_input.unwrap_or(serde_json::Value::Object(Default::default()));
    let session_id = body.session_id.unwrap_or_default();
    let project_path = body.cwd.clone();

    log::info!(
        "[permission_server] Claude hook: tool={} session={}",
        tool_name,
        &session_id[..session_id.len().min(8)]
    );

    // Check auto-allow rules first
    if let Some(response) = state.permission_manager.evaluate_auto_allow(
        &tool_name,
        &tool_input,
        project_path.as_deref(),
    ) {
        log::debug!("[permission_server] Auto-allowed: {}", tool_name);
        let decision_str = match response.decision {
            PermissionDecision::Allow => "allow",
            PermissionDecision::Deny => "deny",
        };
        return (
            StatusCode::OK,
            Json(make_claude_response(decision_str, response.reason.as_deref())),
        );
    }

    // Need user approval — create pending request
    let request_id = uuid::Uuid::new_v4().to_string();
    let (response_tx, response_rx) = oneshot::channel::<PermissionResponse>();

    let request = PermissionRequest {
        id: request_id.clone(),
        session_id: session_id.clone(),
        tool_name: tool_name.clone(),
        tool_input: tool_input.clone(),
        project_path: project_path.clone(),
        source: PermissionSource::Claude,
    };

    // Build UI payload
    let ui_request = state.permission_manager.build_ui_request(&request);

    // Store pending
    state.permission_manager.add_pending(request, response_tx);

    // Emit to frontend
    if let Err(e) = state.app_handle.emit("permission:request", &ui_request) {
        log::error!("[permission_server] Failed to emit permission request: {}", e);
    }

    // Wait for response with timeout
    let timeout = tokio::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS);
    match tokio::time::timeout(timeout, response_rx).await {
        Ok(Ok(response)) => {
            let decision_str = match response.decision {
                PermissionDecision::Allow => "allow",
                PermissionDecision::Deny => "deny",
            };
            log::info!(
                "[permission_server] User decided: {} for {}",
                decision_str,
                tool_name
            );
            (
                StatusCode::OK,
                Json(make_claude_response(decision_str, response.reason.as_deref())),
            )
        }
        Ok(Err(_)) => {
            // Channel closed (request was removed)
            log::warn!("[permission_server] Permission channel closed for {}", tool_name);
            state.permission_manager.remove_expired(&request_id);
            (
                StatusCode::OK,
                Json(make_claude_response("deny", Some("Request cancelled"))),
            )
        }
        Err(_) => {
            // Timeout
            log::warn!(
                "[permission_server] Permission timeout for {} ({}s)",
                tool_name,
                DEFAULT_TIMEOUT_SECS
            );
            state.permission_manager.remove_expired(&request_id);
            // Emit timeout event to frontend
            let _ = state.app_handle.emit("permission:expired", &request_id);
            (
                StatusCode::OK,
                Json(make_claude_response("deny", Some("Permission request timed out"))),
            )
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

fn validate_auth(headers: &HeaderMap, expected_token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.strip_prefix("Bearer ")
                .map_or(false, |token| token == expected_token)
        })
        .unwrap_or(false)
}

fn make_claude_response(decision: &str, reason: Option<&str>) -> ClaudeHookResponse {
    ClaudeHookResponse {
        hook_specific_output: ClaudeHookOutput {
            hook_event_name: "PreToolUse".to_string(),
            permission_decision: decision.to_string(),
            permission_decision_reason: reason.map(String::from),
        },
    }
}

fn generate_auth_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Use timestamp + process id + random-ish data for uniqueness
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    format!("{:032x}{:08x}", ts, pid)
}

/// Write server info to ~/.toolchain/server.json for hook discovery.
fn write_server_info(port: u16, auth_token: &str) {
    let Some(dir) = dirs::data_dir().map(|d| d.join("toolchain")) else {
        log::error!("[permission_server] Cannot determine data directory");
        return;
    };

    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::error!("[permission_server] Failed to create dir: {}", e);
        return;
    }

    let info = serde_json::json!({
        "port": port,
        "auth_token": auth_token,
        "pid": std::process::id(),
    });

    let file = dir.join("server.json");
    match serde_json::to_string_pretty(&info) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&file, json) {
                log::error!("[permission_server] Failed to write server.json: {}", e);
            } else {
                log::info!("[permission_server] Wrote server info to {:?}", file);
            }
        }
        Err(e) => log::error!("[permission_server] Failed to serialize server info: {}", e),
    }
}

/// Remove server.json on shutdown.
pub fn cleanup_server_info() {
    if let Some(file) = dirs::data_dir().map(|d| d.join("toolchain").join("server.json")) {
        let _ = std::fs::remove_file(file);
    }
}
