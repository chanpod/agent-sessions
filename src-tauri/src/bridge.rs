//! Bridge module: wires PTY output → StreamParser → SessionState → EventBatcher
//!
//! This is the hot path. PTY data arrives on OS threads, gets parsed into structured
//! events, updates session state, and queues events for batched delivery to the frontend.
//! Everything here must be fast and non-blocking.

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::AppHandle;

use crate::event_batcher::EventBatcher;
use crate::pty_manager::{PtyEvent, PtyManager};
use crate::session_state::SessionManager;
use crate::stream_parser::StreamParser;

/// Start the event processing pipeline.
///
/// Subscribes to PTY events (data + exit) and routes them through:
/// 1. StreamParser (NDJSON → structured AgentEvents)
/// 2. SessionManager (update state)
/// 3. EventBatcher (queue for batched delivery to frontend)
///
/// Also forwards raw PTY data to the frontend for xterm.js rendering
/// of non-agent (interactive) terminals.
pub fn start_event_pipeline(
    app_handle: AppHandle,
    pty_manager: Arc<PtyManager>,
    session_manager: Arc<SessionManager>,
    event_batcher: Arc<EventBatcher>,
) {
    let mut rx = pty_manager.subscribe();

    // The stream parser is NOT thread-safe (uses HashMap internally),
    // so we wrap it in a Mutex. This is fine because we process events
    // sequentially from a single subscriber.
    let parser = Arc::new(Mutex::new(StreamParser::new()));

    // Spawn a dedicated task to process all PTY events
    tauri::async_runtime::spawn(async move {
        log::info!("[bridge] Event pipeline started, waiting for PTY events...");
        loop {
            match rx.recv().await {
                Ok(event) => {
                    process_pty_event(
                        &event,
                        &parser,
                        &session_manager,
                        &event_batcher,
                        &app_handle,
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("Event pipeline lagged, dropped {} events", n);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    log::info!("PTY event channel closed, shutting down pipeline");
                    break;
                }
            }
        }
    });
}

fn process_pty_event(
    event: &PtyEvent,
    parser: &Arc<Mutex<StreamParser>>,
    session_manager: &Arc<SessionManager>,
    event_batcher: &Arc<EventBatcher>,
    app_handle: &AppHandle,
) {
    match event {
        PtyEvent::Data {
            terminal_id,
            data,
            hidden,
        } => {
            let preview = String::from_utf8_lossy(&data[..data.len().min(200)]);
            log::debug!(
                "[bridge] PtyEvent::Data terminal={} len={} hidden={} preview='{}'",
                &terminal_id[..8.min(terminal_id.len())],
                data.len(),
                hidden,
                preview.replace('\n', "\\n").replace('\r', "\\r")
            );

            // For non-hidden terminals, forward raw data to frontend for xterm.js
            if !hidden {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "pty:data",
                    serde_json::json!({
                        "terminalId": terminal_id,
                        "data": base64_encode(data),
                    }),
                );
            }

            // Parse NDJSON and extract structured events
            let agent_events = {
                let mut p = parser.lock();
                p.process_output(terminal_id, data)
            };

            if !agent_events.is_empty() {
                log::info!(
                    "[bridge] StreamParser produced {} events for terminal {}",
                    agent_events.len(),
                    &terminal_id[..8.min(terminal_id.len())]
                );
            }

            // Update session state and queue events for batched delivery
            for agent_event in agent_events {
                log::debug!(
                    "[bridge] Queuing event for terminal {}: {:?}",
                    &terminal_id[..8.min(terminal_id.len())],
                    std::mem::discriminant(&agent_event)
                );
                session_manager.process_event(terminal_id, &agent_event);
                event_batcher.queue(terminal_id.clone(), agent_event);
            }
        }

        PtyEvent::Exit {
            terminal_id,
            exit_code,
            hidden,
        } => {
            log::info!(
                "[bridge] PtyEvent::Exit terminal={} code={:?} hidden={}",
                &terminal_id[..8.min(terminal_id.len())],
                exit_code,
                hidden
            );

            // Generate exit events from parser
            let exit_events = {
                let mut p = parser.lock();
                let events = p.handle_exit(terminal_id, *exit_code);
                p.cleanup(terminal_id);
                events
            };

            for agent_event in exit_events {
                session_manager.process_event(terminal_id, &agent_event);
                event_batcher.queue(terminal_id.clone(), agent_event);
            }

            // For non-hidden terminals, also emit raw exit event
            if !hidden {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "pty:exit",
                    serde_json::json!({
                        "terminalId": terminal_id,
                        "exitCode": exit_code,
                    }),
                );
            }
        }
    }
}

/// Base64 encode bytes for efficient transfer to frontend.
/// The frontend decodes this back to Uint8Array for xterm.js.
fn base64_encode(data: &[u8]) -> String {
    use std::io::Write;
    let mut buf = Vec::with_capacity(data.len() * 4 / 3 + 4);
    {
        let mut encoder =
            base64_writer::Base64Encoder::new(&mut buf, base64_writer::Base64Config::STANDARD);
        let _ = encoder.write_all(data);
        let _ = encoder.finish();
    }
    // Safety: base64 output is always valid ASCII/UTF-8
    unsafe { String::from_utf8_unchecked(buf) }
}

/// Simple base64 encoder (avoids adding a dependency just for this)
mod base64_writer {
    use std::io::{self, Write};

    const BASE64_CHARS: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub struct Base64Config;
    impl Base64Config {
        pub const STANDARD: Self = Self;
    }

    pub struct Base64Encoder<'a, W: Write> {
        writer: &'a mut W,
        _config: Base64Config,
        buffer: [u8; 3],
        buffer_len: usize,
    }

    impl<'a, W: Write> Base64Encoder<'a, W> {
        pub fn new(writer: &'a mut W, config: Base64Config) -> Self {
            Self {
                writer,
                _config: config,
                buffer: [0; 3],
                buffer_len: 0,
            }
        }

        fn encode_group(writer: &mut dyn Write, input: &[u8], len: usize) -> io::Result<()> {
            let mut out = [b'='; 4];
            out[0] = BASE64_CHARS[(input[0] >> 2) as usize];
            if len >= 1 {
                out[1] =
                    BASE64_CHARS[((input[0] & 0x03) << 4 | input[1] >> 4) as usize];
            }
            if len >= 2 {
                out[2] =
                    BASE64_CHARS[((input[1] & 0x0f) << 2 | input[2] >> 6) as usize];
            }
            if len >= 3 {
                out[3] = BASE64_CHARS[(input[2] & 0x3f) as usize];
            }
            writer.write_all(&out)
        }

        pub fn finish(self) -> io::Result<()> {
            if self.buffer_len > 0 {
                let mut group = [0u8; 3];
                group[..self.buffer_len].copy_from_slice(&self.buffer[..self.buffer_len]);
                Self::encode_group(self.writer, &group, self.buffer_len)?;
            }
            Ok(())
        }
    }

    impl<W: Write> Write for Base64Encoder<'_, W> {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let mut pos = 0;
            // First, fill any partial buffer
            while self.buffer_len < 3 && pos < buf.len() {
                self.buffer[self.buffer_len] = buf[pos];
                self.buffer_len += 1;
                pos += 1;
            }
            if self.buffer_len == 3 {
                let b = self.buffer;
                Self::encode_group(self.writer, &b, 3)?;
                self.buffer_len = 0;
            }
            // Process remaining full groups
            while pos + 3 <= buf.len() {
                Self::encode_group(self.writer, &buf[pos..pos + 3], 3)?;
                pos += 3;
            }
            // Buffer remaining bytes
            while pos < buf.len() {
                self.buffer[self.buffer_len] = buf[pos];
                self.buffer_len += 1;
                pos += 1;
            }
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            self.writer.flush()
        }
    }
}
