use std::io::Read;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use log::{debug, info, warn};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::sync::broadcast;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Events emitted by PTY instances, delivered via a tokio broadcast channel.
#[derive(Clone, Debug)]
pub enum PtyEvent {
    /// Raw bytes produced by the terminal.
    Data {
        terminal_id: String,
        data: Vec<u8>,
        hidden: bool,
    },
    /// The terminal process exited.
    Exit {
        terminal_id: String,
        exit_code: Option<i32>,
        hidden: bool,
    },
}

/// Snapshot of terminal metadata (cheap to clone / serialize).
#[derive(Clone, Debug, serde::Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub pid: u32,
    pub shell: String,
    pub cwd: String,
    pub title: String,
    pub created_at: u64,
    pub hidden: bool,
}

/// Options accepted by [`PtyManager::create_terminal`].
#[derive(Default)]
pub struct CreateTerminalOptions {
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub id: Option<String>,
    pub hidden: bool,
    pub initial_command: Option<String>,
    pub title: Option<String>,
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/// Runtime state for a single terminal.
struct TerminalInstance {
    info: TerminalInfo,
    /// The master PTY handle – used for resize operations.
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    /// Writer obtained from the master – used for stdin writes.
    writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,
    /// Handle to the reader thread so we can join on dispose.
    _reader_handle: std::thread::JoinHandle<()>,
    /// Child process handle – kept alive so we can kill / wait on it.
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

// ---------------------------------------------------------------------------
// PtyManager
// ---------------------------------------------------------------------------

/// Manages multiple PTY instances, each running in its own OS thread.
///
/// Data produced by all terminals is multiplexed onto a single
/// [`broadcast::Sender<PtyEvent>`] so that any number of consumers
/// (stream-JSON detector, Tauri event emitter, etc.) can subscribe
/// via [`PtyManager::subscribe`].
pub struct PtyManager {
    terminals: DashMap<String, TerminalInstance>,
    event_tx: broadcast::Sender<PtyEvent>,
    /// Used to signal the background process monitor to stop.
    monitor_cancel: Arc<tokio::sync::Notify>,
}

/// Default broadcast channel capacity (number of events buffered before
/// slow receivers start lagging).
const DEFAULT_CHANNEL_CAPACITY: usize = 4096;

impl PtyManager {
    // --------------------------------------------------------------------
    // Construction
    // --------------------------------------------------------------------

    /// Create a new `PtyManager`.
    ///
    /// The background process monitor is **not** started here because the
    /// manager is typically wrapped in `Arc` by the caller. Call
    /// [`PtyManager::start_monitor`] after wrapping to launch it.
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(DEFAULT_CHANNEL_CAPACITY);

        Self {
            terminals: DashMap::new(),
            event_tx,
            monitor_cancel: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Start the global process monitor.
    ///
    /// Must be called after the manager is placed inside an `Arc` so we can
    /// hand a weak reference to the background task.
    pub fn start_monitor(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        let cancel = self.monitor_cancel.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(10)) => {}
                    _ = cancel.notified() => {
                        debug!("[PtyManager] process monitor cancelled");
                        break;
                    }
                }
                let Some(mgr) = weak.upgrade() else {
                    break;
                };
                mgr.check_processes().await;
            }
        });
    }

    /// Subscribe to the event broadcast channel.
    pub fn subscribe(&self) -> broadcast::Receiver<PtyEvent> {
        self.event_tx.subscribe()
    }

    // --------------------------------------------------------------------
    // Terminal lifecycle
    // --------------------------------------------------------------------

    /// Spawn a new PTY and return its [`TerminalInfo`].
    pub fn create_terminal(&self, options: CreateTerminalOptions) -> Result<TerminalInfo, String> {
        let terminal_id = options.id.unwrap_or_else(|| Uuid::new_v4().to_string());

        // Determine shell and arguments.
        let (shell_exe, shell_args) = if let Some(ref cmd) = options.initial_command {
            let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
            (sh, vec!["-l".into(), "-i".into(), "-c".into(), cmd.clone()])
        } else {
            let sh = options
                .shell
                .clone()
                .or_else(|| std::env::var("SHELL").ok())
                .unwrap_or_else(|| "/bin/bash".into());
            (sh, Vec::<String>::new())
        };

        // Agent terminals use very wide columns to prevent JSON line‐wrapping.
        let is_agent = options.hidden || options.initial_command.is_some();
        let cols = if is_agent { 10_000 } else { 80 };
        let rows = 24;

        let cwd = options
            .cwd
            .clone()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().to_string_lossy().into());

        // Build the command.
        let mut cmd = CommandBuilder::new(&shell_exe);
        for arg in &shell_args {
            cmd.arg(arg);
        }
        cmd.cwd(&cwd);

        // Inherit the current environment and add terminal‐related vars.
        // CommandBuilder inherits the process env by default.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // Create the PTY pair.
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows as u16,
                cols: cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        // Spawn the child process.
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {e}"))?;

        let pid = child.process_id().unwrap_or(0);

        // We no longer need the slave side after spawning.
        drop(pair.slave);

        // Determine the display title.
        let title = options.title.clone().unwrap_or_else(|| {
            if let Some(ref ic) = options.initial_command {
                ic.split_whitespace()
                    .next()
                    .unwrap_or(&shell_exe)
                    .to_string()
            } else {
                shell_exe
                    .rsplit('/')
                    .next()
                    .unwrap_or(&shell_exe)
                    .to_string()
            }
        });

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let info = TerminalInfo {
            id: terminal_id.clone(),
            pid,
            shell: options
                .initial_command
                .clone()
                .unwrap_or_else(|| shell_exe.clone()),
            cwd: cwd.clone(),
            title,
            created_at: now,
            hidden: options.hidden,
        };

        // Obtain reader and writer handles from the master.
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

        let pty_writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

        let master: Box<dyn MasterPty + Send> = pair.master;
        let master = Arc::new(Mutex::new(master));
        let writer = Arc::new(Mutex::new(pty_writer));

        let child = Arc::new(Mutex::new(child));

        // Spawn a dedicated OS thread for the blocking read loop.
        let tx = self.event_tx.clone();
        let tid = terminal_id.clone();
        let child_for_thread = Arc::clone(&child);
        let is_hidden = options.hidden;
        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-reader-{}", &tid[..8.min(tid.len())]))
            .spawn(move || {
                Self::reader_loop(tid, reader, tx, child_for_thread, is_hidden);
            })
            .map_err(|e| format!("Failed to spawn reader thread: {e}"))?;

        let instance = TerminalInstance {
            info: info.clone(),
            master,
            writer,
            _reader_handle: reader_handle,
            child,
        };

        self.terminals.insert(terminal_id.clone(), instance);
        info!(
            "[PtyManager] created terminal id={} pid={} agent={}",
            terminal_id, pid, is_agent
        );

        Ok(info)
    }

    /// Write data to a terminal's stdin.
    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let instance = self
            .terminals
            .get(id)
            .ok_or_else(|| format!("Terminal {id} not found"))?;
        let mut writer = instance.writer.lock();
        writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {e}"))?;
        writer.flush().map_err(|e| format!("Flush failed: {e}"))?;
        Ok(())
    }

    /// Write data in chunks with small delays to avoid overwhelming the PTY
    /// input buffer.  Returns when all chunks have been written.
    pub async fn write_chunked(
        &self,
        id: &str,
        data: &[u8],
        chunk_size: usize,
    ) -> Result<(), String> {
        if data.len() <= chunk_size {
            return self.write(id, data);
        }

        for chunk in data.chunks(chunk_size) {
            // Check the terminal is still alive before each chunk.
            if !self.terminals.contains_key(id) {
                return Err(format!("Terminal {id} was killed during chunked write"));
            }
            self.write(id, chunk)?;
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        Ok(())
    }

    /// Resize a terminal.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let instance = self
            .terminals
            .get(id)
            .ok_or_else(|| format!("Terminal {id} not found"))?;
        let master = instance.master.lock();
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {e}"))?;
        Ok(())
    }

    /// Kill a terminal and clean up its resources.
    pub fn kill(&self, id: &str) -> Result<(), String> {
        if let Some((_, instance)) = self.terminals.remove(id) {
            let mut child = instance.child.lock();
            let _ = child.kill();
            info!("[PtyManager] killed terminal {id}");
            Ok(())
        } else {
            Err(format!("Terminal {id} not found"))
        }
    }

    /// List all active terminals.
    pub fn list(&self) -> Vec<TerminalInfo> {
        self.terminals
            .iter()
            .map(|entry| entry.value().info.clone())
            .collect()
    }

    /// Dispose of all terminals and stop the process monitor.
    pub fn dispose(&self) {
        self.monitor_cancel.notify_one();

        let ids: Vec<String> = self
            .terminals
            .iter()
            .map(|entry| entry.key().clone())
            .collect();

        for id in ids {
            let _ = self.kill(&id);
        }

        info!("[PtyManager] disposed – all terminals cleaned up");
    }

    // --------------------------------------------------------------------
    // Internal helpers
    // --------------------------------------------------------------------

    /// Blocking read loop that runs on a dedicated OS thread.
    ///
    /// Reads raw bytes from the PTY and forwards them through the broadcast
    /// channel.  When the read returns EOF (or an error), emits an `Exit`
    /// event with the child's exit code.
    fn reader_loop(
        terminal_id: String,
        mut reader: Box<dyn Read + Send>,
        tx: broadcast::Sender<PtyEvent>,
        child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
        hidden: bool,
    ) {
        let mut buf = [0u8; 8192];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF – process has exited.
                    break;
                }
                Ok(n) => {
                    let _ = tx.send(PtyEvent::Data {
                        terminal_id: terminal_id.clone(),
                        data: buf[..n].to_vec(),
                        hidden,
                    });
                }
                Err(e) => {
                    // On Unix, EIO signals the child exited.
                    debug!(
                        "[PtyManager] reader error for {}: {} (kind={:?})",
                        terminal_id,
                        e,
                        e.kind()
                    );
                    break;
                }
            }
        }

        // Collect exit code.
        let exit_code = {
            let mut child = child.lock();
            match child.wait() {
                Ok(status) => Some(status.exit_code() as i32),
                Err(e) => {
                    warn!(
                        "[PtyManager] failed to wait on child for {}: {}",
                        terminal_id, e
                    );
                    None
                }
            }
        };

        info!(
            "[PtyManager] terminal {} exited with code {:?}",
            terminal_id, exit_code
        );
        let _ = tx.send(PtyEvent::Exit {
            terminal_id,
            exit_code,
            hidden,
        });
    }

    /// Check whether terminal child processes are still alive.
    /// Called periodically by the background monitor task.
    async fn check_processes(&self) {
        // Collect terminal IDs and PIDs that need checking.
        let entries: Vec<(String, u32)> = self
            .terminals
            .iter()
            .map(|e| (e.key().clone(), e.value().info.pid))
            .collect();

        if entries.is_empty() {
            return;
        }

        // On Unix we can send signal 0 to check if a process is alive
        // without actually delivering a signal.
        for (id, pid) in &entries {
            if *pid == 0 {
                continue;
            }
            #[cfg(unix)]
            {
                use nix::sys::signal::kill;
                use nix::unistd::Pid;
                // Signal 0 checks process existence without sending a real signal.
                if kill(Pid::from_raw(*pid as i32), None).is_err() {
                    // Process no longer exists -- the reader thread should
                    // handle cleanup, but log it.
                    debug!(
                        "[PtyManager] process monitor: pid {} for terminal {} is gone",
                        pid, id
                    );
                }
            }
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.dispose();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_and_list() {
        let mgr = Arc::new(PtyManager::new());
        mgr.start_monitor();

        let info = mgr
            .create_terminal(CreateTerminalOptions {
                initial_command: Some("echo hello".into()),
                hidden: true,
                ..Default::default()
            })
            .expect("should create terminal");

        assert!(!info.id.is_empty());
        assert!(!mgr.list().is_empty());

        // Give the process a moment to finish
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = mgr.kill(&info.id);
    }
}
