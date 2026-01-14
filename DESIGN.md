# Agent Sessions - Design Document

## Overview

Agent Sessions is a cross-platform desktop application for managing multiple terminal sessions, with a focus on AI agent workflows, development servers, and project management.

## Vision

A unified interface to visualize, manage, and interact with multiple terminal sessions across a project - treating servers, agent terminals, and worktrees as first-class citizens.

---

## Core Features

### 1. Multi-Terminal Management
- **Multiple concurrent terminal sessions** with independent PTY processes
- **Tab-based and/or split-pane layouts** for viewing multiple terminals
- **Session persistence** - restore sessions after restart
- **Terminal status indicators** - running, exited, busy, idle
- **Quick terminal switching** with keyboard shortcuts

### 2. Cross-Platform & Terminal Agnostic
- **Platform support**: Windows, macOS, Linux
- **WSL2 integration** on Windows - detect and launch WSL terminals
- **Shell flexibility**: bash, zsh, fish, PowerShell, CMD, etc.
- **Custom shell configurations** per project or globally

### 3. Server Management (First-Class)
- **Server detection** - auto-detect running dev servers (port scanning)
- **Server status dashboard** - health, port, PID, memory usage
- **Quick actions**: restart, stop, view logs
- **URL preview** - open server URLs in browser or embedded preview
- **Server grouping** - frontend, backend, databases, etc.

### 4. Git Worktree Visualization
- **Worktree list** - see all worktrees for the project
- **Branch context** - which branch each worktree is on
- **Quick switching** - open terminals in specific worktrees
- **Visual indicators** - dirty/clean status per worktree

---

## Stretch Features

### 5. Context Injection for Agent Sessions
- **Pre-defined context snippets** - inject common context into sessions
- **Project context** - automatically provide codebase structure, key files
- **Template commands** - one-click to inject complex commands
- **Environment context** - inject env vars, paths, project info
- **Clipboard integration** - easy paste of context from other sources

### 6. Code Peek / Editor Integration
- **VS Code integration** - open files directly from terminal output
- **Cursor integration** - same as VS Code
- **File path detection** - clickable file paths in terminal output
- **Error stack trace linking** - click errors to jump to source
- **Inline code preview** - hover to preview file contents
- **Integration methods**:
  - `code` CLI command for VS Code
  - `cursor` CLI command for Cursor
  - Custom protocol handlers
  - Extension-based integration

### 7. Session Recording & Playback
- **Record terminal sessions** - capture input/output
- **Playback sessions** - review what happened
- **Export sessions** - share as text, HTML, or video
- **Search session history** - find commands across all sessions

### 8. AI Agent Awareness
- **Agent detection** - recognize when an AI agent is running
- **Agent status** - thinking, executing, waiting for input
- **Agent metrics** - token usage, API calls, cost tracking
- **Context window visualization** - see what context the agent has

---

## Technical Architecture

### Stack
- **Runtime**: Electron 33+
- **Frontend**: React 19, TypeScript, Tailwind CSS 4
- **Terminal**: xterm.js with WebGL renderer
- **PTY**: node-pty for pseudo-terminal handling
- **State**: Zustand for application state
- **Build**: Vite with vite-plugin-electron

### Project Structure
```
agent-sessions/
├── electron/           # Electron main process
│   ├── main.ts         # Main entry point
│   ├── preload.ts      # IPC bridge
│   └── pty-manager.ts  # Terminal session management
├── src/                # React frontend
│   ├── components/     # UI components
│   ├── stores/         # Zustand stores
│   ├── lib/            # Utilities
│   └── App.tsx         # Main app
├── dist/               # Built frontend
├── dist-electron/      # Built Electron
└── release/            # Packaged apps
```

### IPC Communication
```
Renderer <--IPC--> Main Process <--PTY--> Shell
                         |
                         +--> File System
                         +--> System Info
                         +--> WSL Detection
```

---

## UI/UX Design

### Layout
```
┌────────────────────────────────────────────────────────┐
│  Agent Sessions                              [_ ][□][X]│
├────────────┬───────────────────────────────────────────┤
│            │  Terminal: bash [●]  /home/user/project   │
│ TERMINALS  ├───────────────────────────────────────────┤
│  > bash    │                                           │
│    zsh     │  $ npm run dev                            │
│            │  > vite v6.0.0                            │
│ SERVERS    │  > Local: http://localhost:5173          │
│  ○ 3000    │  > ready in 234ms                         │
│  ● 5173    │                                           │
│            │  $ _                                       │
│ WORKTREES  │                                           │
│  > main    │                                           │
│    feature │                                           │
│            │                                           │
├────────────┼───────────────────────────────────────────┤
│ ⚙ Settings │                               PID: 12345 │
└────────────┴───────────────────────────────────────────┘
```

### Color Palette (Dark Theme)
- Background: `#09090b` (zinc-950)
- Surface: `#18181b` (zinc-900)
- Border: `#27272a` (zinc-800)
- Text: `#fafafa` (zinc-50)
- Muted: `#a1a1aa` (zinc-400)
- Primary: `#3b82f6` (blue-500)
- Success: `#22c55e` (green-500)
- Warning: `#f59e0b` (amber-500)
- Error: `#ef4444` (red-500)

---

## Implementation Phases

### Phase 1: Foundation (Current)
- [x] Project scaffolding
- [x] Electron + React + Vite setup
- [x] Basic terminal component
- [x] Multi-session management
- [ ] Install dependencies and verify build

### Phase 2: Core Terminal Features
- [ ] Terminal tabs and switching
- [ ] Split pane layouts
- [ ] Keyboard shortcuts
- [ ] Session persistence
- [ ] Shell selection

### Phase 3: Server Management
- [ ] Server detection (port scanning)
- [ ] Server status display
- [ ] Quick actions (restart, stop)
- [ ] URL handling

### Phase 4: Worktree Support
- [ ] Git worktree detection
- [ ] Worktree list UI
- [ ] Open terminal in worktree
- [ ] Branch status

### Phase 5: Editor Integration
- [ ] File path detection in terminal
- [ ] VS Code integration
- [ ] Cursor integration
- [ ] Error stack linking

### Phase 6: Context Injection
- [ ] Context panel UI
- [ ] Snippet management
- [ ] Project context generation
- [ ] Quick inject commands

### Phase 7: Advanced Features
- [ ] Session recording
- [ ] Agent detection
- [ ] Metrics dashboard
- [ ] WSL2 deep integration

---

## Open Questions

1. **Session persistence format** - JSON file? SQLite? How to handle sensitive data?
2. **Server detection** - Polling vs file watching vs process monitoring?
3. **Editor integration** - CLI-based or extension-based? Both?
4. **Context injection** - Pre-built snippets vs AI-generated context?
5. **Multi-window support** - Single window or allow multiple windows?

---

## References

- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [node-pty](https://github.com/microsoft/node-pty) - Pseudo-terminal bindings
- [Electron](https://www.electronjs.org/) - Desktop framework
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) - CSS framework
- [shadcn/ui](https://ui.shadcn.com/) - Component library (Tailwind v4 compatible)
