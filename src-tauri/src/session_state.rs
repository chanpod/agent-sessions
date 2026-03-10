use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::stream_parser::{AgentEvent, TokenUsage};

// =============================================================================
// Constants
// =============================================================================

/// Maximum number of completed messages persisted per session.
const MAX_PERSISTED_MESSAGES: usize = 50;

// =============================================================================
// Core Data Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentBlockType {
    Text,
    Thinking,
    ToolUse,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageStatus {
    Streaming,
    Completed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub block_type: ContentBlockType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<String>,
    pub is_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result_is_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub model: String,
    pub blocks: Vec<ContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    pub status: MessageStatus,
    pub started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

// =============================================================================
// Terminal Agent State (runtime, per-process)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalAgentState {
    pub current_message: Option<AgentMessage>,
    pub messages: Vec<AgentMessage>,
    pub is_active: bool,
    pub is_waiting_for_response: bool,
    pub is_waiting_for_question: bool,
    pub process_exited: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for TerminalAgentState {
    fn default() -> Self {
        Self {
            current_message: None,
            messages: Vec::new(),
            is_active: false,
            is_waiting_for_response: false,
            is_waiting_for_question: false,
            process_exited: false,
            exit_code: None,
            error: None,
        }
    }
}

// =============================================================================
// Persisted Session Data
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSession {
    pub session_id: String,
    pub messages: Vec<AgentMessage>,
    pub last_active_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_context_usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost_usd: Option<f64>,
}

// =============================================================================
// Agent Events (input from stream parser)
// =============================================================================

// AgentEvent is defined in stream_parser.rs and re-used here.

// =============================================================================
// Session Manager
// =============================================================================

/// Manages all agent session state. Thread-safe via `DashMap`.
///
/// This is the Rust equivalent of the TypeScript `agent-stream-store`.
/// It processes streaming events, maintains per-terminal runtime state,
/// and handles session persistence/restoration.
pub struct SessionManager {
    /// terminal_id -> TerminalAgentState (runtime state per process)
    terminals: DashMap<String, TerminalAgentState>,
    /// terminal_id -> session_id mapping
    terminal_sessions: DashMap<String, String>,
    /// session_id -> persisted session data
    sessions: DashMap<String, PersistedSession>,
    /// session_id -> latest token usage (from result events)
    context_usage: DashMap<String, TokenUsage>,
}

impl SessionManager {
    /// Create a new empty session manager.
    pub fn new() -> Self {
        Self {
            terminals: DashMap::new(),
            terminal_sessions: DashMap::new(),
            sessions: DashMap::new(),
            context_usage: DashMap::new(),
        }
    }

    // =========================================================================
    // Event Processing
    // =========================================================================

    /// Process a single agent event for the given terminal, updating state.
    ///
    /// Returns `true` if the event caused a state change (useful for deciding
    /// whether to emit a frontend update).
    pub fn process_event(&self, terminal_id: &str, event: &AgentEvent) -> bool {
        match event {
            AgentEvent::SessionInit { session_id, model: _ } => {
                self.terminal_sessions
                    .insert(terminal_id.to_string(), session_id.clone());
                true
            }

            AgentEvent::MessageStart {
                message_id,
                model,
                usage,
            } => {
                let mut state = self.get_or_create_terminal(terminal_id);

                // Dedup: skip if this message ID already exists
                if state
                    .messages
                    .iter()
                    .any(|m| m.id == *message_id)
                    || state
                        .current_message
                        .as_ref()
                        .map_or(false, |m| m.id == *message_id)
                {
                    return false;
                }

                state.current_message = Some(AgentMessage {
                    id: message_id.clone(),
                    model: model.clone(),
                    blocks: Vec::new(),
                    usage: usage.clone(),
                    stop_reason: None,
                    status: MessageStatus::Streaming,
                    started_at: now_millis(),
                    completed_at: None,
                });
                state.is_active = true;
                state.is_waiting_for_response = false;
                state.error = None;

                self.terminals.insert(terminal_id.to_string(), state);
                true
            }

            AgentEvent::TextDelta { message_id: _, text, block_index } => {
                self.apply_delta(terminal_id, *block_index as usize, ContentBlockType::Text, text)
            }

            AgentEvent::ThinkingDelta { message_id: _, text, block_index } => {
                self.apply_delta(terminal_id, *block_index as usize, ContentBlockType::Thinking, text)
            }

            AgentEvent::ToolStart {
                message_id: _,
                tool_id,
                name,
                block_index: _,
            } => {
                let mut state = self.get_or_create_terminal(terminal_id);
                let msg = match state.current_message.as_mut() {
                    Some(m) => m,
                    None => return false,
                };

                // Dedup: skip if tool_id already exists
                if msg
                    .blocks
                    .iter()
                    .any(|b| b.tool_id.as_deref() == Some(tool_id.as_str()))
                {
                    return false;
                }

                // Set waiting-for-question flag if this is AskUserQuestion
                if name == "AskUserQuestion" {
                    state.is_waiting_for_question = true;
                }

                msg.blocks.push(ContentBlock {
                    block_type: ContentBlockType::ToolUse,
                    content: String::new(),
                    tool_id: Some(tool_id.clone()),
                    tool_name: Some(name.clone()),
                    tool_input: Some(String::new()),
                    is_complete: false,
                    tool_result_is_error: None,
                    tool_result: None,
                });

                self.terminals.insert(terminal_id.to_string(), state);
                true
            }

            AgentEvent::ToolInputDelta {
                message_id: _,
                partial_json,
                block_index,
            } => {
                let idx = *block_index as usize;
                let mut state = self.get_or_create_terminal(terminal_id);
                let msg = match state.current_message.as_mut() {
                    Some(m) => m,
                    None => return false,
                };

                if idx >= msg.blocks.len() {
                    return false;
                }

                let block = &mut msg.blocks[idx];
                match block.tool_input.as_mut() {
                    Some(input) => input.push_str(partial_json),
                    None => block.tool_input = Some(partial_json.clone()),
                }

                self.terminals.insert(terminal_id.to_string(), state);
                true
            }

            AgentEvent::ToolResult {
                tool_id,
                result,
                is_error,
            } => {
                let state = self.get_or_create_terminal(terminal_id);

                // AskUserQuestion is denied by our permission hook so the CLI
                // exits cleanly and the QuestionCard stays interactive. Skip
                // storing the error tool_result so the card remains usable —
                // the user answers via --resume.
                if *is_error && state.is_waiting_for_question {
                    let is_ask = state
                        .messages
                        .iter()
                        .rev()
                        .flat_map(|m| m.blocks.iter())
                        .chain(
                            state
                                .current_message
                                .iter()
                                .flat_map(|m| m.blocks.iter()),
                        )
                        .any(|b| {
                            b.tool_id.as_deref() == Some(tool_id.as_str())
                                && b.tool_name.as_deref() == Some("AskUserQuestion")
                        });
                    if is_ask {
                        return false;
                    }
                }

                let mut state = state;
                let mut found = false;

                // Search completed messages (most recent first)
                for msg in state.messages.iter_mut().rev() {
                    if let Some(block) = msg
                        .blocks
                        .iter_mut()
                        .find(|b| b.tool_id.as_deref() == Some(tool_id.as_str()))
                    {
                        block.tool_result = Some(result.clone());
                        block.tool_result_is_error = Some(*is_error);
                        found = true;
                        break;
                    }
                }

                // Also check current message
                if !found {
                    if let Some(msg) = state.current_message.as_mut() {
                        if let Some(block) = msg
                            .blocks
                            .iter_mut()
                            .find(|b| b.tool_id.as_deref() == Some(tool_id.as_str()))
                        {
                            block.tool_result = Some(result.clone());
                            block.tool_result_is_error = Some(*is_error);
                            found = true;
                        }
                    }
                }

                if found {
                    self.terminals.insert(terminal_id.to_string(), state);
                }
                found
            }

            AgentEvent::BlockEnd { message_id: _, block_index } => {
                let idx = *block_index as usize;
                let mut state = self.get_or_create_terminal(terminal_id);
                let msg = match state.current_message.as_mut() {
                    Some(m) => m,
                    None => return false,
                };

                if idx >= msg.blocks.len() {
                    return false;
                }

                msg.blocks[idx].is_complete = true;
                self.terminals.insert(terminal_id.to_string(), state);
                true
            }

            AgentEvent::MessageEnd { message_id: _, model: _, stop_reason, usage } => {
                let mut state = self.get_or_create_terminal(terminal_id);

                let stop = stop_reason.as_deref().unwrap_or("");
                let still_active = match stop {
                    "tool_use" => true,
                    "end_turn" => false,
                    _ => state.is_active,
                };

                if let Some(mut msg) = state.current_message.take() {
                    // Mark all blocks complete
                    for block in &mut msg.blocks {
                        block.is_complete = true;
                    }
                    msg.status = MessageStatus::Completed;
                    msg.stop_reason = stop_reason.clone();
                    msg.usage = usage.clone();
                    msg.completed_at = Some(now_millis());
                    state.messages.push(msg);
                }

                state.is_active = still_active;

                // Clear waiting-for-question on end_turn
                if !still_active && state.is_waiting_for_question {
                    state.is_waiting_for_question = false;
                }

                self.terminals.insert(terminal_id.to_string(), state);
                true
            }

            AgentEvent::SessionResult {
                subtype,
                total_cost_usd,
                duration_ms: _,
                usage,
            } => {
                if let Some(session_id) = self.terminal_sessions.get(terminal_id) {
                    if let Some(usage) = usage {
                        self.context_usage
                            .insert(session_id.clone(), usage.clone());
                    }

                    // Update persisted session cost if available
                    if let Some(cost) = *total_cost_usd {
                        if let Some(mut session) = self.sessions.get_mut(session_id.as_str()) {
                            let current = session.total_cost_usd.unwrap_or(0.0);
                            session.total_cost_usd = Some(current + cost);
                        }
                    }
                }

                // session_result with "success" or "error" is the definitive
                // "agent is done" signal. Update terminal state to match the
                // frontend's handling: clear isActive, finalize any in-flight
                // message, and resolve waiting flags.
                if subtype == "success" || subtype == "error" {
                    let mut state = self.get_or_create_terminal(terminal_id);

                    if let Some(mut msg) = state.current_message.take() {
                        for block in &mut msg.blocks {
                            block.is_complete = true;
                        }
                        msg.status = MessageStatus::Completed;
                        msg.completed_at = Some(now_millis());
                        state.messages.push(msg);
                    }

                    state.is_active = false;
                    state.is_waiting_for_response = false;

                    self.terminals.insert(terminal_id.to_string(), state);
                }

                true
            }

            AgentEvent::SystemEvent { subtype } => {
                let mut state = self.get_or_create_terminal(terminal_id);

                let system_message = AgentMessage {
                    id: format!("system-{}-{}", now_millis(), subtype),
                    model: String::new(),
                    blocks: vec![ContentBlock {
                        block_type: ContentBlockType::System,
                        content: subtype.clone(),
                        tool_id: None,
                        tool_name: None,
                        tool_input: None,
                        is_complete: true,
                        tool_result_is_error: None,
                        tool_result: None,
                    }],
                    usage: None,
                    stop_reason: None,
                    status: MessageStatus::Completed,
                    started_at: now_millis(),
                    completed_at: Some(now_millis()),
                };

                state.messages.push(system_message);
                self.terminals.insert(terminal_id.to_string(), state);
                true
            }

            AgentEvent::ProcessExit { exit_code } => {
                let mut state = self.get_or_create_terminal(terminal_id);

                // Detect early death errors
                if let Some(error) = detect_early_death_error(&state, *exit_code) {
                    state.error = Some(error);
                }

                state.process_exited = true;
                state.is_active = false;
                state.exit_code = *exit_code;

                // If there's a dangling current message, complete it as error
                if let Some(mut msg) = state.current_message.take() {
                    msg.status = MessageStatus::Error;
                    msg.completed_at = Some(now_millis());
                    state.messages.push(msg);
                }

                self.terminals.insert(terminal_id.to_string(), state);

                // Auto-persist on process exit
                self.persist_session(terminal_id);
                true
            }
        }
    }

    // =========================================================================
    // Delta Helpers
    // =========================================================================

    /// Apply a text or thinking delta to the current message's block.
    /// Creates the block if `block_index` is beyond current bounds.
    fn apply_delta(
        &self,
        terminal_id: &str,
        block_index: usize,
        block_type: ContentBlockType,
        text: &str,
    ) -> bool {
        let mut state = self.get_or_create_terminal(terminal_id);
        let msg = match state.current_message.as_mut() {
            Some(m) => m,
            None => return false,
        };

        if block_index >= msg.blocks.len() {
            // Create a new block at the expected index
            msg.blocks.push(ContentBlock {
                block_type,
                content: text.to_string(),
                tool_id: None,
                tool_name: None,
                tool_input: None,
                is_complete: false,
                tool_result_is_error: None,
                tool_result: None,
            });
        } else {
            msg.blocks[block_index].content.push_str(text);
        }

        self.terminals.insert(terminal_id.to_string(), state);
        true
    }

    // =========================================================================
    // Terminal State Management
    // =========================================================================

    /// Get or create a default terminal state.
    fn get_or_create_terminal(&self, terminal_id: &str) -> TerminalAgentState {
        self.terminals
            .get(terminal_id)
            .map(|r| r.value().clone())
            .unwrap_or_default()
    }

    /// Get a serializable snapshot of a terminal's state.
    pub fn get_terminal_state(&self, terminal_id: &str) -> Option<TerminalAgentState> {
        self.terminals.get(terminal_id).map(|r| r.value().clone())
    }

    /// Mark a terminal as waiting for a response (user sent a message).
    pub fn mark_waiting_for_response(&self, terminal_id: &str) {
        let mut state = self.get_or_create_terminal(terminal_id);
        state.is_waiting_for_response = true;
        state.error = None;
        self.terminals.insert(terminal_id.to_string(), state);
    }

    /// Clear the waiting-for-question flag.
    pub fn clear_waiting_for_question(&self, terminal_id: &str) {
        if let Some(mut state) = self.terminals.get_mut(terminal_id) {
            state.is_waiting_for_question = false;
        }
    }

    /// Clear all state for a terminal.
    pub fn clear_terminal(&self, terminal_id: &str) {
        self.terminals.remove(terminal_id);
        self.terminal_sessions.remove(terminal_id);
    }

    /// Check whether the current message is complete.
    pub fn is_message_complete(&self, terminal_id: &str) -> bool {
        self.terminals
            .get(terminal_id)
            .map(|r| {
                r.current_message
                    .as_ref()
                    .map_or(true, |m| m.status != MessageStatus::Streaming)
            })
            .unwrap_or(true)
    }

    // =========================================================================
    // Session Mapping
    // =========================================================================

    /// Store the terminal-to-session mapping.
    pub fn set_terminal_session(&self, terminal_id: &str, session_id: &str) {
        self.terminal_sessions
            .insert(terminal_id.to_string(), session_id.to_string());
    }

    /// Get the session ID for a terminal.
    pub fn get_session_id(&self, terminal_id: &str) -> Option<String> {
        self.terminal_sessions
            .get(terminal_id)
            .map(|r| r.value().clone())
    }

    // =========================================================================
    // Persistence
    // =========================================================================

    /// Persist the current session data for a terminal.
    ///
    /// Serializes up to `MAX_PERSISTED_MESSAGES` completed messages from all
    /// terminals sharing the same session ID.
    pub fn persist_session(&self, terminal_id: &str) {
        let session_id = match self.terminal_sessions.get(terminal_id) {
            Some(s) => s.value().clone(),
            None => return,
        };

        // Collect completed messages from this terminal
        let messages = match self.terminals.get(terminal_id) {
            Some(state) => {
                let mut msgs = state.messages.clone();
                // Cap at MAX_PERSISTED_MESSAGES (keep the most recent)
                if msgs.len() > MAX_PERSISTED_MESSAGES {
                    msgs = msgs.split_off(msgs.len() - MAX_PERSISTED_MESSAGES);
                }
                msgs
            }
            None => return,
        };

        let context_usage = self
            .context_usage
            .get(&session_id)
            .map(|r| r.value().clone());

        let existing_cost = self
            .sessions
            .get(&session_id)
            .and_then(|s| s.total_cost_usd);

        let persisted = PersistedSession {
            session_id: session_id.clone(),
            messages,
            last_active_at: now_millis(),
            latest_context_usage: context_usage,
            total_cost_usd: existing_cost,
        };

        self.sessions.insert(session_id, persisted);
    }

    /// Delete a persisted session by session ID.
    pub fn delete_persisted_session(&self, session_id: &str) {
        self.sessions.remove(session_id);
        self.context_usage.remove(session_id);
    }

    /// Delete multiple persisted sessions by session IDs.
    pub fn delete_persisted_sessions(&self, session_ids: &[String]) {
        for id in session_ids {
            self.delete_persisted_session(id);
        }
    }

    // =========================================================================
    // Restoration
    // =========================================================================

    /// Restore a session into a terminal from persisted data.
    ///
    /// This hydrates the terminal's message history and sets up the
    /// terminal-to-session mapping. Used on app restart.
    pub fn restore_session(
        &self,
        terminal_id: &str,
        session_id: &str,
        messages: Vec<AgentMessage>,
    ) {
        let state = TerminalAgentState {
            current_message: None,
            messages,
            is_active: false,
            is_waiting_for_response: false,
            is_waiting_for_question: false,
            process_exited: true, // restored sessions have no live process
            exit_code: None,
            error: None,
        };

        self.terminals.insert(terminal_id.to_string(), state);
        self.terminal_sessions
            .insert(terminal_id.to_string(), session_id.to_string());
    }

    // =========================================================================
    // Query Methods
    // =========================================================================

    /// Get all completed messages for a session (across all terminals).
    pub fn get_session_messages(&self, session_id: &str) -> Vec<AgentMessage> {
        // First check persisted sessions
        if let Some(session) = self.sessions.get(session_id) {
            return session.messages.clone();
        }

        // Fall back to collecting from live terminals with this session
        let mut messages = Vec::new();
        for entry in self.terminal_sessions.iter() {
            if entry.value() == session_id {
                if let Some(state) = self.terminals.get(entry.key()) {
                    messages.extend(state.messages.iter().cloned());
                }
            }
        }
        messages
    }

    /// Get the latest token usage for a session.
    pub fn get_context_usage(&self, session_id: &str) -> Option<TokenUsage> {
        self.context_usage.get(session_id).map(|r| r.value().clone())
    }

    /// Get the persisted session data for a session ID.
    pub fn get_persisted_session(&self, session_id: &str) -> Option<PersistedSession> {
        self.sessions.get(session_id).map(|r| r.value().clone())
    }

    /// Get all persisted session IDs.
    pub fn get_all_session_ids(&self) -> Vec<String> {
        self.sessions.iter().map(|r| r.key().clone()).collect()
    }

    /// Get all terminal IDs currently tracked.
    pub fn get_all_terminal_ids(&self) -> Vec<String> {
        self.terminals.iter().map(|r| r.key().clone()).collect()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Helpers
// =============================================================================

/// Current time in milliseconds since UNIX epoch.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Detect early process death and return an error message if applicable.
///
/// Mirrors the TypeScript `detectEarlyDeathError` logic:
/// - Exit code 256 with messages is benign (pipe death on Windows)
/// - Non-zero exit while waiting → error
/// - Non-zero exit with no messages → error
fn detect_early_death_error(state: &TerminalAgentState, exit_code: Option<i32>) -> Option<String> {
    let was_waiting = state.is_waiting_for_response;
    let has_messages = !state.messages.is_empty() || state.current_message.is_some();

    // Exit code 256 with messages is typically a benign pipe death
    if exit_code == Some(256) && has_messages {
        return None;
    }

    if was_waiting {
        if let Some(code) = exit_code {
            if code != 0 {
                return Some(format!(
                    "Agent process exited with code {} before responding. \
                     The session may be invalid — try sending again or start a new session.",
                    code
                ));
            }
        }
        return Some(
            "Agent process exited unexpectedly before responding. \
             Try sending your message again."
                .to_string(),
        );
    }

    if let Some(code) = exit_code {
        if code != 0 && state.current_message.is_none() && state.messages.is_empty() {
            return Some(format!("Agent process exited with code {}.", code));
        }
    }

    None
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_token_usage() -> TokenUsage {
        TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: None,
            cache_creation_input_tokens: None,
        }
    }

    #[test]
    fn test_session_init() {
        let mgr = SessionManager::new();
        mgr.process_event(
            "term-1",
            &AgentEvent::SessionInit {
                session_id: "sess-abc".into(),
                model: "claude-3".into(),
            },
        );
        assert_eq!(mgr.get_session_id("term-1").unwrap(), "sess-abc");
    }

    #[test]
    fn test_message_lifecycle() {
        let mgr = SessionManager::new();

        // Start a message
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.is_active);
        assert!(!state.is_waiting_for_response);
        assert!(state.current_message.is_some());
        assert_eq!(state.current_message.as_ref().unwrap().id, "msg-1");

        // Add text
        mgr.process_event(
            "term-1",
            &AgentEvent::TextDelta {
                message_id: "msg-1".into(),
                text: "Hello ".into(),
                block_index: 0,
            },
        );
        mgr.process_event(
            "term-1",
            &AgentEvent::TextDelta {
                message_id: "msg-1".into(),
                text: "world!".into(),
                block_index: 0,
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        let msg = state.current_message.as_ref().unwrap();
        assert_eq!(msg.blocks.len(), 1);
        assert_eq!(msg.blocks[0].content, "Hello world!");

        // End block
        mgr.process_event(
            "term-1",
            &AgentEvent::BlockEnd {
                message_id: "msg-1".into(),
                block_index: 0,
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.current_message.as_ref().unwrap().blocks[0].is_complete);

        // End message
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageEnd {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                stop_reason: Some("end_turn".into()),
                usage: Some(make_token_usage()),
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(!state.is_active);
        assert!(state.current_message.is_none());
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].status, MessageStatus::Completed);
    }

    #[test]
    fn test_tool_use_keeps_active() {
        let mgr = SessionManager::new();

        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );

        mgr.process_event(
            "term-1",
            &AgentEvent::ToolStart {
                message_id: "msg-1".into(),
                tool_id: "tool-1".into(),
                name: "Bash".into(),
                block_index: 0,
            },
        );

        mgr.process_event(
            "term-1",
            &AgentEvent::MessageEnd {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                stop_reason: Some("tool_use".into()),
                usage: Some(make_token_usage()),
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.is_active); // stays active for tool_use
    }

    #[test]
    fn test_message_dedup() {
        let mgr = SessionManager::new();

        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );

        // Duplicate should be ignored
        let changed = mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );
        assert!(!changed);
    }

    #[test]
    fn test_tool_result_matching() {
        let mgr = SessionManager::new();

        // Create and complete a message with a tool block
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );
        mgr.process_event(
            "term-1",
            &AgentEvent::ToolStart {
                message_id: "msg-1".into(),
                tool_id: "tool-1".into(),
                name: "Bash".into(),
                block_index: 0,
            },
        );
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageEnd {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                stop_reason: Some("tool_use".into()),
                usage: Some(make_token_usage()),
            },
        );

        // Now send tool result (arrives in subsequent user message)
        mgr.process_event(
            "term-1",
            &AgentEvent::ToolResult {
                tool_id: "tool-1".into(),
                result: "command output".into(),
                is_error: false,
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        let block = &state.messages[0].blocks[0];
        assert_eq!(block.tool_result.as_deref(), Some("command output"));
        assert_eq!(block.tool_result_is_error, Some(false));
    }

    #[test]
    fn test_persistence() {
        let mgr = SessionManager::new();

        mgr.set_terminal_session("term-1", "sess-1");
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageEnd {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                stop_reason: Some("end_turn".into()),
                usage: Some(make_token_usage()),
            },
        );

        mgr.persist_session("term-1");

        let session = mgr.get_persisted_session("sess-1").unwrap();
        assert_eq!(session.messages.len(), 1);
    }

    #[test]
    fn test_restore_session() {
        let mgr = SessionManager::new();

        let messages = vec![AgentMessage {
            id: "msg-restored".into(),
            model: "claude-3".into(),
            blocks: vec![ContentBlock {
                block_type: ContentBlockType::Text,
                content: "restored content".into(),
                tool_id: None,
                tool_name: None,
                tool_input: None,
                is_complete: true,
                tool_result_is_error: None,
                tool_result: None,
            }],
            usage: None,
            stop_reason: Some("end_turn".into()),
            status: MessageStatus::Completed,
            started_at: 1000,
            completed_at: Some(2000),
        }];

        mgr.restore_session("term-new", "sess-old", messages);

        let state = mgr.get_terminal_state("term-new").unwrap();
        assert_eq!(state.messages.len(), 1);
        assert!(state.process_exited);
        assert!(!state.is_active);
        assert_eq!(mgr.get_session_id("term-new").unwrap(), "sess-old");
    }

    #[test]
    fn test_process_exit_early_death() {
        let mgr = SessionManager::new();

        mgr.mark_waiting_for_response("term-1");
        mgr.set_terminal_session("term-1", "sess-1");

        mgr.process_event(
            "term-1",
            &AgentEvent::ProcessExit {
                exit_code: Some(1),
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.process_exited);
        assert!(!state.is_active);
        assert!(state.error.is_some());
        assert!(state.error.as_ref().unwrap().contains("code 1"));
    }

    #[test]
    fn test_ask_user_question_denial_skipped() {
        let mgr = SessionManager::new();

        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );
        mgr.process_event(
            "term-1",
            &AgentEvent::ToolStart {
                message_id: "msg-1".into(),
                tool_id: "tool-q".into(),
                name: "AskUserQuestion".into(),
                block_index: 0,
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.is_waiting_for_question);

        // Message completes with tool_use stop reason
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageEnd {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                stop_reason: Some("tool_use".into()),
                usage: Some(make_token_usage()),
            },
        );

        // Denied by permission hook — error tool_result should be skipped
        let changed = mgr.process_event(
            "term-1",
            &AgentEvent::ToolResult {
                tool_id: "tool-q".into(),
                result: "denied".into(),
                is_error: true,
            },
        );

        assert!(!changed); // no state change
        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.is_waiting_for_question); // stays true for QuestionCard
        // tool_result not stored on the block
        let block = &state.messages[0].blocks[0];
        assert!(block.tool_result.is_none());
        assert!(block.tool_result_is_error.is_none());
    }

    #[test]
    fn test_ask_user_question_clears_on_end_turn() {
        let mgr = SessionManager::new();

        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );
        mgr.process_event(
            "term-1",
            &AgentEvent::ToolStart {
                message_id: "msg-1".into(),
                tool_id: "tool-q".into(),
                name: "AskUserQuestion".into(),
                block_index: 0,
            },
        );

        assert!(mgr.get_terminal_state("term-1").unwrap().is_waiting_for_question);

        // Agent gives up and ends the turn
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageEnd {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                stop_reason: Some("end_turn".into()),
                usage: Some(make_token_usage()),
            },
        );

        // is_waiting_for_question cleared on end_turn
        assert!(!mgr.get_terminal_state("term-1").unwrap().is_waiting_for_question);
    }

    #[test]
    fn test_system_event() {
        let mgr = SessionManager::new();

        mgr.process_event(
            "term-1",
            &AgentEvent::SystemEvent {
                subtype: "context_compaction".into(),
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].blocks[0].content, "context_compaction");
    }

    #[test]
    fn test_context_usage_tracking() {
        let mgr = SessionManager::new();

        mgr.set_terminal_session("term-1", "sess-1");
        mgr.process_event(
            "term-1",
            &AgentEvent::SessionResult {
                subtype: "success".into(),
                total_cost_usd: Some(0.05),
                duration_ms: Some(1500),
                usage: Some(make_token_usage()),
            },
        );

        let usage = mgr.get_context_usage("sess-1").unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
    }

    #[test]
    fn test_session_result_finalizes_state() {
        let mgr = SessionManager::new();

        mgr.set_terminal_session("term-1", "sess-1");
        mgr.mark_waiting_for_response("term-1");

        // Start a message (simulating an in-flight response)
        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.is_active);
        assert!(state.current_message.is_some());

        // Session result arrives — should finalize everything
        mgr.process_event(
            "term-1",
            &AgentEvent::SessionResult {
                subtype: "success".into(),
                total_cost_usd: Some(0.01),
                duration_ms: Some(500),
                usage: Some(make_token_usage()),
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(!state.is_active);
        assert!(!state.is_waiting_for_response);
        assert!(state.current_message.is_none());
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].status, MessageStatus::Completed);
    }

    #[test]
    fn test_session_result_non_success_ignored() {
        let mgr = SessionManager::new();

        mgr.set_terminal_session("term-1", "sess-1");

        mgr.process_event(
            "term-1",
            &AgentEvent::MessageStart {
                message_id: "msg-1".into(),
                model: "claude-3".into(),
                usage: None,
            },
        );

        // A non-success/error subtype should not touch terminal state
        mgr.process_event(
            "term-1",
            &AgentEvent::SessionResult {
                subtype: "info".into(),
                total_cost_usd: None,
                duration_ms: None,
                usage: None,
            },
        );

        let state = mgr.get_terminal_state("term-1").unwrap();
        assert!(state.is_active); // unchanged
        assert!(state.current_message.is_some()); // unchanged
    }

    #[test]
    fn test_delete_sessions() {
        let mgr = SessionManager::new();

        mgr.sessions.insert(
            "sess-1".into(),
            PersistedSession {
                session_id: "sess-1".into(),
                messages: vec![],
                last_active_at: 0,
                latest_context_usage: None,
                total_cost_usd: None,
            },
        );
        mgr.sessions.insert(
            "sess-2".into(),
            PersistedSession {
                session_id: "sess-2".into(),
                messages: vec![],
                last_active_at: 0,
                latest_context_usage: None,
                total_cost_usd: None,
            },
        );

        mgr.delete_persisted_sessions(&["sess-1".into(), "sess-2".into()]);
        assert!(mgr.get_persisted_session("sess-1").is_none());
        assert!(mgr.get_persisted_session("sess-2").is_none());
    }
}
