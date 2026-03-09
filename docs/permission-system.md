# ToolChain Permission System

## Overview

ToolChain provides a unified permission system that intercepts tool calls from CLI coding agents (Claude, Gemini, Codex) and lets users approve or deny them in real-time. The system replaces the legacy file-based IPC hook approach with an embedded HTTP server.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ ToolChain App (Tauri v2)                                │
│                                                         │
│  ┌──────────────────┐   ┌──────────────────────────┐   │
│  │ Permission Server │   │ Permission Manager       │   │
│  │ (axum HTTP)       │──▶│ (rules, pending reqs,    │   │
│  │ 127.0.0.1:<port>  │   │  auto-allow evaluation)  │   │
│  └────────┬─────────┘   └──────────────────────────┘   │
│           │                                             │
│           │ Tauri emit("permission:request")            │
│           ▼                                             │
│  ┌──────────────────┐   ┌──────────────────────────┐   │
│  │ Frontend UI       │──▶│ invoke("respond_to_      │   │
│  │ (PermissionModal) │   │  permission")             │   │
│  └──────────────────┘   └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         ▲
         │ HTTP POST /permission
         │
┌────────┴────────┐    ┌──────────────┐    ┌─────────────┐
│ Claude CLI      │    │ Gemini CLI   │    │ Codex CLI   │
│ (HTTP hook)     │    │ (cmd hook    │    │ (static     │
│                 │    │  via curl)   │    │  rules only)│
└─────────────────┘    └──────────────┘    └─────────────┘
```

## How It Works

### 1. App Startup

1. **Permission Manager** initializes with DashMap-based concurrent state
2. **Permission Server** starts on `127.0.0.1:0` (random port), generates auth token
3. Server writes `~/.local/share/toolchain/server.json` with port + token
4. **Hook Installer** updates `~/.claude/settings.json` with HTTP hook pointing to our server

### 2. Permission Flow (Claude CLI)

```
Claude CLI wants to use "Bash" tool
  → PreToolUse hook fires
  → HTTP POST to http://127.0.0.1:{port}/permission
    Body: { session_id, tool_name, tool_input, cwd, ... }
    Header: Authorization: Bearer {token}
  → Permission Server receives request
  → Validates auth token
  → Checks auto-allow rules:
    - Safe tools (Read, Glob, Grep, etc.) → allow immediately
    - Bash rules match → allow immediately
    - Tool in allowlist → allow immediately
  → If not auto-allowed:
    - Creates oneshot channel for response
    - Emits "permission:request" to frontend
    - Frontend shows PermissionModal
    - User clicks Allow/Deny
    - Frontend invokes "respond_to_permission"
    - Server resolves the oneshot, returns HTTP response
  → Claude CLI receives: { hookSpecificOutput: { permissionDecision: "allow"|"deny" } }
  → Tool executes or is denied
```

### 3. Sub-Agent Handling

When Claude's `Agent` tool spawns a sub-agent, the sub-agent's tool calls also trigger the `PreToolUse` hook. The hook fires with the sub-agent's context, and our server handles it identically — no process control needed. Each tool call gets its own HTTP request/response cycle, so denying a sub-agent's tool doesn't affect the parent or other sub-agents.

## CLI Support Matrix

### Claude CLI (Implemented)

- **Hook type**: Native HTTP hook (`type: "http"`)
- **Config location**: `~/.claude/settings.json`
- **Hook event**: `PreToolUse`
- **Response format**: `{ hookSpecificOutput: { permissionDecision: "allow"|"deny" } }`
- **Must return HTTP 200**: Non-2xx = non-blocking error (execution continues)
- **Sub-agent support**: Full — hook fires for all tool calls including from sub-agents

### Gemini CLI (Planned)

- **Hook type**: Command hook via `curl`
- **Config location**: `~/.gemini/settings.json`
- **Hook event**: `BeforeTool`
- **Response format**: Exit code 0 = allow, exit code 2 = deny (stderr = reason)
- **Matchers**: Regex patterns on tool names
- **Implementation**: Add `/gemini/permission` endpoint, install curl-based hook

```json
{
  "hooks": {
    "BeforeTool": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "curl -sf -X POST -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d @- http://127.0.0.1:PORT/gemini/permission",
        "timeout": 120000
      }]
    }]
  }
}
```

### Codex CLI (Limited)

Codex CLI **does not have a hook system** for per-tool-call interception. Options:

- **Static rules**: Use Codex's `approval_policy` and `execpolicy` rules in `~/.codex/config.toml`
- **Approval modes**: Map ToolChain's permission config to `--approval-mode` flag
- **Accept built-in modes**: `suggest` (ask for everything), `auto-edit` (auto files, ask commands), `full-auto` (auto everything)

## Key Files

### Rust Backend

| File | Purpose |
|------|---------|
| `src-tauri/src/permission_manager.rs` | Rule engine, auto-allow evaluation, allowlist persistence, pending request tracking |
| `src-tauri/src/permission_server.rs` | Axum HTTP server, Claude/Gemini hook endpoints, Tauri event emission |
| `src-tauri/src/hook_installer.rs` | Install/update/remove hooks in CLI settings files |
| `src-tauri/src/commands.rs` | Tauri IPC commands for permission operations |

### Frontend

| File | Purpose |
|------|---------|
| `src/lib/tauri-api.ts` | Permission namespace (respond, checkHook, installHook, rules CRUD, event listeners) |
| `src/stores/permission-store.ts` | Zustand store for pending requests and hook status |
| `src/components/PermissionModal.tsx` | Interactive approval dialog with bash token selector |
| `src/components/HookInstallPrompt.tsx` | One-time setup prompt for hook installation |
| `src/hooks/useBashRules.ts` | Hook for checking auto-allow rules and revoking permissions |

## Auto-Allow Rules

### Safe Tools (Always Allowed)

These tools are read-only or non-destructive and never prompt the user:

- `Read`, `Glob`, `Grep` — file reading/searching
- `WebSearch`, `WebFetch` — web queries
- `Task`, `TodoWrite` — task management
- `EnterPlanMode`, `ExitPlanMode` — planning
- `Skill`, `AskUserQuestion` — meta tools

### Bash Rules

Users can create granular rules for shell commands:

```json
{
  "bashRules": [
    ["git", "status"],           // Exact command
    ["npm", "test", "*"],        // Prefix with wildcard
    ["cargo", "build", "*"]      // Any cargo build variant
  ]
}
```

Compound commands (using `&&`, `||`, `|`, `;`) are split into sub-commands. **Every sub-command must match a rule** for the full command to be auto-allowed.

### Tool Allowlist

Users can blanket-allow specific tools:

```json
{
  "tools": ["Edit", "Write"]
}
```

### Rule Evaluation Order

1. Safe tools check (hardcoded, not configurable)
2. Bash rules check (for Bash tool only)
3. Tool allowlist check
4. → User prompt (if none matched)

## Security

- **Auth token**: Random token generated per app session, required in `Authorization: Bearer` header
- **Localhost only**: Server binds to `127.0.0.1`, not accessible from network
- **Timeout**: Pending requests expire after 120 seconds (denied by default)
- **No file pollution**: All config in `~/.local/share/toolchain/` and user-level CLI settings
- **Always HTTP 200**: For Claude hooks, we always return 200 to prevent the agent from proceeding uncontrolled on error

## Migration from Legacy System

The legacy system used:
- Per-project hook script at `.claude/hooks/permission-handler.cjs`
- File-based IPC via `.claude/.permission-ipc/` (request/response files)
- 200ms polling interval
- Per-project `settings.local.json` modifications

The `cleanup_legacy_project_hooks` command removes these artifacts when called on a project path. The new system requires no per-project files.
