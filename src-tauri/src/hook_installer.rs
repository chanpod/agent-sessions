use std::path::PathBuf;

// =============================================================================
// Hook Status
// =============================================================================

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub claude: bool,
    pub gemini: bool,
}

// =============================================================================
// Claude CLI Hook Installation
// =============================================================================

/// Install or update the ToolChain permission hook in ~/.claude/settings.json.
/// Uses Claude's native HTTP hook type — no external script needed.
pub fn install_claude_hook(port: u16, auth_token: &str) -> Result<(), String> {
    let settings_path = claude_settings_path()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let mut settings = read_json_file(&settings_path).unwrap_or_else(|| serde_json::json!({}));
    let obj = settings
        .as_object_mut()
        .ok_or("Claude settings is not a JSON object")?;

    // Build our hook entry
    let hook_entry = serde_json::json!({
        "hooks": [{
            "type": "http",
            "url": format!("http://127.0.0.1:{}/permission", port),
            "timeout": 120,
            "headers": {
                "Authorization": format!("Bearer {}", auth_token)
            }
        }],
        "matcher": ".*"
    });

    // Get or create the hooks object
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks
        .as_object_mut()
        .ok_or("hooks field is not a JSON object")?;

    // Get or create PreToolUse array
    let pre_tool_use = hooks_obj
        .entry("PreToolUse")
        .or_insert_with(|| serde_json::json!([]));
    let pre_tool_use_arr = pre_tool_use
        .as_array_mut()
        .ok_or("PreToolUse is not an array")?;

    // Find and replace existing ToolChain hook, or append
    let mut found = false;
    for entry in pre_tool_use_arr.iter_mut() {
        if is_toolchain_claude_hook(entry) {
            *entry = hook_entry.clone();
            found = true;
            break;
        }
    }
    if !found {
        pre_tool_use_arr.push(hook_entry);
    }

    write_json_file(&settings_path, &settings)?;
    log::info!(
        "[hook_installer] Claude hook installed at {:?}",
        settings_path
    );
    Ok(())
}

/// Check if our hook is present in Claude settings.
pub fn check_claude_hook_installed() -> bool {
    let Some(path) = claude_settings_path() else {
        return false;
    };
    let Some(settings) = read_json_file(&path) else {
        return false;
    };

    settings
        .get("hooks")
        .and_then(|h| h.get("PreToolUse"))
        .and_then(|arr| arr.as_array())
        .map(|arr| arr.iter().any(is_toolchain_claude_hook))
        .unwrap_or(false)
}

/// Remove our hook from Claude settings.
pub fn uninstall_claude_hook() -> Result<(), String> {
    let settings_path = claude_settings_path()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let mut settings = match read_json_file(&settings_path) {
        Some(s) => s,
        None => return Ok(()), // Nothing to uninstall
    };

    if let Some(arr) = settings
        .pointer_mut("/hooks/PreToolUse")
        .and_then(|v| v.as_array_mut())
    {
        arr.retain(|entry| !is_toolchain_claude_hook(entry));
    }

    write_json_file(&settings_path, &settings)?;
    log::info!("[hook_installer] Claude hook uninstalled");
    Ok(())
}

/// Check if a hook entry is ours by looking for the /permission URL pattern.
fn is_toolchain_claude_hook(entry: &serde_json::Value) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|hooks| {
            hooks.iter().any(|hook| {
                hook.get("type")
                    .and_then(|t| t.as_str())
                    .map_or(false, |t| t == "http")
                    && hook
                        .get("url")
                        .and_then(|u| u.as_str())
                        .map_or(false, |u| {
                            u.starts_with("http://127.0.0.1:") && u.ends_with("/permission")
                        })
            })
        })
        .unwrap_or(false)
}

// =============================================================================
// Gemini CLI Hook Installation (documented, not yet implemented)
// =============================================================================

/// Install Gemini CLI hook. Placeholder for future implementation.
pub fn install_gemini_hook(_port: u16, _auth_token: &str) -> Result<(), String> {
    // Gemini uses command hooks: the hook config would be:
    // {
    //   "hooks": {
    //     "BeforeTool": [{
    //       "matcher": ".*",
    //       "hooks": [{
    //         "type": "command",
    //         "command": "curl -sf -X POST -H 'Authorization: Bearer <TOKEN>' \
    //                    -H 'Content-Type: application/json' -d @- \
    //                    http://127.0.0.1:<PORT>/gemini/permission",
    //         "timeout": 120000
    //       }]
    //     }]
    //   }
    // }
    //
    // Response format for Gemini:
    //   - Exit code 0 = allow (stdout parsed as JSON)
    //   - Exit code 2 = deny (stderr = reason sent to agent)
    //
    // Settings file: ~/.gemini/settings.json
    log::info!("[hook_installer] Gemini hook installation not yet implemented");
    Ok(())
}

/// Check if Gemini hook is installed.
pub fn check_gemini_hook_installed() -> bool {
    // TODO: implement when Gemini support is added
    false
}

/// Remove Gemini hook.
pub fn uninstall_gemini_hook() -> Result<(), String> {
    // TODO: implement when Gemini support is added
    Ok(())
}

// =============================================================================
// Legacy Cleanup
// =============================================================================

/// Remove old per-project hook files from the legacy system.
pub fn cleanup_legacy_hooks(project_path: &str) {
    let project = PathBuf::from(project_path);

    // Remove .claude/.permission-ipc/ directory
    let ipc_dir = project.join(".claude").join(".permission-ipc");
    if ipc_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&ipc_dir) {
            log::warn!(
                "[hook_installer] Failed to remove legacy IPC dir {:?}: {}",
                ipc_dir,
                e
            );
        } else {
            log::info!(
                "[hook_installer] Cleaned up legacy IPC dir: {:?}",
                ipc_dir
            );
        }
    }

    // Remove per-project hook from .claude/settings.local.json
    let local_settings = project.join(".claude").join("settings.local.json");
    if local_settings.exists() {
        if let Some(mut settings) = read_json_file(&local_settings) {
            let mut changed = false;

            // Remove hook entries that reference permission-handler
            if let Some(arr) = settings
                .pointer_mut("/hooks/PreToolUse")
                .and_then(|v| v.as_array_mut())
            {
                let before = arr.len();
                arr.retain(|entry| {
                    !entry
                        .to_string()
                        .contains("permission-handler")
                });
                if arr.len() != before {
                    changed = true;
                }
            }

            if changed {
                let _ = write_json_file(&local_settings, &settings);
                log::info!(
                    "[hook_installer] Cleaned legacy hook from {:?}",
                    local_settings
                );
            }
        }
    }

    // Remove per-project hook script
    let hook_script = project.join(".claude").join("hooks").join("permission-handler.cjs");
    if hook_script.exists() {
        let _ = std::fs::remove_file(&hook_script);
        // Try to remove the hooks directory if empty
        let hooks_dir = project.join(".claude").join("hooks");
        let _ = std::fs::remove_dir(&hooks_dir); // only succeeds if empty
    }
}

// =============================================================================
// Helpers
// =============================================================================

fn claude_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("settings.json"))
}

fn read_json_file(path: &PathBuf) -> Option<serde_json::Value> {
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_json_file(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
    }

    let json = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;

    std::fs::write(path, json).map_err(|e| format!("Failed to write {:?}: {}", path, e))
}
