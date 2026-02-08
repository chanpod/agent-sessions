# Agent Sessions - Claude Code Instructions

## ⛔ DESTRUCTIVE GIT COMMANDS - NEVER WITHOUT REVIEW ⛔

**NEVER run `git checkout <file>`, `git restore <file>`, or `git reset` to undo changes without these steps:**

1. **FIRST: Run `git diff <file>`** to see ALL changes in the file
2. **REVIEW the diff** - determine if the changes are ONLY yours or include the user's work
3. **If mixed changes exist:**
   - ❌ DO NOT run `git checkout` - this destroys the user's work!
   - ✅ USE the Edit tool to surgically revert only YOUR specific changes
   - ✅ OR ASK the user first before doing anything destructive
4. **If unsure, ALWAYS ASK** - "I need to revert my changes but I see other modifications. Should I proceed?"

**Why this matters:** `git checkout <file>` permanently destroys ALL uncommitted changes, not just yours. There is no undo. The user's work is gone forever.

## ⛔ Development Server Rules ⛔

**NEVER run the dev server.** Do not run `npm run dev`, `npm start`, `yarn dev`, or any variation that starts a development server.

### Whitelisted Build & Type Check Commands

The following commands ARE allowed:
- `npm run build` / `yarn build` - Production build
- `npm run typecheck` / `yarn typecheck` - TypeScript type checking
- `npx tsc --noEmit` - TypeScript check without emit
- `npx tsc` - TypeScript compilation
- `npm run lint` / `yarn lint` - Linting
- `npm test` / `yarn test` - Running tests

### Dev Server Output Log

The user runs the dev server separately with `pnpm dev:log`. This outputs to `.dev.log` (gitignored).

**To see dev server output (build errors, TypeScript errors, HMR updates):**
```bash
cat .dev.log        # Full log since server start
tail -n 100 .dev.log  # Last 100 lines
```

The log file is wiped on each server start, so it won't grow indefinitely.

## Windows Development Requirements

### Always Use Git Bash
This project assumes Git Bash is available on Windows. All terminal operations, including:
- Regular terminals
- Agent terminals (Claude, Codex, Gemini)
- Background processes

**MUST** use Git Bash (`bash.exe`), never PowerShell or cmd.exe directly. This ensures:
- Consistent PATH resolution for npm/pip installed tools
- Unix-like command compatibility
- Proper handling of CLI tools like `claude`, `codex`, `gemini`

When spawning processes on Windows, always use:
```typescript
shell = 'bash.exe'
shellArgs = ['-c', command]
```

Do NOT attempt to spawn CLI tools directly on Windows - they won't be found in the system PATH.

## Agent Session Architecture (Event Flow & Persistence)

Understanding this architecture is critical before modifying any agent-related code. Getting this wrong breaks session restoration silently.

### Two Event Paths (Only One Is Active)

The codebase has two agent event delivery systems. **Only the PTY/Detector path is used for agent spawning.** The AgentProcessManager path exists but is not wired to the spawn handler.

| Path | IPC Channel | Used? | Source |
|------|-------------|-------|--------|
| **PTY + Detector** | `detector:event` | **YES** | `pty-manager.ts` -> `StreamJsonDetector` -> renderer |
| AgentProcessManager | `agent:stream-event` | NO | `agent-process-manager.ts` (unused for spawning) |

**Do NOT try to capture data from `window.electron.agent.onStreamEvent` in the renderer** -- it receives nothing for agent sessions. All agent events arrive via `window.electron.detector.onEvent`.

### Agent Spawn Flow

```
electron/main.ts  ipcMain.handle('agent:spawn')
  -> ptyManager.createTerminal({ hidden: true, initialCommand: 'cat | claude -p ...' })
  -> PTY output flows through DetectorManager
  -> StreamJsonDetector parses NDJSON lines from Claude CLI
  -> Emits DetectorEvent objects on 'detector:event' IPC channel
  -> Renderer receives via window.electron.detector.onEvent()
```

### Session ID Lifecycle

The Claude CLI `session_id` is a stable UUID that persists across the entire conversation. It is generated once on the first message and reused for all `--resume` turns.

```
1. Claude CLI outputs: { type: 'system', subtype: 'init', session_id: '<uuid>' }
2. StreamJsonDetector emits: { type: 'agent-session-init', data: { sessionId: '<uuid>' } }
3. agent-stream-store captures it: setTerminalSession(terminalId, sessionId)
4. terminal-store persists it: updateConfigSessionId(terminalId, sessionId)
5. On restart: SavedTerminalConfig.sessionId is available for restoration
```

**Key files for session ID capture:**
- `electron/output-monitors/stream-json-detector.ts` -- emits `agent-session-init` from system init event
- `src/stores/agent-stream-store.ts` -- `subscribeToEvents()` detector handler captures it
- `src/stores/terminal-store.ts` -- `updateConfigSessionId()` persists to saved config

### Multi-Turn Conversations

Each user message after the first spawns a **new PTY process** with `--resume <sessionId>`. The session_id stays the same; only the process ID changes.

```
Turn 1: spawn process A -> captures sessionId -> messages in terminals[A]
Turn 2: spawn process B (--resume sessionId) -> messages in terminals[B]
Turn N: spawn process N (--resume sessionId) -> messages in terminals[N]
```

AgentWorkspace tracks all process IDs in `activeProcessIds` and merges messages from all of them into one conversation view.

### Session Persistence & Restoration

**What is persisted (survives app restart):**
- `SavedTerminalConfig` in terminal-store -- includes `sessionId`, `agentId`, `cwd`, etc.
- `PersistedSessionData` in agent-stream-store -- up to 50 completed messages per session, keyed by `sessionId`

**What is NOT persisted (runtime only):**
- `terminals` Map in agent-stream-store (process states, streaming messages)
- `terminalToSession` Map (rebuilt on restore)
- `agentProcesses` Map in App.tsx (rebuilt on restore)
- `activeProcessIds` in AgentWorkspace (starts fresh)

**Restoration flow on app restart (`App.tsx` restoreTerminals):**
```
1. Load SavedTerminalConfig[] from terminal-store
2. For each agent config with sessionId:
   a. Generate new terminalId (agent-restored-<timestamp>-<random>)
   b. Call restoreSessionToTerminal(newTerminalId, config.sessionId)
      -> Hydrates terminals Map with persisted messages
      -> Rebuilds terminalToSession mapping
   c. Add to agentProcesses Map with sessionId preserved
   d. Update SavedTerminalConfig with new terminalId
3. When user clicks session -> AgentWorkspace renders with resumeSessionId
4. On next message -> spawns new process with --resume <sessionId>
```

**`persistSession()` is called:**
- After every `agent-message-end` event (in `processEvent`)
- After every `agent:process-exit` event (in `subscribeToAgentProcessEvents`)

### Common Pitfalls

1. **Do not listen to `agent:stream-event`** for session data -- events go through `detector:event`
2. **Session ID != Message ID** -- Session IDs are UUIDs; message IDs start with `msg_`. The system init event carries the session ID; subsequent assistant events carry message IDs.
3. **`persistSession(terminalId)` requires a `terminalToSession` entry** -- if the mapping doesn't exist for that terminal, it silently fails. Only the initial process has this mapping.
4. **Electron main process changes require full app restart** -- HMR only covers renderer code. Changes to `electron/`, `pty-manager.ts`, or detectors require killing and restarting the app.

## Permission System (Hook-based IPC)

The app intercepts Claude CLI tool calls via a **PreToolUse hook** and routes permission decisions through a file-based IPC channel. This replaces the CLI's built-in permission prompts with our own UI (PermissionModal).

### Architecture Overview

```
Claude CLI (PreToolUse hook fires)
  → permission-handler.cjs runs
  → Checks: safe tool? allowlisted? app alive?
  → Writes .request file to .claude/.permission-ipc/
  → Polls for .response file (100ms interval, 30s timeout)

Electron main process (PermissionServer)
  → Polls .permission-ipc/ dirs every 200ms
  → Reads .request files → sends IPC to renderer
  → Renderer shows PermissionModal
  → User clicks Allow/Deny → writes .response file
  → Hook reads response → returns decision to CLI
```

### Key Files

| File | Role |
|------|------|
| `resources/bin/permission-handler.cjs` | **Bundled hook script** — copied to each project's `.claude/hooks/` on install |
| `electron/services/permission-server.ts` | **Main process** — polls IPC dirs, forwards to renderer, writes responses |
| `electron/constants.ts` | `PERMISSION_HOOK_FILENAME`, `PERMISSION_REQUEST_TIMEOUT_MS`, `PERMISSION_ALLOWLIST_FILENAME` |
| `electron/types/permission-types.ts` | TypeScript types for requests/responses |
| `src/stores/permission-store.ts` | Zustand store — `pendingRequests`, `hookInstalledCache` |
| `src/components/PermissionModal.tsx` | UI component — shows tool name/input, Allow/Deny buttons |

### Hook Decision Flow (permission-handler.cjs)

The hook script runs these gates in order:

1. **Heartbeat check** — Is the app alive? Reads `.permission-ipc/.active` timestamp. If stale (>10s) or missing, **abstain** (no stdout → CLI uses its own permission flow)
2. **HOST_HANDLED_TOOLS** — Currently empty. Would `deny` tools the app handles via custom UI
3. **SAFE_TOOLS** — Auto-`allow` read-only tools: `Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Task`, `TodoWrite`, `EnterPlanMode`, `ExitPlanMode`, `Skill`, `AskUserQuestion`
4. **Allowlist** — Auto-`allow` if tool is in `.claude/permission-allowlist.json`
5. **IPC handoff** — Write `.request` file, poll for `.response` from the app

### Critical: `.cjs` Extension Required

The hook script **MUST** use the `.cjs` extension, not `.js`. Projects with `"type": "module"` in `package.json` cause Node.js to treat `.js` files as ES modules, which breaks `require()` calls. When the hook crashes (exit code 1), the CLI silently falls through to its built-in permission system and denies everything. The `.cjs` extension forces CommonJS regardless of the project's module system.

### Heartbeat System

`PermissionServer.writeHeartbeats()` writes the current timestamp to `.permission-ipc/.active` every 3 seconds for each watched project. The hook checks this before doing anything — if the app isn't running, the hook abstains so the CLI's normal permission flow takes over.

**Implication:** If the app crashes, heartbeats go stale within 10 seconds and hooks automatically deactivate. If a dev and prod instance both run, they share the same IPC directory and can conflict.

### Hook Installation & Migration

- `PermissionServer.installHook(projectPath)` — Copies bundled script to `.claude/hooks/`, writes `settings.local.json` with the PreToolUse hook config
- `PermissionServer.isHookInstalled(projectPath)` — Checks if current `.cjs` version is in settings
- `PermissionServer.hasLegacyHook(projectPath)` — Detects old `.js` references for auto-migration
- `installHook` also cleans up old `.js` files and strips stale entries from both `settings.local.json` and `settings.json`
- The `permission:check-hook` IPC handler auto-migrates legacy `.js` hooks to `.cjs`

### Allowlist

`permission-allowlist.json` in the project's `.claude/` directory lists tool names that are always auto-allowed without showing the modal. Example: `["Bash", "Edit", "Write"]`. The PermissionServer checks this server-side in `handleRequest()`, and the hook script also checks it client-side in Gate 3.

### Common Issues

1. **Hook silently failing** — Usually means the hook script is crashing. Check `%TEMP%/permission-handler-debug.log` for the hook's debug output. Most common cause: `.js` extension in an ESM project.
2. **Permission denied but no modal appears** — Hook isn't firing (check `settings.local.json` has the correct command with `.cjs`), or heartbeat is stale (check `.permission-ipc/.active` exists and is recent).
3. **Circular blocking** — If you need to edit permission system files but the permission system is blocking edits, delete the `.permission-ipc/` directory for the project. The PermissionServer will stop watching it and the hook will abstain.
4. **Dev/prod conflict** — Both app instances share the same `.permission-ipc/` directories. If one crashes, the other's heartbeat may go stale or IPC files may conflict.

## shadcn/ui Components

Use the shadcn CLI to add components into this Vite + Electron repo. The project is already initialized with `components.json`.

Install a component:
```bash
pnpm dlx shadcn@latest add button
```

Notes:
- Components are written to `src/components/ui` with helpers in `src/lib/utils`.
- Styling is driven by `src/index.css` (Tailwind v4 CSS-first + shadcn preset).
- Icon library is Tabler; import from `@tabler/icons-react` if needed.
