use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{interval, Duration};
use serde::Serialize;

/// Batched event payload sent to frontend
#[derive(Debug, Clone, Serialize)]
pub struct EventBatch {
    pub terminal_id: String,
    pub events: Vec<crate::stream_parser::AgentEvent>,
}

pub struct EventBatcher {
    tx: mpsc::UnboundedSender<(String, crate::stream_parser::AgentEvent)>,
}

impl EventBatcher {
    /// Create a new batcher that flushes every `flush_interval_ms` milliseconds.
    /// Spawns a background tokio task that collects events and emits them as batches.
    pub fn new(app_handle: AppHandle, flush_interval_ms: u64) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<(String, crate::stream_parser::AgentEvent)>();

        tauri::async_runtime::spawn(async move {
            let mut pending: HashMap<String, Vec<crate::stream_parser::AgentEvent>> =
                HashMap::new();
            let mut tick = interval(Duration::from_millis(flush_interval_ms));

            loop {
                tokio::select! {
                    // Receive the first available event
                    Some((terminal_id, event)) = rx.recv() => {
                        pending.entry(terminal_id).or_default().push(event);
                        // Drain all remaining events that are ready right now so
                        // we batch as many as possible before the next tick.
                        while let Ok((tid, evt)) = rx.try_recv() {
                            pending.entry(tid).or_default().push(evt);
                        }
                    }
                    // Flush on interval
                    _ = tick.tick() => {
                        if !pending.is_empty() {
                            let batches: Vec<EventBatch> = pending.drain()
                                .map(|(terminal_id, events)| EventBatch { terminal_id, events })
                                .collect();
                            let total_events: usize = batches.iter().map(|b| b.events.len()).sum();
                            log::info!(
                                "[batcher] Flushing {} batches ({} total events) to frontend",
                                batches.len(),
                                total_events
                            );
                            // Single IPC call for ALL terminals
                            match app_handle.emit("agent:events-batch", &batches) {
                                Ok(_) => log::debug!("[batcher] emit succeeded"),
                                Err(e) => log::error!("[batcher] emit FAILED: {}", e),
                            }
                        }
                    }
                }
            }
        });

        Self { tx }
    }

    /// Queue an event for batched delivery. This is non-blocking.
    pub fn queue(&self, terminal_id: String, event: crate::stream_parser::AgentEvent) {
        let _ = self.tx.send((terminal_id, event));
    }
}
