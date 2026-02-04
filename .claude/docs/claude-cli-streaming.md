# Claude CLI JSON Streaming Integration

This document covers the implementation details and learnings from integrating Claude CLI's JSON streaming mode into the Agent Sessions app.

## Overview

The Claude CLI supports a JSON streaming mode for programmatic interaction:

```bash
claude -p --verbose --input-format stream-json --output-format stream-json
```

### Key Flags

| Flag | Purpose |
|------|---------|
| `-p` / `--print` | Non-interactive mode - processes input and exits |
| `--verbose` | **Required** when using `--output-format=stream-json` with `-p` |
| `--input-format stream-json` | Accept NDJSON input on stdin |
| `--output-format stream-json` | Emit NDJSON events on stdout |
| `--resume <session_id>` | Resume a previous session (for multi-turn) |

## Input Format (CRITICAL!)

Messages sent to stdin must be NDJSON (newline-delimited JSON) with the **FULL** format:

```json
{"type":"user","message":{"role":"user","content":"Hello"},"session_id":"default","parent_tool_use_id":null}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"user"` | Message type identifier |
| `message` | object | Contains `role` and `content` |
| `message.role` | `"user"` | Role identifier |
| `message.content` | string | The actual user message |
| `session_id` | string | Session identifier (use actual session_id for --resume, or `"default"`) |
| `parent_tool_use_id` | null | Tool use context (null for user messages) |

### ⚠️ Common Mistakes

1. **Missing `session_id`**: Without this field, Claude may receive garbage input
2. **Missing `parent_tool_use_id`**: Must be explicitly set to `null`
3. **Using minimal format**: `{"type":"user","message":{...}}` alone is **NOT sufficient**

### TypeScript Implementation

```typescript
const fullMessage = {
  type: 'user',
  message: {
    role: 'user',
    content: userInput,
  },
  session_id: agentInfo.sessionId || 'default',
  parent_tool_use_id: null,
}
ptyManager.write(id, JSON.stringify(fullMessage) + '\n')
```

## Output Events

The CLI emits three main event types in print mode:

### 1. System Init Event
```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "uuid-here",
  "model": "claude-opus-4-5-20251101",
  "cwd": "C:\\path\\to\\project",
  "tools": ["Task", "Bash", "Read", ...],
  ...
}
```

### 2. Assistant Response Event
```json
{
  "type": "assistant",
  "message": {
    "id": "msg_xxx",
    "model": "claude-opus-4-5-20251101",
    "role": "assistant",
    "content": [
      {"type": "text", "text": "Hello! How can I help?"}
    ],
    "usage": {...}
  },
  "session_id": "uuid-here"
}
```

### 3. Result Event
```json
{
  "type": "result",
  "subtype": "success",
  "result": "Hello! How can I help?",
  "session_id": "uuid-here",
  "duration_ms": 2116,
  "total_cost_usd": 0.06,
  "usage": {...}
}
```

## Critical: stdin Must Close

**The CLI waits for stdin EOF before processing.** This means:

1. Send the user message
2. **Call `stdin.end()`** to close stdin
3. CLI processes and responds
4. Process exits with code 0

For interactive back-and-forth, you cannot keep stdin open. Each turn requires a new process.

## Multi-Turn Conversations

Since each message requires closing stdin (and process exit), multi-turn uses `--resume`:

```bash
# First message
claude -p --verbose --input-format stream-json --output-format stream-json
# Capture session_id from response

# Follow-up message
claude -p --verbose --input-format stream-json --output-format stream-json --resume <session_id>
```

### Implementation Pattern

1. Spawn process, send message, close stdin
2. Capture `session_id` from `system.init` event
3. For follow-up: spawn NEW process with `--resume <session_id>`
4. Track all process IDs to merge their events into one conversation

## Windows: Git Bash vs WSL

On Windows with WSL installed, `bash.exe` may resolve to WSL's bash instead of Git Bash. This causes errors like:

```
/mnt/c/nvm4w/nodejs/claude: exec: node: not found
```

**Solution:** Use the full path to Git Bash:

```typescript
const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'
const shell = isWindows ? gitBashPath : '/bin/bash'
```

We have a helper `getGitBashPath()` in `cli-detector.ts` that checks common install locations.

## Event Transformation

The CLI's print-mode events (`system`, `assistant`, `result`) differ from the raw API streaming events. We transform them to a normalized `agent-*` format:

| CLI Event | Transformed Event |
|-----------|-------------------|
| `system` (init) | `agent-message-start` |
| `assistant` | `agent-text-delta` (per content block) |
| `result` | `agent-message-end` |

This allows the UI store to handle events uniformly regardless of source.

## Architecture Summary

```
┌─────────────────┐     spawn      ┌──────────────┐
│ AgentWorkspace  │ ───────────────▶│ Claude CLI   │
│   (React)       │                 │  Process     │
└────────┬────────┘                 └──────┬───────┘
         │                                  │
         │ sendMessage                      │ stdout (NDJSON)
         ▼                                  ▼
┌─────────────────┐  stdin.write   ┌──────────────┐
│ AgentProcess    │ ◀──────────────│ Transform &  │
│   Manager       │ ───────────────▶│ Emit Events  │
└─────────────────┘  stdin.end()   └──────────────┘
                                           │
                                           ▼
                                   ┌──────────────┐
                                   │ agent-stream │
                                   │    -store    │
                                   └──────────────┘
```

## Files Changed

- `electron/agent-process-manager.ts` - Process spawning, event transformation
- `electron/services/cli-detector.ts` - Git Bash path detection, exported `getGitBashPath()`
- `electron/main.ts` - IPC handlers for spawn/sendMessage
- `electron/preload.ts` - Exposed spawn/sendMessage to renderer
- `src/components/agent/AgentWorkspace.tsx` - Multi-turn state management
- `src/stores/agent-stream-store.ts` - Event processing
- `src/types/electron.d.ts` - TypeScript definitions

## Gotchas

1. **`--verbose` is required** with `-p` and `--output-format=stream-json`
2. **stdin must close** for processing to begin (for child process approach, not PTY)
3. **Use full Git Bash path** on Windows to avoid WSL
4. **CRITICAL: Full message format required**: `{type, message: {role, content}, session_id, parent_tool_use_id: null}` - missing fields cause garbage input!
5. **Track session_id** from first response for `--resume`
6. **zustand selectors** that create new arrays cause infinite loops - use `useShallow`
7. **PTY approach**: For PTY-based agents, the command runs with `-` at the end to read from stdin continuously
8. **Wait after spawn**: When spawning a new process with --resume, wait ~500ms before sending message

## PTY vs Child Process Approach

This project uses **PTY-based agents** for real-time streaming:

| Aspect | PTY Approach | Child Process Approach |
|--------|-------------|----------------------|
| stdin handling | Write directly, no need to close | Must call `stdin.end()` |
| Command | `claude -p ... -` (trailing dash for stdin) | `claude -p ...` |
| Events channel | `detector:event` | `agent:stream-event` |
| Process lifecycle | Stays open until killed or response complete | Exits after stdin closes |

### PTY Command Format

```bash
claude -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages -
```

The trailing `-` tells Claude to read from stdin. For resume:

```bash
claude -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages --resume <session_id> -
```
