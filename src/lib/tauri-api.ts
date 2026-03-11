/**
 * Tauri API adapter - replaces the Electron preload API (window.electron)
 *
 * This module provides the same interface as the Electron preload so that
 * existing React components can work with minimal changes. Instead of
 * ipcRenderer.invoke(), we use Tauri's invoke(). Instead of ipcRenderer.on(),
 * we use Tauri's listen().
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'

// Re-export types that match the existing codebase
export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  title: string
  createdAt: number
  hidden?: boolean
}

export interface DetectorEvent {
  terminalId: string
  type: string
  timestamp: number
  data: any
}

export interface SystemInfo {
  platform: string
  arch: string
  version: string
  cwd: string
}

export interface AgentEventBatch {
  terminal_id: string
  events: AgentEvent[]
}

export interface AgentEvent {
  type: string
  data: any
}

// Base64 decode utility for PTY data
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Convert snake_case object keys to camelCase (shallow).
 * Rust serde serializes struct fields as snake_case by default,
 * but the frontend stores expect camelCase (messageId, blockIndex, etc.).
 */
function snakeToCamelCase(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(snakeToCamelCase)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    // Recursively convert nested objects (e.g. usage { input_tokens → inputTokens })
    result[camelKey] = (value !== null && typeof value === 'object') ? snakeToCamelCase(value) : value
  }
  return result
}

/**
 * The Tauri API object that replaces window.electron.
 * Compatible with the existing preload interface.
 */
export const tauriAPI = {
  pty: {
    create: (options: {
      cwd?: string
      shell?: string
      id?: string
      initialCommand?: string
      title?: string
    }): Promise<TerminalInfo> =>
      invoke('create_terminal', {
        cwd: options.cwd,
        shell: options.shell,
        id: options.id,
        hidden: false,
        initialCommand: options.initialCommand,
        title: options.title,
      }),

    write: (id: string, data: string): Promise<void> =>
      invoke('write_terminal', { terminalId: id, data }),

    resize: (id: string, cols: number, rows: number): Promise<void> =>
      invoke('resize_terminal', { terminalId: id, cols, rows }),

    kill: (id: string): Promise<void> =>
      invoke('kill_terminal', { terminalId: id }),

    list: (): Promise<TerminalInfo[]> =>
      invoke('list_terminals'),

    onData: (callback: (id: string, data: string) => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      listen<{ terminalId: string; data: string }>('pty:data', (event) => {
        // Decode base64 data back to string for xterm.js
        const bytes = base64ToUint8Array(event.payload.data)
        const text = new TextDecoder().decode(bytes)
        callback(event.payload.terminalId, text)
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },

    onExit: (callback: (id: string, code: number) => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      listen<{ terminalId: string; exitCode: number | null }>('pty:exit', (event) => {
        callback(event.payload.terminalId, event.payload.exitCode ?? -1)
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },

    onTitleChange: (_callback: (id: string, title: string) => void): (() => void) => {
      // TODO: Implement title change detection in Rust
      return () => {}
    },
  },

  detector: {
    onEvent: (_callback: (event: DetectorEvent) => void): (() => void) => {
      // Individual events not used — we use batched events
      return () => {}
    },

    onEventBatch: (callback: (events: DetectorEvent[]) => void): (() => void) => {
      console.log('[TauriAPI] onEventBatch: subscribing to agent:events-batch')
      let unlisten: UnlistenFn | null = null
      listen<AgentEventBatch[]>('agent:events-batch', (event) => {
        console.log('[TauriAPI] agent:events-batch received:', event.payload.length, 'batches',
          event.payload.map(b => `${b.terminal_id}: ${b.events.length} events`))
        // Convert Rust event batches to the DetectorEvent format the frontend expects.
        // Rust serializes enum variants as e.g. "session_init", "text_delta"
        // but the frontend expects "agent-session-init", "agent-text-delta", etc.
        const detectorEvents: DetectorEvent[] = []
        for (const batch of event.payload) {
          for (const agentEvent of batch.events) {
            const frontendType = 'agent-' + agentEvent.type.replace(/_/g, '-')
            // Convert snake_case data keys to camelCase (Rust serde → JS convention)
            const camelData = snakeToCamelCase(agentEvent.data)
            detectorEvents.push({
              terminalId: batch.terminal_id,
              type: frontendType,
              timestamp: Date.now(),
              data: camelData,
            })
          }
        }
        if (detectorEvents.length > 0) {
          callback(detectorEvents)
        }
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },
  },

  system: {
    getShells: async (_projectPath?: string): Promise<Array<{ name: string; path: string }>> => {
      // Return common Unix shells
      const shells = [
        { name: 'bash', path: '/bin/bash' },
        { name: 'zsh', path: '/bin/zsh' },
        { name: 'fish', path: '/usr/bin/fish' },
        { name: 'sh', path: '/bin/sh' },
      ]
      // Filter to shells that exist — for now return all, frontend can filter
      return shells
    },

    getInfo: (): Promise<SystemInfo> =>
      invoke('get_system_info'),

    openInEditor: async (projectPath: string): Promise<{ success: boolean; editor?: string; error?: string }> => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')

        // Use the user's login shell to resolve PATH properly.
        // Desktop apps don't inherit shell PATH, so editors like `code`
        // installed via snap/flatpak/custom locations won't be found directly.
        const editors = ['code', 'cursor', 'subl', 'gedit', 'kate']

        // Try direct command first (works if editor is in system PATH)
        for (const editor of editors) {
          try {
            const result = await Command.create(editor, [projectPath]).execute()
            if (result.code === 0) {
              return { success: true, editor }
            }
          } catch { continue }
        }

        // Try through bash login shell for full user PATH resolution
        for (const editor of editors) {
          try {
            const result = await Command.create('bash', [
              '-lc',
              `command -v ${editor} > /dev/null 2>&1 && exec ${editor} "$@"`,
              '--',
              projectPath
            ]).execute()
            if (result.code === 0) {
              return { success: true, editor }
            }
          } catch { continue }
        }

        // macOS: try `open` command
        try {
          const result = await Command.create('open', [projectPath]).execute()
          if (result.code === 0) {
            return { success: true, editor: 'open (macOS default)' }
          }
        } catch { /* continue */ }

        // Linux: xdg-open as last resort (opens file manager for directories)
        try {
          const result = await Command.create('xdg-open', [projectPath]).execute()
          if (result.code === 0) {
            return { success: true, editor: 'xdg-open (default app)' }
          }
        } catch { /* continue */ }

        return { success: false, error: 'No suitable editor found. Install VS Code, Cursor, Sublime Text, or another supported editor.' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    openExternal: async (url: string): Promise<void> => {
      const { open: shellOpen } = await import('@tauri-apps/plugin-shell')
      await shellOpen(url)
    },
  },

  dialog: {
    openDirectory: async (): Promise<string | null> => {
      const result = await open({ directory: true })
      return result as string | null
    },
  },

  store: (() => {
    // Cache the store instance to avoid re-loading on every call
    let storePromise: Promise<any> | null = null
    async function getStore() {
      if (!storePromise) {
        storePromise = import('@tauri-apps/plugin-store').then(({ load }) =>
          load('toolchain-store.json', { autoSave: true })
        )
      }
      return storePromise
    }
    return {
      get: async (key: string): Promise<unknown> => {
        try {
          const store = await getStore()
          return await store.get(key)
        } catch (e) {
          console.error('[TauriStore] get error:', key, e)
          return undefined
        }
      },
      set: async (key: string, value: unknown): Promise<void> => {
        try {
          const store = await getStore()
          await store.set(key, value)
          await store.save()
        } catch (e) {
          console.error('[TauriStore] set error:', key, e)
        }
      },
      delete: async (key: string): Promise<void> => {
        try {
          const store = await getStore()
          await store.delete(key)
          await store.save()
        } catch (e) {
          console.error('[TauriStore] delete error:', key, e)
        }
      },
      clear: async (): Promise<void> => {
        try {
          const store = await getStore()
          await store.clear()
          await store.save()
        } catch (e) {
          console.error('[TauriStore] clear error:', e)
        }
      },
    }
  })(),

  agent: {
    spawn: async (options: {
      agentType: string
      cwd: string
      sessionId?: string
      resumeSessionId?: string
      prompt?: string
      model?: string
      allowedTools?: string[]
      contextContent?: string
      skipPermissions?: boolean
      sessionTitle?: string
    }): Promise<{ success: boolean; process?: { id: string; agentType: string; cwd: string }; error?: string }> => {
      try {
        const terminal: TerminalInfo = await invoke('spawn_agent', {
          projectPath: options.cwd,
          model: options.model || 'claude-sonnet-4-20250514',
          systemPrompt: options.contextContent || '',
          sessionId: options.resumeSessionId || null,
          context: options.contextContent || '',
        })
        return {
          success: true,
          process: {
            id: terminal.id,
            agentType: options.agentType || 'claude',
            cwd: options.cwd,
          },
        }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    sendMessage: async (id: string, message: Record<string, unknown>): Promise<void> => {
      // The message object is { type: 'user', message: { role: 'user', content: '...' } }
      // Extract the actual content string for the Rust command
      const innerMsg = (message as any).message
      const content = typeof innerMsg?.content === 'string'
        ? innerMsg.content
        : typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message)
      await invoke('send_agent_message', {
        terminalId: id,
        message: content,
        sessionId: (message as any).session_id || '',
      })
    },

    kill: (id: string): Promise<void> =>
      invoke('kill_agent', { terminalId: id }),

    list: (): Promise<TerminalInfo[]> =>
      invoke('list_terminals'),

    generateTitle: async (_options: { userMessages: string[] }): Promise<{ success: boolean; title?: string; error?: string }> => {
      // TODO: Implement title generation
      return { success: true, title: 'Agent Session' }
    },

    onStreamEvent: (_callback: (id: string, event: unknown) => void): (() => void) => {
      // Not used — events come through detector.onEventBatch
      return () => {}
    },

    onProcessExit: (callback: (id: string, code: number | null) => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      listen<{ terminalId: string; exitCode: number | null }>('pty:exit', (event) => {
        callback(event.payload.terminalId, event.payload.exitCode)
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },

    onError: (_callback: (id: string, error: string) => void): (() => void) => {
      return () => {}
    },
  },

  window: {
    minimize: async (): Promise<void> => {
      await getCurrentWindow().minimize()
    },
    maximize: async (): Promise<void> => {
      const win = getCurrentWindow()
      if (await win.isMaximized()) {
        await win.unmaximize()
      } else {
        await win.maximize()
      }
    },
    close: async (): Promise<void> => {
      await getCurrentWindow().close()
    },
    isMaximized: async (): Promise<boolean> => {
      return await getCurrentWindow().isMaximized()
    },
    onMaximize: (callback: () => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      getCurrentWindow().onResized(() => {
        getCurrentWindow().isMaximized().then(maximized => {
          if (maximized) callback()
        })
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },
    onUnmaximize: (callback: () => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      getCurrentWindow().onResized(() => {
        getCurrentWindow().isMaximized().then(maximized => {
          if (!maximized) callback()
        })
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },
  },

  app: {
    getVersion: async (): Promise<string> => {
      const { getVersion } = await import('@tauri-apps/api/app')
      return getVersion()
    },
  },

  git: {
    getInfo: async (projectPath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')

        const revParse = await Command.create('git', ['-C', projectPath, 'rev-parse', '--is-inside-work-tree']).execute()
        if (revParse.code !== 0) {
          return { isGitRepo: false }
        }

        const branchResult = await Command.create('git', ['-C', projectPath, 'rev-parse', '--abbrev-ref', 'HEAD']).execute()
        const branch = branchResult.stdout.trim()

        const statusResult = await Command.create('git', ['-C', projectPath, 'status', '--porcelain']).execute()
        const hasChanges = statusResult.stdout.trim().length > 0

        let ahead = 0
        let behind = 0
        try {
          const abResult = await Command.create('git', ['-C', projectPath, 'rev-list', '--left-right', '--count', `HEAD...@{upstream}`]).execute()
          if (abResult.code === 0) {
            const parts = abResult.stdout.trim().split(/\s+/)
            ahead = parseInt(parts[0] ?? '0') || 0
            behind = parseInt(parts[1] ?? '0') || 0
          }
        } catch { /* no upstream */ }

        return { isGitRepo: true, branch, hasChanges, ahead, behind }
      } catch {
        return { isGitRepo: false }
      }
    },

    listBranches: async (projectPath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const localResult = await Command.create('git', ['-C', projectPath, 'branch', '--format=%(refname:short)']).execute()
        const localBranches = localResult.code === 0 ? localResult.stdout.trim().split('\n').filter(Boolean) : []

        const remoteResult = await Command.create('git', ['-C', projectPath, 'branch', '-r', '--format=%(refname:short)']).execute()
        const remoteBranches = remoteResult.code === 0 ? remoteResult.stdout.trim().split('\n').filter(Boolean) : []

        const currentResult = await Command.create('git', ['-C', projectPath, 'rev-parse', '--abbrev-ref', 'HEAD']).execute()
        const currentBranch = currentResult.code === 0 ? currentResult.stdout.trim() : undefined

        return { success: true, localBranches, remoteBranches, currentBranch }
      } catch {
        return { success: false, localBranches: [] }
      }
    },

    getChangedFiles: async (projectPath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'status', '--porcelain=v1']).execute()
        if (result.code !== 0) return { success: false, files: [] }

        const files = result.stdout.trim().split('\n').filter(Boolean).map(line => {
          const indexStatus = line[0]
          const workTreeStatus = line[1]
          const filePath = line.substring(3)

          // Determine if staged: index column (first char) has a non-space, non-? value
          const staged = indexStatus !== ' ' && indexStatus !== '?'

          let status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied' = 'modified'
          if (indexStatus === '?' && workTreeStatus === '?') status = 'untracked'
          else if (indexStatus === 'A' || workTreeStatus === 'A') status = 'added'
          else if (indexStatus === 'D' || workTreeStatus === 'D') status = 'deleted'
          else if (indexStatus === 'R' || workTreeStatus === 'R') status = 'renamed'
          else if (indexStatus === 'C' || workTreeStatus === 'C') status = 'copied'

          return { path: filePath, status, staged }
        })

        return { success: true, files }
      } catch {
        return { success: false, files: [] }
      }
    },

    checkout: async (projectPath: string, branch: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'checkout', branch]).execute()
        return { success: result.code === 0, error: result.stderr }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    fetch: async (projectPath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'fetch', '--all', '--prune']).execute()
        return { success: result.code === 0, error: result.stderr }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    push: async (projectPath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'push']).execute()
        return { success: result.code === 0, error: result.stderr }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    pull: async (projectPath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'pull']).execute()
        return { success: result.code === 0, error: result.stderr }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    stageFile: async (projectPath: string, filePath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'add', '--', filePath]).execute()
        return { success: result.code === 0, error: result.stderr }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    unstageFile: async (projectPath: string, filePath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'restore', '--staged', '--', filePath]).execute()
        return { success: result.code === 0, error: result.stderr }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    discardFile: async (projectPath: string, filePath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        // Check if file is untracked
        const statusResult = await Command.create('git', ['-C', projectPath, 'status', '--porcelain', '--', filePath]).execute()
        const isUntracked = statusResult.stdout.trim().startsWith('??')

        if (isUntracked) {
          const result = await Command.create('git', ['-C', projectPath, 'clean', '-f', '--', filePath]).execute()
          return { success: result.code === 0, error: result.stderr }
        } else {
          const result = await Command.create('git', ['-C', projectPath, 'checkout', '--', filePath]).execute()
          return { success: result.code === 0, error: result.stderr }
        }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    commit: async (projectPath: string, message: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        const result = await Command.create('git', ['-C', projectPath, 'commit', '-m', message]).execute()
        return { success: result.code === 0, error: result.stderr }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    getFileContent: async (projectPath: string, filePath: string, _projectId?: string) => {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell')
        // Get the HEAD version of the file
        const result = await Command.create('git', ['-C', projectPath, 'show', `HEAD:${filePath}`]).execute()
        if (result.code !== 0) {
          // File might be new (not in HEAD)
          return { success: true, content: '', isNew: true }
        }
        return { success: true, content: result.stdout }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    // Watchers — no native file watching yet, but return success so the store flow works
    onChanged: (_callback: (path: string) => void) => () => {},
    watch: async (_projectPath: string) => ({ success: true }),
    unwatch: async (_projectPath: string) => ({ success: true }),
  },
  fs: {
    readFile: async (filePath: string, _projectId?: string) => {
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const content = await readTextFile(filePath)
        return { success: true, content }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    writeFile: async (filePath: string, content: string, _projectId?: string) => {
      try {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs')
        await writeTextFile(filePath, content)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    listDir: async (dirPath: string, _projectId?: string) => {
      try {
        const { readDir } = await import('@tauri-apps/plugin-fs')
        const entries = await readDir(dirPath)
        const items = entries.map((entry: { name: string; isDirectory: boolean; isFile: boolean }) => ({
          name: entry.name,
          path: dirPath.endsWith('/') ? dirPath + entry.name : dirPath + '/' + entry.name,
          isDirectory: entry.isDirectory,
          isFile: entry.isFile,
        }))
        return { success: true, items }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    searchContent: async () => ({ success: false, error: 'Not implemented' }),
  },
  ssh: createStubNamespace('ssh'),
  project: createStubNamespace('project'),
  cli: {
    detectAll: async () => ({
      success: true,
      tools: [
        {
          id: 'claude',
          name: 'Claude',
          installed: true,
          version: 'latest',
          installMethod: 'native' as const,
          defaultModel: 'claude-sonnet-4-20250514',
        },
      ],
    }),
    detect: async () => ({ id: 'claude', name: 'Claude', installed: true }),
    install: async () => ({ success: false, output: '', error: 'Not implemented' }),
    getPlatform: async () => (navigator.platform.includes('Mac') ? 'macos' as const : 'linux' as const),
    checkUpdate: async () => ({ agentId: '', currentVersion: null, latestVersion: null, updateAvailable: false }),
    checkUpdates: async () => [],
    getModels: async () => [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', desc: 'Fast and capable' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', desc: 'Most capable' },
    ],
  },
  updater: {
    install: async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (update) {
          await update.downloadAndInstall()
          const { relaunch } = await import('@tauri-apps/plugin-process')
          await relaunch()
        }
      } catch (e) {
        console.error('[TauriAPI] updater.install error:', e)
      }
    },

    dismiss: async (version: string) => {
      // Store dismissal with timestamp so we can skip for 24 hours
      try {
        const store = await import('@tauri-apps/plugin-store').then(({ load }) =>
          load('toolchain-store.json', { autoSave: true })
        )
        await store.set(`update-dismissed-${version}`, Date.now())
        await store.save()
      } catch (e) {
        console.error('[TauriAPI] updater.dismiss error:', e)
      }
    },

    onUpdateAvailable: (callback: (info: any) => void): (() => void) => {
      // Start periodic update checks
      let cancelled = false
      const DISMISS_TIMEOUT = 24 * 60 * 60 * 1000 // 24 hours
      const CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes

      const checkForUpdate = async () => {
        if (cancelled) return
        try {
          const { check } = await import('@tauri-apps/plugin-updater')
          const update = await check()
          if (update) {
            // Check if this version was recently dismissed
            try {
              const store = await import('@tauri-apps/plugin-store').then(({ load }) =>
                load('toolchain-store.json', { autoSave: true })
              )
              const dismissedAt = await store.get(`update-dismissed-${update.version}`) as number | undefined
              if (dismissedAt && Date.now() - dismissedAt < DISMISS_TIMEOUT) {
                return // Dismissed within 24 hours
              }
            } catch { /* store error, proceed */ }

            callback({
              version: update.version,
              body: update.body,
              date: update.date,
            })
          }
        } catch (e) {
          console.error('[TauriAPI] update check error:', e)
        }
      }

      // Check immediately, then every 5 minutes
      checkForUpdate()
      const interval = setInterval(checkForUpdate, CHECK_INTERVAL)

      return () => {
        cancelled = true
        clearInterval(interval)
      }
    },

    onUpdateDownloaded: (callback: (info: any) => void): (() => void) => {
      // In Tauri, download + install happen together via install()
      // We use onUpdateAvailable to trigger the notification, then
      // the user clicks "Update Now" which calls install()
      // So onUpdateDownloaded maps to onUpdateAvailable
      let cancelled = false
      const DISMISS_TIMEOUT = 24 * 60 * 60 * 1000
      const CHECK_INTERVAL = 5 * 60 * 1000

      const checkForUpdate = async () => {
        if (cancelled) return
        try {
          const { check } = await import('@tauri-apps/plugin-updater')
          const update = await check()
          if (update) {
            try {
              const store = await import('@tauri-apps/plugin-store').then(({ load }) =>
                load('toolchain-store.json', { autoSave: true })
              )
              const dismissedAt = await store.get(`update-dismissed-${update.version}`) as number | undefined
              if (dismissedAt && Date.now() - dismissedAt < DISMISS_TIMEOUT) {
                return
              }
            } catch { /* proceed */ }

            callback({
              version: update.version,
              body: update.body,
              date: update.date,
            })
          }
        } catch (e) {
          console.error('[TauriAPI] update check error:', e)
        }
      }

      checkForUpdate()
      const interval = setInterval(checkForUpdate, CHECK_INTERVAL)

      return () => {
        cancelled = true
        clearInterval(interval)
      }
    },

    onDownloadProgress: (_callback: (progress: any) => void): (() => void) => {
      // Tauri's updater handles download internally, no granular progress
      return () => {}
    },
  },
  service: createStubNamespace('service'),
  docker: createStubNamespace('docker'),
  permission: {
    respond: async (
      id: string,
      decision: 'allow' | 'deny',
      _reason?: string,
      alwaysAllow?: boolean,
      bashRules?: string[][],
      projectPath?: string,
      toolName?: string,
    ) => {
      try {
        await invoke('respond_to_permission', { id, decision, alwaysAllow, bashRules, projectPath, toolName })
        return { success: true }
      } catch (e) {
        console.error('[TauriAPI] permission.respond error:', e)
        return { success: false, error: String(e) }
      }
    },

    checkHook: async (_projectPath?: string) => {
      try {
        const status = await invoke<{ claude: boolean; gemini: boolean }>('check_hooks_installed')
        return status.claude
      } catch {
        return false
      }
    },

    installHook: async (_projectPath?: string) => {
      try {
        await invoke('install_hooks')
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    getAllowlistConfig: async (projectPath: string) => {
      try {
        return await invoke<{ tools: string[]; bashRules: string[][] }>('get_permission_rules', { projectPath })
      } catch {
        return { tools: [], bashRules: [] }
      }
    },

    removeBashRule: async (projectPath: string, rule: string[]) => {
      try {
        await invoke('update_permission_rules', { projectPath, action: 'remove_bash_rule', bashRule: rule })
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    addAllowedTool: async (projectPath: string, toolName: string) => {
      try {
        await invoke('update_permission_rules', { projectPath, action: 'add_tool', toolName })
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    removeAllowedTool: async (projectPath: string, toolName: string) => {
      try {
        await invoke('update_permission_rules', { projectPath, action: 'remove_tool', toolName })
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    onRequest: (callback: (request: any) => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      listen<any>('permission:request', (event) => {
        callback(event.payload)
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },

    onExpired: (callback: (id: string) => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      listen<string>('permission:expired', (event) => {
        callback(event.payload)
      }).then(fn => { unlisten = fn })
      return () => { unlisten?.() }
    },
  },
  skill: createStubNamespace('skill'),
  log: createStubNamespace('log'),
  menu: createStubNamespace('menu'),
}

/**
 * Create a stub namespace that returns no-op functions for unimplemented features.
 * All methods return a resolved promise with a success: false result.
 */
function createStubNamespace(name: string): Record<string, (...args: any[]) => any> {
  return new Proxy({}, {
    get: (_target, prop) => {
      if (typeof prop === 'string') {
        // Event handlers (on*) return unsubscribe functions
        if (prop.startsWith('on')) {
          return (_callback: any) => () => {}
        }
        // Regular methods return promises
        return async (..._args: any[]) => {
          console.warn(`[TauriAPI] ${name}.${prop} not implemented yet`)
          return { success: false, error: `${name}.${prop} not implemented` }
        }
      }
    },
  }) as any
}

// Expose as window.electron for compatibility with existing code
if (typeof window !== 'undefined') {
  ;(window as any).electron = tauriAPI
}
