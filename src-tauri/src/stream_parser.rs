//! NDJSON stream parser for Claude CLI PTY output.
//!
//! Replaces the TypeScript `StreamJsonDetector` and `pty-json-utils.ts`.
//! Parses raw PTY bytes, strips ANSI escape codes, extracts JSON objects
//! via brace-matching, and emits structured [`AgentEvent`]s.

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum AgentEvent {
    #[serde(rename = "session_init")]
    SessionInit {
        session_id: String,
        model: String,
    },
    #[serde(rename = "message_start")]
    MessageStart {
        message_id: String,
        model: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<TokenUsage>,
    },
    #[serde(rename = "text_delta")]
    TextDelta {
        message_id: String,
        block_index: u32,
        text: String,
    },
    #[serde(rename = "thinking_delta")]
    ThinkingDelta {
        message_id: String,
        block_index: u32,
        text: String,
    },
    #[serde(rename = "tool_start")]
    ToolStart {
        message_id: String,
        block_index: u32,
        tool_id: String,
        name: String,
    },
    #[serde(rename = "tool_input_delta")]
    ToolInputDelta {
        message_id: String,
        block_index: u32,
        partial_json: String,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_id: String,
        result: String,
        is_error: bool,
    },
    #[serde(rename = "block_end")]
    BlockEnd {
        message_id: String,
        block_index: u32,
    },
    #[serde(rename = "message_end")]
    MessageEnd {
        message_id: String,
        model: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<TokenUsage>,
    },
    #[serde(rename = "session_result")]
    SessionResult {
        subtype: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_cost_usd: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<TokenUsage>,
    },
    #[serde(rename = "system_event")]
    SystemEvent {
        subtype: String,
    },
    #[serde(rename = "process_exit")]
    ProcessExit {
        exit_code: Option<i32>,
    },
}

// ---------------------------------------------------------------------------
// Per-terminal state
// ---------------------------------------------------------------------------

struct TerminalStreamState {
    buffer: String,
    message_id: Option<String>,
    model: Option<String>,
    current_block_index: i32,
    current_block_type: Option<String>,
    usage: Option<TokenUsage>,
    stop_reason: Option<String>,
    processed_message_ids: HashSet<String>,
}

impl TerminalStreamState {
    fn new() -> Self {
        Self {
            buffer: String::new(),
            message_id: None,
            model: None,
            current_block_index: -1,
            current_block_type: None,
            usage: None,
            stop_reason: None,
            processed_message_ids: HashSet::new(),
        }
    }

    fn reset_message_state(&mut self) {
        self.message_id = None;
        self.model = None;
        self.current_block_index = -1;
        self.current_block_type = None;
        self.usage = None;
        self.stop_reason = None;
    }
}

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

static ANSI_RE: OnceLock<Regex> = OnceLock::new();

fn ansi_regex() -> &'static Regex {
    ANSI_RE.get_or_init(|| Regex::new(r"\x1B\[[0-9;]*[a-zA-Z]").expect("invalid ANSI regex"))
}

/// Strip ANSI escape codes from raw PTY output.
fn strip_ansi(input: &str) -> String {
    ansi_regex().replace_all(input, "").into_owned()
}

// ---------------------------------------------------------------------------
// Brace-matched JSON extraction
// ---------------------------------------------------------------------------

struct ExtractResult {
    json_objects: Vec<String>,
    remaining: String,
}

/// Extract complete JSON objects from `buffer` using brace-matching.
///
/// Non-JSON content before `{` is skipped.  Incomplete JSON at the end of the
/// buffer is returned as `remaining` so it can be prepended to the next chunk.
fn extract_complete_json_objects(buffer: &str) -> ExtractResult {
    let bytes = buffer.as_bytes();
    let len = bytes.len();
    let mut json_objects: Vec<String> = Vec::new();
    let mut remaining = String::new();
    let mut i = 0;

    while i < len {
        if bytes[i] != b'{' {
            i += 1;
            continue;
        }

        // Start of a potential JSON object.
        let start = i;
        let mut depth: i32 = 0;
        let mut in_string = false;
        let mut escape_next = false;
        let mut j = i;
        let mut complete = false;

        while j < len {
            let ch = bytes[j];

            if escape_next {
                escape_next = false;
                j += 1;
                continue;
            }

            if ch == b'\\' && in_string {
                escape_next = true;
                j += 1;
                continue;
            }

            if ch == b'"' {
                in_string = !in_string;
                j += 1;
                continue;
            }

            if !in_string {
                if ch == b'{' {
                    depth += 1;
                } else if ch == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        // Complete JSON object found — strip embedded CR/LF that
                        // the PTY layer may have inserted.
                        let raw = &buffer[start..=j];
                        let cleaned: String = raw.chars().filter(|&c| c != '\r' && c != '\n').collect();
                        json_objects.push(cleaned);
                        i = j + 1;
                        complete = true;
                        break;
                    }
                }
            }
            j += 1;
        }

        if !complete {
            // Incomplete JSON — save from `start` onward for next call.
            remaining = buffer[start..].to_string();
            break;
        }
    }

    ExtractResult {
        json_objects,
        remaining,
    }
}

// ---------------------------------------------------------------------------
// Helpers for reading fields from serde_json::Value
// ---------------------------------------------------------------------------

fn val_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn val_u64(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(|v| v.as_u64())
}

fn val_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|v| v.as_f64())
}

fn val_i32(v: &Value, key: &str) -> Option<i32> {
    v.get(key).and_then(|v| v.as_i64()).map(|n| n as i32)
}

fn val_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn parse_usage(v: &Value) -> Option<TokenUsage> {
    let obj = if v.is_object() { v } else { return None };
    // Must have at least one token field to be considered valid usage.
    if obj.get("input_tokens").is_none() && obj.get("output_tokens").is_none() {
        return None;
    }
    Some(TokenUsage {
        input_tokens: val_u64(obj, "input_tokens").unwrap_or(0),
        output_tokens: val_u64(obj, "output_tokens").unwrap_or(0),
        cache_read_input_tokens: val_u64(obj, "cache_read_input_tokens"),
        cache_creation_input_tokens: val_u64(obj, "cache_creation_input_tokens"),
    })
}

fn parse_usage_field(parent: &Value, key: &str) -> Option<TokenUsage> {
    parent.get(key).and_then(|u| parse_usage(u))
}

// ---------------------------------------------------------------------------
// StreamParser — public API
// ---------------------------------------------------------------------------

pub struct StreamParser {
    states: HashMap<String, TerminalStreamState>,
}

impl StreamParser {
    pub fn new() -> Self {
        Self {
            states: HashMap::new(),
        }
    }

    /// Process raw PTY output for a given terminal. Returns any events detected.
    pub fn process_output(&mut self, terminal_id: &str, data: &[u8]) -> Vec<AgentEvent> {
        let text = String::from_utf8_lossy(data);
        let clean = strip_ansi(&text);

        let state = self
            .states
            .entry(terminal_id.to_string())
            .or_insert_with(TerminalStreamState::new);

        state.buffer.push_str(&clean);

        let ExtractResult {
            json_objects,
            remaining,
        } = extract_complete_json_objects(&state.buffer);
        state.buffer = remaining;

        let mut events: Vec<AgentEvent> = Vec::new();

        for json_str in &json_objects {
            let parsed: Value = match serde_json::from_str(json_str) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Unwrap stream_event wrapper if present.
            let event_val = if val_str(&parsed, "type").as_deref() == Some("stream_event") {
                match parsed.get("event") {
                    Some(inner) => inner.clone(),
                    None => parsed,
                }
            } else {
                parsed
            };

            let mut new_events = self.process_event(terminal_id, &event_val);
            events.append(&mut new_events);
        }

        events
    }

    /// Handle terminal process exit. Emits a synthetic `MessageEnd` if a
    /// message was in progress, followed by a `ProcessExit`.
    pub fn handle_exit(&mut self, terminal_id: &str, exit_code: Option<i32>) -> Vec<AgentEvent> {
        let mut events: Vec<AgentEvent> = Vec::new();

        if let Some(state) = self.states.get(terminal_id) {
            if let Some(ref msg_id) = state.message_id {
                events.push(AgentEvent::MessageEnd {
                    message_id: msg_id.clone(),
                    model: state.model.clone().unwrap_or_default(),
                    stop_reason: Some("terminal_exit".to_string()),
                    usage: state.usage.clone(),
                });
            }
        }

        events.push(AgentEvent::ProcessExit { exit_code });
        events
    }

    /// Remove all state associated with a terminal.
    pub fn cleanup(&mut self, terminal_id: &str) {
        self.states.remove(terminal_id);
    }

    // -----------------------------------------------------------------------
    // Internal event dispatch
    // -----------------------------------------------------------------------

    fn process_event(&mut self, terminal_id: &str, event: &Value) -> Vec<AgentEvent> {
        let event_type = match val_str(event, "type") {
            Some(t) => t,
            None => return Vec::new(),
        };

        let state = self
            .states
            .entry(terminal_id.to_string())
            .or_insert_with(TerminalStreamState::new);

        match event_type.as_str() {
            "message_start" => Self::handle_message_start(state, event),
            "content_block_start" => Self::handle_content_block_start(state, event),
            "content_block_delta" => Self::handle_content_block_delta(state, event),
            "content_block_stop" => Self::handle_content_block_stop(state),
            "message_delta" => Self::handle_message_delta(state, event),
            "message_stop" => Self::handle_message_stop(state),
            "system" => Self::handle_system(state, event),
            "assistant" => Self::handle_assistant(state, event),
            "user" => Self::handle_user(event),
            "result" => Self::handle_result(event),
            _ => Vec::new(),
        }
    }

    // -- message_start ------------------------------------------------------

    fn handle_message_start(state: &mut TerminalStreamState, event: &Value) -> Vec<AgentEvent> {
        let msg = match event.get("message") {
            Some(m) => m,
            None => return Vec::new(),
        };

        let msg_id = val_str(msg, "id").unwrap_or_default();
        let model = val_str(msg, "model").unwrap_or_default();

        state.message_id = Some(msg_id.clone());
        state.model = Some(model.clone());
        state.current_block_index = -1;
        state.current_block_type = None;
        state.stop_reason = None;

        let usage = parse_usage_field(msg, "usage");
        state.usage = usage.clone();

        vec![AgentEvent::MessageStart {
            message_id: msg_id,
            model,
            usage,
        }]
    }

    // -- content_block_start ------------------------------------------------

    fn handle_content_block_start(
        state: &mut TerminalStreamState,
        event: &Value,
    ) -> Vec<AgentEvent> {
        let block = match event.get("content_block") {
            Some(b) => b,
            None => return Vec::new(),
        };

        let index = val_i32(event, "index").unwrap_or(state.current_block_index + 1);
        state.current_block_index = index;
        let block_type = val_str(block, "type").unwrap_or_default();
        state.current_block_type = Some(block_type.clone());

        let msg_id = state.message_id.clone().unwrap_or_default();
        let idx = index as u32;

        match block_type.as_str() {
            "text" => {
                let mut events = Vec::with_capacity(2);
                // If the block carries initial text, emit it as a delta.
                if let Some(text) = val_str(block, "text") {
                    if !text.is_empty() {
                        events.push(AgentEvent::TextDelta {
                            message_id: msg_id.clone(),
                            block_index: idx,
                            text,
                        });
                    }
                }
                events
            }
            "thinking" => {
                let mut events = Vec::with_capacity(2);
                if let Some(text) = val_str(block, "thinking") {
                    if !text.is_empty() {
                        events.push(AgentEvent::ThinkingDelta {
                            message_id: msg_id.clone(),
                            block_index: idx,
                            text,
                        });
                    }
                }
                events
            }
            "tool_use" => {
                vec![AgentEvent::ToolStart {
                    message_id: msg_id,
                    block_index: idx,
                    tool_id: val_str(block, "id").unwrap_or_default(),
                    name: val_str(block, "name").unwrap_or_default(),
                }]
            }
            _ => Vec::new(),
        }
    }

    // -- content_block_delta ------------------------------------------------

    fn handle_content_block_delta(
        state: &mut TerminalStreamState,
        event: &Value,
    ) -> Vec<AgentEvent> {
        let delta = match event.get("delta") {
            Some(d) => d,
            None => return Vec::new(),
        };

        let msg_id = state.message_id.clone().unwrap_or_default();
        let idx = state.current_block_index as u32;
        let delta_type = val_str(delta, "type").unwrap_or_default();

        // Determine which event to emit based on block type, falling back to delta type.
        let block_type = state.current_block_type.as_deref();
        match block_type {
            Some("text") => {
                vec![AgentEvent::TextDelta {
                    message_id: msg_id,
                    block_index: idx,
                    text: val_str(delta, "text").unwrap_or_default(),
                }]
            }
            Some("thinking") => {
                vec![AgentEvent::ThinkingDelta {
                    message_id: msg_id,
                    block_index: idx,
                    text: val_str(delta, "thinking").unwrap_or_default(),
                }]
            }
            Some("tool_use") => {
                vec![AgentEvent::ToolInputDelta {
                    message_id: msg_id,
                    block_index: idx,
                    partial_json: val_str(delta, "partial_json").unwrap_or_default(),
                }]
            }
            _ => {
                // Fallback: infer from delta.type
                match delta_type.as_str() {
                    "text_delta" => vec![AgentEvent::TextDelta {
                        message_id: msg_id,
                        block_index: idx,
                        text: val_str(delta, "text").unwrap_or_default(),
                    }],
                    "thinking_delta" => vec![AgentEvent::ThinkingDelta {
                        message_id: msg_id,
                        block_index: idx,
                        text: val_str(delta, "thinking").unwrap_or_default(),
                    }],
                    "input_json_delta" => vec![AgentEvent::ToolInputDelta {
                        message_id: msg_id,
                        block_index: idx,
                        partial_json: val_str(delta, "partial_json").unwrap_or_default(),
                    }],
                    _ => Vec::new(),
                }
            }
        }
    }

    // -- content_block_stop -------------------------------------------------

    fn handle_content_block_stop(state: &mut TerminalStreamState) -> Vec<AgentEvent> {
        vec![AgentEvent::BlockEnd {
            message_id: state.message_id.clone().unwrap_or_default(),
            block_index: state.current_block_index as u32,
        }]
    }

    // -- message_delta ------------------------------------------------------

    fn handle_message_delta(state: &mut TerminalStreamState, event: &Value) -> Vec<AgentEvent> {
        if let Some(delta) = event.get("delta") {
            if let Some(reason) = val_str(delta, "stop_reason") {
                state.stop_reason = Some(reason);
            }
        }
        if let Some(usage_val) = event.get("usage") {
            let output_tokens = val_u64(usage_val, "output_tokens").unwrap_or(0);
            match &mut state.usage {
                Some(u) => u.output_tokens = output_tokens,
                None => {
                    state.usage = Some(TokenUsage {
                        input_tokens: 0,
                        output_tokens,
                        cache_read_input_tokens: None,
                        cache_creation_input_tokens: None,
                    });
                }
            }
        }
        Vec::new()
    }

    // -- message_stop -------------------------------------------------------

    fn handle_message_stop(state: &mut TerminalStreamState) -> Vec<AgentEvent> {
        let events = vec![AgentEvent::MessageEnd {
            message_id: state.message_id.clone().unwrap_or_default(),
            model: state.model.clone().unwrap_or_default(),
            stop_reason: state.stop_reason.clone(),
            usage: state.usage.clone(),
        }];

        // Track as processed so the duplicate `assistant` event is skipped.
        if let Some(ref id) = state.message_id {
            state.processed_message_ids.insert(id.clone());
        }

        state.reset_message_state();
        events
    }

    // -- system -------------------------------------------------------------

    fn handle_system(state: &mut TerminalStreamState, event: &Value) -> Vec<AgentEvent> {
        let subtype = val_str(event, "subtype").unwrap_or_default();

        if subtype == "init" {
            if let Some(session_id) = val_str(event, "session_id") {
                let model = val_str(event, "model").unwrap_or_default();
                state.model = Some(model.clone());
                return vec![AgentEvent::SessionInit { session_id, model }];
            }
        }

        if !subtype.is_empty() && subtype != "init" {
            return vec![AgentEvent::SystemEvent { subtype }];
        }

        Vec::new()
    }

    // -- assistant (print-mode complete message) ----------------------------

    fn handle_assistant(state: &mut TerminalStreamState, event: &Value) -> Vec<AgentEvent> {
        let msg = match event.get("message") {
            Some(m) => m,
            None => return Vec::new(),
        };

        let msg_id = val_str(msg, "id").unwrap_or_default();

        // Skip if already processed via streaming, or if streaming is in progress
        // for this message (avoids corrupting in-flight streaming state).
        if state.processed_message_ids.contains(&msg_id)
            || state.message_id.as_deref() == Some(&msg_id)
        {
            return Vec::new();
        }

        let model = val_str(msg, "model").unwrap_or_default();
        let usage = parse_usage_field(msg, "usage");
        let stop_reason = val_str(msg, "stop_reason");

        state.message_id = Some(msg_id.clone());
        state.model = Some(model.clone());

        let mut events = Vec::with_capacity(8);

        // MessageStart
        events.push(AgentEvent::MessageStart {
            message_id: msg_id.clone(),
            model: model.clone(),
            usage: usage.clone(),
        });

        // Content blocks
        if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
            for (i, block) in content.iter().enumerate() {
                let idx = i as u32;
                let block_type = val_str(block, "type").unwrap_or_default();
                match block_type.as_str() {
                    "text" => {
                        if let Some(text) = val_str(block, "text") {
                            events.push(AgentEvent::TextDelta {
                                message_id: msg_id.clone(),
                                block_index: idx,
                                text,
                            });
                        }
                    }
                    "thinking" => {
                        if let Some(text) = val_str(block, "thinking") {
                            events.push(AgentEvent::ThinkingDelta {
                                message_id: msg_id.clone(),
                                block_index: idx,
                                text,
                            });
                        }
                    }
                    "tool_use" => {
                        events.push(AgentEvent::ToolStart {
                            message_id: msg_id.clone(),
                            block_index: idx,
                            tool_id: val_str(block, "id").unwrap_or_default(),
                            name: val_str(block, "name").unwrap_or_default(),
                        });
                        if let Some(input) = block.get("input") {
                            if let Ok(json_str) = serde_json::to_string(input) {
                                events.push(AgentEvent::ToolInputDelta {
                                    message_id: msg_id.clone(),
                                    block_index: idx,
                                    partial_json: json_str,
                                });
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        // MessageEnd
        events.push(AgentEvent::MessageEnd {
            message_id: msg_id.clone(),
            model,
            stop_reason,
            usage,
        });

        state.reset_message_state();
        events
    }

    // -- user (tool_result blocks) ------------------------------------------

    fn handle_user(event: &Value) -> Vec<AgentEvent> {
        let content = match event
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        {
            Some(c) => c,
            None => return Vec::new(),
        };

        let mut events = Vec::new();

        for block in content {
            if val_str(block, "type").as_deref() != Some("tool_result") {
                continue;
            }

            let tool_id = match val_str(block, "tool_use_id") {
                Some(id) => id,
                None => continue,
            };

            // Extract result text — content may be a string or an array of
            // text blocks.
            let result_text = match block.get("content") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Array(arr)) => {
                    let mut parts = Vec::with_capacity(arr.len());
                    for item in arr {
                        if val_str(item, "type").as_deref() == Some("text") {
                            if let Some(t) = val_str(item, "text") {
                                parts.push(t);
                            }
                        }
                    }
                    parts.join("\n")
                }
                _ => String::new(),
            };

            events.push(AgentEvent::ToolResult {
                tool_id,
                result: result_text,
                is_error: val_bool(block, "is_error"),
            });
        }

        events
    }

    // -- result -------------------------------------------------------------

    fn handle_result(event: &Value) -> Vec<AgentEvent> {
        let subtype = match val_str(event, "subtype") {
            Some(s) if s == "success" || s == "error" => s,
            _ => return Vec::new(),
        };

        vec![AgentEvent::SessionResult {
            subtype,
            total_cost_usd: val_f64(event, "total_cost_usd"),
            duration_ms: val_u64(event, "duration_ms"),
            usage: parse_usage_field(event, "usage"),
        }]
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        let input = "\x1B[32mHello\x1B[0m World";
        assert_eq!(strip_ansi(input), "Hello World");
    }

    #[test]
    fn test_strip_ansi_no_codes() {
        assert_eq!(strip_ansi("plain text"), "plain text");
    }

    #[test]
    fn test_extract_single_json() {
        let buf = r#"some garbage {"type":"test","value":1} more"#;
        let result = extract_complete_json_objects(buf);
        assert_eq!(result.json_objects.len(), 1);
        assert_eq!(result.json_objects[0], r#"{"type":"test","value":1}"#);
        assert!(result.remaining.is_empty());
    }

    #[test]
    fn test_extract_multiple_json() {
        let buf = r#"{"a":1}skip{"b":2}"#;
        let result = extract_complete_json_objects(buf);
        assert_eq!(result.json_objects.len(), 2);
        assert_eq!(result.json_objects[0], r#"{"a":1}"#);
        assert_eq!(result.json_objects[1], r#"{"b":2}"#);
    }

    #[test]
    fn test_extract_incomplete_json() {
        let buf = r#"{"a":1}{"b":"incompl"#;
        let result = extract_complete_json_objects(buf);
        assert_eq!(result.json_objects.len(), 1);
        assert_eq!(result.remaining, r#"{"b":"incompl"#);
    }

    #[test]
    fn test_extract_handles_embedded_newlines() {
        let buf = "{\n\"a\"\n:\n1\n}";
        let result = extract_complete_json_objects(buf);
        assert_eq!(result.json_objects.len(), 1);
        assert_eq!(result.json_objects[0], r#"{"a":1}"#);
    }

    #[test]
    fn test_extract_handles_braces_in_strings() {
        let buf = r#"{"text":"hello { world }"}"#;
        let result = extract_complete_json_objects(buf);
        assert_eq!(result.json_objects.len(), 1);
        // The braces inside the string should not affect depth tracking.
        let parsed: Value = serde_json::from_str(&result.json_objects[0]).unwrap();
        assert_eq!(parsed["text"].as_str().unwrap(), "hello { world }");
    }

    #[test]
    fn test_extract_handles_escaped_quotes() {
        let buf = r#"{"text":"say \"hello\""}"#;
        let result = extract_complete_json_objects(buf);
        assert_eq!(result.json_objects.len(), 1);
    }

    #[test]
    fn test_process_system_init() {
        let mut parser = StreamParser::new();
        let data = br#"{"type":"system","subtype":"init","session_id":"abc-123","model":"claude-4"}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            AgentEvent::SessionInit { session_id, model } => {
                assert_eq!(session_id, "abc-123");
                assert_eq!(model, "claude-4");
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn test_process_message_lifecycle() {
        let mut parser = StreamParser::new();

        // message_start
        let data = br#"{"type":"message_start","message":{"id":"msg_1","model":"claude-4","usage":{"input_tokens":10,"output_tokens":0}}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::MessageStart { message_id, .. } if message_id == "msg_1"));

        // content_block_start (text)
        let data = br#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#;
        let events = parser.process_output("t1", data);
        // Empty initial text should not produce a delta.
        assert_eq!(events.len(), 0);

        // content_block_delta
        let data = br#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::TextDelta { text, .. } if text == "Hello"));

        // content_block_stop
        let data = br#"{"type":"content_block_stop"}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::BlockEnd { .. }));

        // message_delta
        let data = br#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 0); // No events emitted, just state update.

        // message_stop
        let data = br#"{"type":"message_stop"}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            AgentEvent::MessageEnd { stop_reason, usage, .. } => {
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
                assert_eq!(usage.as_ref().unwrap().output_tokens, 5);
            }
            other => panic!("unexpected: {:?}", other),
        }
    }

    #[test]
    fn test_stream_event_wrapper() {
        let mut parser = StreamParser::new();
        let data = br#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_2","model":"claude-4"}}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::MessageStart { message_id, .. } if message_id == "msg_2"));
    }

    #[test]
    fn test_assistant_duplicate_skip() {
        let mut parser = StreamParser::new();

        // Process full streaming lifecycle for msg_1
        parser.process_output("t1", br#"{"type":"message_start","message":{"id":"msg_1","model":"m"}}"#);
        parser.process_output("t1", br#"{"type":"message_stop"}"#);

        // Now an assistant event arrives for the same message — should be skipped.
        let events = parser.process_output("t1", br#"{"type":"assistant","message":{"id":"msg_1","model":"m","content":[{"type":"text","text":"hi"}]}}"#);
        assert!(events.is_empty());
    }

    #[test]
    fn test_user_tool_result() {
        let mut parser = StreamParser::new();
        let data = br#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool_1","content":"output data","is_error":false}]}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            AgentEvent::ToolResult {
                tool_id,
                result,
                is_error,
            } => {
                assert_eq!(tool_id, "tool_1");
                assert_eq!(result, "output data");
                assert!(!is_error);
            }
            other => panic!("unexpected: {:?}", other),
        }
    }

    #[test]
    fn test_result_event() {
        let mut parser = StreamParser::new();
        let data = br#"{"type":"result","subtype":"success","total_cost_usd":0.05,"duration_ms":1234,"usage":{"input_tokens":100,"output_tokens":50}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            AgentEvent::SessionResult {
                subtype,
                total_cost_usd,
                duration_ms,
                usage,
            } => {
                assert_eq!(subtype, "success");
                assert_eq!(*total_cost_usd, Some(0.05));
                assert_eq!(*duration_ms, Some(1234));
                assert_eq!(usage.as_ref().unwrap().input_tokens, 100);
            }
            other => panic!("unexpected: {:?}", other),
        }
    }

    #[test]
    fn test_handle_exit_with_active_message() {
        let mut parser = StreamParser::new();
        parser.process_output("t1", br#"{"type":"message_start","message":{"id":"msg_x","model":"m"}}"#);

        let events = parser.handle_exit("t1", Some(1));
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[0], AgentEvent::MessageEnd { message_id, stop_reason, .. }
            if message_id == "msg_x" && stop_reason.as_deref() == Some("terminal_exit")));
        assert!(matches!(&events[1], AgentEvent::ProcessExit { exit_code: Some(1) }));
    }

    #[test]
    fn test_handle_exit_no_active_message() {
        let mut parser = StreamParser::new();
        let events = parser.handle_exit("t1", Some(0));
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::ProcessExit { exit_code: Some(0) }));
    }

    #[test]
    fn test_cleanup() {
        let mut parser = StreamParser::new();
        parser.process_output("t1", br#"{"type":"system","subtype":"init","session_id":"s1","model":"m"}"#);
        parser.cleanup("t1");
        assert!(!parser.states.contains_key("t1"));
    }

    #[test]
    fn test_ansi_before_json() {
        let mut parser = StreamParser::new();
        let data = b"\x1B[32m{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"s\",\"model\":\"m\"}\x1B[0m";
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::SessionInit { .. }));
    }

    #[test]
    fn test_incremental_buffer() {
        let mut parser = StreamParser::new();

        // Send partial JSON
        let events = parser.process_output("t1", br#"{"type":"system","sub"#);
        assert!(events.is_empty());

        // Send the rest
        let events = parser.process_output("t1", br#"type":"init","session_id":"s","model":"m"}"#);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::SessionInit { .. }));
    }

    #[test]
    fn test_tool_start_event() {
        let mut parser = StreamParser::new();
        parser.process_output("t1", br#"{"type":"message_start","message":{"id":"msg_1","model":"m"}}"#);

        let data = br#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_abc","name":"Read"}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        match &events[0] {
            AgentEvent::ToolStart {
                tool_id, name, ..
            } => {
                assert_eq!(tool_id, "tool_abc");
                assert_eq!(name, "Read");
            }
            other => panic!("unexpected: {:?}", other),
        }
    }

    #[test]
    fn test_thinking_delta() {
        let mut parser = StreamParser::new();
        parser.process_output("t1", br#"{"type":"message_start","message":{"id":"msg_1","model":"m"}}"#);
        parser.process_output("t1", br#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}"#);

        let data = br#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"let me think..."}}"#;
        let events = parser.process_output("t1", data);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], AgentEvent::ThinkingDelta { text, .. } if text == "let me think..."));
    }

    #[test]
    fn test_serialization_format() {
        let event = AgentEvent::SessionInit {
            session_id: "s1".to_string(),
            model: "claude-4".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "session_init");
        assert_eq!(parsed["data"]["session_id"], "s1");
        assert_eq!(parsed["data"]["model"], "claude-4");
    }
}
