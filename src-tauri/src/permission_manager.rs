use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::LazyLock;
use tokio::sync::oneshot;

// =============================================================================
// Constants
// =============================================================================

/// Tools that are always safe to execute without user approval.
static SAFE_TOOLS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        "Read",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Task",
        "TodoWrite",
        "EnterPlanMode",
        "ExitPlanMode",
        "Skill",
        "AskUserQuestion",
    ])
});

const SHELL_OPERATORS: &[&str] = &["&&", "||", "|", ";"];

/// Default timeout for pending permission requests (seconds).
pub const DEFAULT_TIMEOUT_SECS: u64 = 120;

// =============================================================================
// Types
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionSource {
    Claude,
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: String,
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub project_path: Option<String>,
    pub source: PermissionSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionResponse {
    pub decision: PermissionDecision,
    pub reason: Option<String>,
}

/// What the frontend receives via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequestForUI {
    pub id: String,
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub received_at: u64,
    pub sub_command_matches: Option<Vec<SubCommandMatch>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubCommandMatch {
    pub tokens: Vec<String>,
    pub operator: Option<String>,
    pub matched: bool,
}

/// User-configurable permission rules for a project.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistConfig {
    pub tools: Vec<String>,
    pub bash_rules: Vec<Vec<String>>,
}

/// Tracks a pending permission request awaiting user response.
pub struct PendingPermission {
    pub request: PermissionRequest,
    pub response_tx: oneshot::Sender<PermissionResponse>,
    pub received_at: u64,
}

// =============================================================================
// Permission Manager
// =============================================================================

pub struct PermissionManager {
    /// project_path -> cached AllowlistConfig
    configs: DashMap<String, AllowlistConfig>,
    /// request_id -> pending permission awaiting user response
    pending: DashMap<String, PendingPermission>,
}

impl PermissionManager {
    pub fn new() -> Self {
        Self {
            configs: DashMap::new(),
            pending: DashMap::new(),
        }
    }

    // =========================================================================
    // Auto-Allow Evaluation
    // =========================================================================

    /// Check if a tool call should be auto-allowed based on safe tools and rules.
    /// Returns `Some(Allow)` if auto-allowed, `None` if user approval needed.
    pub fn evaluate_auto_allow(
        &self,
        tool_name: &str,
        tool_input: &serde_json::Value,
        project_path: Option<&str>,
    ) -> Option<PermissionResponse> {
        // Gate 1: hardcoded safe tools
        if SAFE_TOOLS.contains(tool_name) {
            return Some(PermissionResponse {
                decision: PermissionDecision::Allow,
                reason: Some("Safe tool (auto-allowed)".into()),
            });
        }

        // Load config for this project
        let config = project_path.and_then(|p| self.get_config(p));
        let config = config.as_ref();

        // Gate 2: Bash command rules
        if tool_name == "Bash" {
            if let Some(command) = tool_input.get("command").and_then(|v| v.as_str()) {
                if let Some(config) = config {
                    if matches_bash_command(command, &config.bash_rules) {
                        return Some(PermissionResponse {
                            decision: PermissionDecision::Allow,
                            reason: Some("Bash rule match (auto-allowed)".into()),
                        });
                    }
                }
            }
        }

        // Gate 3: blanket tool allowlist
        if let Some(config) = config {
            if config.tools.iter().any(|t| t == tool_name) {
                return Some(PermissionResponse {
                    decision: PermissionDecision::Allow,
                    reason: Some(format!("{} is in allowlist (auto-allowed)", tool_name)),
                });
            }
        }

        None
    }

    /// Build the UI payload for a permission request, including sub-command
    /// match info for Bash commands.
    pub fn build_ui_request(
        &self,
        request: &PermissionRequest,
    ) -> PermissionRequestForUI {
        let sub_command_matches = if request.tool_name == "Bash" {
            request
                .tool_input
                .get("command")
                .and_then(|v| v.as_str())
                .map(|cmd| {
                    let config = request
                        .project_path
                        .as_deref()
                        .and_then(|p| self.get_config(p));
                    let bash_rules = config
                        .as_ref()
                        .map(|c| c.bash_rules.as_slice())
                        .unwrap_or(&[]);
                    build_sub_command_matches(cmd, bash_rules)
                })
        } else {
            None
        };

        PermissionRequestForUI {
            id: request.id.clone(),
            session_id: request.session_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input: request.tool_input.clone(),
            received_at: now_millis(),
            sub_command_matches,
        }
    }

    // =========================================================================
    // Pending Request Management
    // =========================================================================

    /// Store a pending permission request. Returns the oneshot Receiver to await.
    pub fn add_pending(
        &self,
        request: PermissionRequest,
        response_tx: oneshot::Sender<PermissionResponse>,
    ) {
        let id = request.id.clone();
        self.pending.insert(
            id,
            PendingPermission {
                request,
                response_tx,
                received_at: now_millis(),
            },
        );
    }

    /// Resolve a pending permission request with the user's decision.
    pub fn resolve_pending(&self, id: &str, response: PermissionResponse) -> Result<(), String> {
        match self.pending.remove(id) {
            Some((_, pending)) => {
                let _ = pending.response_tx.send(response);
                Ok(())
            }
            None => Err(format!("No pending permission with id '{}'", id)),
        }
    }

    /// Remove an expired pending request without sending a response.
    pub fn remove_expired(&self, id: &str) -> Option<PendingPermission> {
        self.pending.remove(id).map(|(_, v)| v)
    }

    // =========================================================================
    // Config Management
    // =========================================================================

    /// Get the allowlist config for a project.
    pub fn get_config(&self, project_path: &str) -> Option<AllowlistConfig> {
        // Check cache first
        if let Some(cached) = self.configs.get(project_path) {
            return Some(cached.clone());
        }

        // Try loading from disk
        let config = load_config_from_disk(project_path);
        if let Some(ref c) = config {
            self.configs.insert(project_path.to_string(), c.clone());
        }
        config
    }

    /// Add a tool to the blanket allowlist for a project.
    pub fn add_allowed_tool(&self, project_path: &str, tool_name: &str) -> AllowlistConfig {
        let mut config = self.get_config(project_path).unwrap_or_default();
        if !config.tools.contains(&tool_name.to_string()) {
            config.tools.push(tool_name.to_string());
        }
        self.save_config(project_path, &config);
        config
    }

    /// Remove a tool from the blanket allowlist for a project.
    pub fn remove_allowed_tool(&self, project_path: &str, tool_name: &str) -> AllowlistConfig {
        let mut config = self.get_config(project_path).unwrap_or_default();
        config.tools.retain(|t| t != tool_name);
        self.save_config(project_path, &config);
        config
    }

    /// Add a bash rule for a project.
    pub fn add_bash_rule(&self, project_path: &str, rule: Vec<String>) -> AllowlistConfig {
        let mut config = self.get_config(project_path).unwrap_or_default();
        if !config.bash_rules.contains(&rule) {
            config.bash_rules.push(rule);
        }
        self.save_config(project_path, &config);
        config
    }

    /// Remove a bash rule for a project.
    pub fn remove_bash_rule(&self, project_path: &str, rule: &[String]) -> AllowlistConfig {
        let mut config = self.get_config(project_path).unwrap_or_default();
        config.bash_rules.retain(|r| r.as_slice() != rule);
        self.save_config(project_path, &config);
        config
    }

    fn save_config(&self, project_path: &str, config: &AllowlistConfig) {
        self.configs
            .insert(project_path.to_string(), config.clone());
        save_config_to_disk(project_path, config);
    }
}

impl Default for PermissionManager {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Shell Tokenization & Rule Matching
// =============================================================================

/// Tokenize a shell command string, handling quotes and escapes.
pub fn tokenize_command(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escape = false;

    for ch in command.chars() {
        if escape {
            current.push(ch);
            escape = false;
            continue;
        }
        if ch == '\\' && !in_single {
            escape = true;
            current.push(ch);
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            current.push(ch);
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            current.push(ch);
            continue;
        }
        if !in_single && !in_double && ch.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// Split tokens into sub-commands at shell operators (&&, ||, |, ;).
pub fn split_sub_commands(tokens: &[String]) -> Vec<Vec<String>> {
    let mut subs = Vec::new();
    let mut current = Vec::new();

    for tok in tokens {
        if SHELL_OPERATORS.contains(&tok.as_str()) {
            if !current.is_empty() {
                subs.push(std::mem::take(&mut current));
            }
        } else if tok.ends_with(';') && tok.len() > 1 {
            current.push(tok[..tok.len() - 1].to_string());
            if !current.is_empty() {
                subs.push(std::mem::take(&mut current));
            }
        } else {
            current.push(tok.clone());
        }
    }
    if !current.is_empty() {
        subs.push(current);
    }
    subs
}

/// Split tokens into sub-commands, preserving the operator that precedes each.
fn split_sub_commands_with_operators(tokens: &[String]) -> Vec<(Option<String>, Vec<String>)> {
    let mut result = Vec::new();
    let mut current = Vec::new();
    let mut current_op: Option<String> = None;

    for tok in tokens {
        if SHELL_OPERATORS.contains(&tok.as_str()) {
            if !current.is_empty() {
                result.push((current_op.take(), std::mem::take(&mut current)));
            }
            current_op = Some(tok.clone());
        } else if tok.ends_with(';') && tok.len() > 1 {
            current.push(tok[..tok.len() - 1].to_string());
            if !current.is_empty() {
                result.push((current_op.take(), std::mem::take(&mut current)));
            }
            current_op = Some(";".to_string());
        } else {
            current.push(tok.clone());
        }
    }
    if !current.is_empty() {
        result.push((current_op, current));
    }
    result
}

/// Check if a single sub-command matches any bash rule.
fn matches_single_rule(tokens: &[String], bash_rules: &[Vec<String>]) -> bool {
    for rule in bash_rules {
        if rule.is_empty() {
            continue;
        }
        let is_wildcard = rule.last().map_or(false, |t| t == "*");
        if is_wildcard {
            let prefix_len = rule.len() - 1;
            if tokens.len() >= prefix_len
                && rule[..prefix_len]
                    .iter()
                    .zip(tokens.iter())
                    .all(|(r, t)| r == t)
            {
                return true;
            }
        } else if rule.len() == tokens.len() && rule.iter().zip(tokens.iter()).all(|(r, t)| r == t)
        {
            return true;
        }
    }
    false
}

/// Check if a full command (potentially compound) matches bash rules.
/// All sub-commands must match for the command to be auto-allowed.
pub fn matches_bash_command(command: &str, bash_rules: &[Vec<String>]) -> bool {
    if bash_rules.is_empty() {
        return false;
    }
    let tokens = tokenize_command(command.trim());
    let subs = split_sub_commands(&tokens);
    if subs.is_empty() {
        return false;
    }
    subs.iter().all(|sub| matches_single_rule(sub, bash_rules))
}

/// Build sub-command match info for the frontend UI.
fn build_sub_command_matches(command: &str, bash_rules: &[Vec<String>]) -> Vec<SubCommandMatch> {
    let tokens = tokenize_command(command.trim());
    let subs = split_sub_commands_with_operators(&tokens);

    subs.into_iter()
        .map(|(op, sub_tokens)| {
            let matched = matches_single_rule(&sub_tokens, bash_rules);
            SubCommandMatch {
                tokens: sub_tokens,
                operator: op,
                matched,
            }
        })
        .collect()
}

// =============================================================================
// Config Persistence
// =============================================================================

/// Get the directory for storing permission configs.
fn config_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("toolchain").join("permissions"))
}

/// Hash a project path to a filename-safe key.
fn project_key(project_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    project_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn load_config_from_disk(project_path: &str) -> Option<AllowlistConfig> {
    let dir = config_dir()?;
    let file = dir.join(format!("{}.json", project_key(project_path)));

    if file.exists() {
        let data = std::fs::read_to_string(&file).ok()?;
        serde_json::from_str(&data).ok()
    } else {
        // Try legacy path for migration
        let legacy = PathBuf::from(project_path)
            .join(".claude")
            .join("permission-allowlist.json");
        if legacy.exists() {
            let data = std::fs::read_to_string(&legacy).ok()?;
            let config: AllowlistConfig = serde_json::from_str(&data).ok()?;
            // Migrate: save to new location
            save_config_to_disk(project_path, &config);
            Some(config)
        } else {
            None
        }
    }
}

fn save_config_to_disk(project_path: &str, config: &AllowlistConfig) {
    let Some(dir) = config_dir() else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        log::error!("[permissions] Failed to create config dir: {:?}", dir);
        return;
    }

    let file = dir.join(format!("{}.json", project_key(project_path)));
    match serde_json::to_string_pretty(config) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&file, json) {
                log::error!("[permissions] Failed to write config: {}", e);
            }
        }
        Err(e) => log::error!("[permissions] Failed to serialize config: {}", e),
    }
}

// =============================================================================
// Helpers
// =============================================================================

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize_simple() {
        assert_eq!(tokenize_command("ls -la"), vec!["ls", "-la"]);
    }

    #[test]
    fn test_tokenize_quoted() {
        assert_eq!(
            tokenize_command("echo 'hello world'"),
            vec!["echo", "'hello world'"]
        );
        assert_eq!(
            tokenize_command(r#"echo "hello world""#),
            vec!["echo", r#""hello world""#]
        );
    }

    #[test]
    fn test_tokenize_escape() {
        assert_eq!(
            tokenize_command(r"echo hello\ world"),
            vec!["echo", r"hello\ world"]
        );
    }

    #[test]
    fn test_split_sub_commands() {
        let tokens = tokenize_command("git add . && git commit -m 'test'");
        let subs = split_sub_commands(&tokens);
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0], vec!["git", "add", "."]);
        assert_eq!(subs[1], vec!["git", "commit", "-m", "'test'"]);
    }

    #[test]
    fn test_split_pipe() {
        let tokens = tokenize_command("cat file.txt | grep pattern");
        let subs = split_sub_commands(&tokens);
        assert_eq!(subs.len(), 2);
    }

    #[test]
    fn test_matches_exact_rule() {
        let rules = vec![vec!["git".into(), "status".into()]];
        assert!(matches_bash_command("git status", &rules));
        assert!(!matches_bash_command("git push", &rules));
    }

    #[test]
    fn test_matches_wildcard_rule() {
        let rules = vec![vec!["npm".into(), "test".into(), "*".into()]];
        assert!(matches_bash_command("npm test", &rules));
        assert!(matches_bash_command("npm test --verbose", &rules));
        assert!(!matches_bash_command("npm install", &rules));
    }

    #[test]
    fn test_matches_compound_command() {
        let rules = vec![
            vec!["git".into(), "add".into(), "*".into()],
            vec!["git".into(), "status".into()],
        ];
        assert!(matches_bash_command("git add . && git status", &rules));
        assert!(!matches_bash_command("git add . && git push", &rules));
    }

    #[test]
    fn test_safe_tools() {
        let mgr = PermissionManager::new();
        assert!(mgr
            .evaluate_auto_allow("Read", &serde_json::json!({}), None)
            .is_some());
        assert!(mgr
            .evaluate_auto_allow("Glob", &serde_json::json!({}), None)
            .is_some());
        assert!(mgr
            .evaluate_auto_allow("Bash", &serde_json::json!({}), None)
            .is_none());
        assert!(mgr
            .evaluate_auto_allow("Edit", &serde_json::json!({}), None)
            .is_none());
    }

    #[test]
    fn test_sub_command_matches() {
        let rules = vec![vec!["git".into(), "status".into()]];
        let matches = build_sub_command_matches("git add . && git status", &rules);
        assert_eq!(matches.len(), 2);
        assert!(!matches[0].matched);
        assert!(matches[0].operator.is_none());
        assert!(matches[1].matched);
        assert_eq!(matches[1].operator.as_deref(), Some("&&"));
    }
}
