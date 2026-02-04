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
