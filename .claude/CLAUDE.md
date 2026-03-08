# ToolChain - Claude Code Instructions

## Architecture Overview

ToolChain is a **Tauri v2** desktop app (Rust backend + React frontend) that manages multiple Claude CLI agent sessions with terminal support. It targets **Linux and macOS only** (no Windows/WSL support).

- **Backend**: Rust (Tauri v2) — PTY management, NDJSON stream parsing, session state, event batching
- **Frontend**: React + TypeScript + Tailwind v4 + shadcn/ui — renders in the system webview
- **IPC**: Tauri's invoke/emit system (replaces Electron's ipcMain/ipcRenderer)
- **Compatibility layer**: `src/lib/tauri-api.ts` sets `window.electron` so existing React components work unchanged

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `src-tauri/src/` | Rust backend — all PTY, parsing, state, and IPC command logic |
| `src/` | React frontend — components, stores (Zustand), hooks |
| `src/lib/tauri-api.ts` | Drop-in `window.electron` adapter routing through Tauri APIs |
| `electron/` | **Legacy Electron code** — NOT used by Tauri build, kept for reference only |

### Rust Modules

| Module | Purpose |
|--------|---------|
| `pty_manager.rs` | PTY lifecycle via `portable-pty`, broadcast channels, process monitoring |
| `stream_parser.rs` | NDJSON parser — extracts structured `AgentEvent`s from Claude CLI output |
| `session_state.rs` | DashMap-based concurrent state — messages, context usage, tool tracking |
| `event_batcher.rs` | 16ms batched event delivery to frontend (~60fps) |
| `bridge.rs` | Wires PTY → StreamParser → SessionManager → EventBatcher pipeline |
| `commands.rs` | Tauri IPC command handlers (terminals, agents, session queries) |
| `lib.rs` | App setup and initialization |

## ⛔ DESTRUCTIVE GIT COMMANDS - NEVER WITHOUT REVIEW ⛔

**NEVER run `git checkout <file>`, `git restore <file>`, or `git reset` to undo changes without these steps:**

1. **FIRST: Run `git diff <file>`** to see ALL changes in the file
2. **REVIEW the diff** — determine if the changes are ONLY yours or include the user's work
3. **If mixed changes exist:**
   - DO NOT run `git checkout` — this destroys the user's work!
   - USE the Edit tool to surgically revert only YOUR specific changes
   - OR ASK the user first before doing anything destructive
4. **If unsure, ALWAYS ASK**

## ⛔ Development Server Rules ⛔

**NEVER run the dev server.** Do not run `pnpm dev`, `pnpm tauri:dev`, `cargo tauri dev`, or any variation.

### Whitelisted Commands

- `pnpm build:frontend` — Vite production build (outputs to `dist/`)
- `source ~/.cargo/env && cargo build --manifest-path src-tauri/Cargo.toml` — Rust debug build
- `source ~/.cargo/env && cargo tauri build` — Full release build (frontend + Rust + bundles)
- `pnpm typecheck` / `npx tsc --noEmit` — TypeScript type checking
- `pnpm lint` — Linting
- `pnpm test` — Running tests
- `source ~/.cargo/env && cargo test --manifest-path src-tauri/Cargo.toml` — Rust tests

**Important:** Rust/cargo commands require `source ~/.cargo/env` first — cargo is not in the default PATH.

### Dev Server Output Log

The user runs the dev server separately. Tauri dev mode (`cargo tauri dev`) starts both Vite (port 1420) and the Rust backend with hot reload:
- **Frontend changes** (React/CSS/TS in `src/`): Hot-reloaded via Vite HMR, no restart needed
- **Rust changes** (`src-tauri/src/`): Auto-recompiled by Tauri watcher, restarts backend (~3-8s)

## Agent Session Architecture

### Data Pipeline (Hot Path)

```
PTY (OS thread) → broadcast channel → bridge task:
  1. Raw data → base64 → emit "pty:data" (for xterm.js, non-hidden terminals only)
  2. Raw data → StreamParser (NDJSON → AgentEvent[])
  3. AgentEvents → SessionManager (update DashMap state)
  4. AgentEvents → EventBatcher (queue for 16ms batched delivery)
  5. EventBatcher → emit "agent:events-batch" (single IPC call per flush)
```

### Agent Spawn Flow

```
Frontend: invoke("spawn_agent", { project_path, model, ... })
  → commands::spawn_agent builds: "cat | claude -p --verbose --input-format stream-json --output-format stream-json --model <model>"
  → pty_manager::create_terminal({ hidden: true, cols: 10000, initial_command: cmd })
  → PTY reader thread pushes PtyEvent::Data to broadcast channel
  → bridge picks up events and runs the pipeline above
  → Frontend receives via Tauri listen("agent:events-batch")
  → tauri-api.ts converts AgentEventBatch → DetectorEvent format
  → agent-stream-store processes batch
```

### Session ID Lifecycle

The Claude CLI `session_id` persists across the entire conversation. Generated on first message, reused for `--resume` turns.

```
1. Claude CLI outputs: { type: "system", subtype: "init", session_id: "<uuid>" }
2. StreamParser emits: AgentEvent::SessionInit { session_id, model }
3. SessionManager stores it
4. Frontend captures via events-batch → persists to store
5. On resume: spawn_agent called with session_id → "--resume <sessionId>"
```

### Multi-Turn Conversations

Each user message after the first spawns a **new PTY process** with `--resume <sessionId>`. The session_id stays the same; only the terminal/process changes.

### Key Types

```rust
// stream_parser.rs
pub enum AgentEvent {
    SessionInit { session_id, model },
    MessageStart { message_id, model, usage },
    TextDelta { message_id, block_index, text },
    ThinkingDelta { message_id, block_index, text },
    ToolStart { message_id, block_index, tool_id, name },
    ToolInputDelta { message_id, block_index, partial_json },
    ToolResult { tool_id, result, is_error },
    BlockEnd { message_id, block_index },
    MessageEnd { message_id, model, stop_reason, usage },
    SessionResult { subtype, total_cost_usd, duration_ms, usage },
    SystemEvent { subtype },
    ProcessExit { exit_code },
}
```

### Concurrency Model

- **PTY readers**: Dedicated OS threads (blocking reads can't go on tokio async runtime)
- **Event pipeline**: Single tokio task per broadcast subscriber (sequential processing)
- **Session state**: `DashMap` for lock-free concurrent access (no Mutex contention)
- **Stream parser**: `parking_lot::Mutex` (only accessed from the single pipeline task)
- **Event batcher**: `mpsc::unbounded_channel` + `tokio::select!` with 16ms interval

### Important: `tauri::async_runtime::spawn` not `tokio::spawn`

All async task spawning during Tauri `setup()` must use `tauri::async_runtime::spawn`, not bare `tokio::spawn`. The tokio runtime isn't available as a thread-local during setup. This applies to:
- `PtyManager::start_monitor()`
- `bridge::start_event_pipeline()`
- `EventBatcher::new()`

## Frontend Compatibility Layer

`src/lib/tauri-api.ts` provides a `window.electron` shim so the React frontend works without changes. It:
- Routes `invoke()` calls to Tauri's `@tauri-apps/api/core`
- Converts `listen()` events to the callback patterns the frontend expects
- Decodes base64 PTY data back to text for xterm.js
- Converts Rust `AgentEvent` format to the `DetectorEvent` format stores expect
- Uses `@tauri-apps/plugin-store` for persistence
- Stubs unimplemented features (git, ssh, docker) via Proxy objects

### What's NOT Implemented Yet (Stubbed)

- Permission system (was Electron file-based IPC hooks)
- SSH remote terminals
- Git status watching
- Docker integration

## Build & Release

```bash
# Frontend only
pnpm build:frontend

# Rust only (debug)
source ~/.cargo/env && cargo build --manifest-path src-tauri/Cargo.toml

# Full release (frontend + Rust + .deb/.rpm/.AppImage bundles)
source ~/.cargo/env && cargo tauri build

# Run Rust tests
source ~/.cargo/env && cargo test --manifest-path src-tauri/Cargo.toml
```

Release binary: ~12MB with LTO (vs ~250MB Electron). Produces .deb, .rpm, and .AppImage bundles.

Release profile: LTO enabled, codegen-units=1, strip=true, opt-level=3.

## shadcn/ui Components

```bash
pnpm dlx shadcn@latest add button
```

- Components: `src/components/ui/`
- Helpers: `src/lib/utils`
- Styling: `src/index.css` (Tailwind v4 CSS-first + shadcn preset)
- Icons: `@tabler/icons-react`
