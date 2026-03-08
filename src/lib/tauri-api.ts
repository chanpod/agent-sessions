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
      let unlisten: UnlistenFn | null = null
      listen<AgentEventBatch[]>('agent:events-batch', (event) => {
        // Convert Rust event batches to the DetectorEvent format the frontend expects
        const detectorEvents: DetectorEvent[] = []
        for (const batch of event.payload) {
          for (const agentEvent of batch.events) {
            detectorEvents.push({
              terminalId: batch.terminal_id,
              type: agentEvent.type,
              timestamp: Date.now(),
              data: agentEvent.data,
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
        // Try common editors
        const { Command } = await import('@tauri-apps/plugin-shell')
        for (const editor of ['code', 'cursor', 'subl', 'atom']) {
          try {
            await Command.create(editor, [projectPath]).execute()
            return { success: true, editor }
          } catch { continue }
        }
        return { success: false, error: 'No editor found' }
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

  store: {
    get: async (key: string): Promise<unknown> => {
      try {
        const { load } = await import('@tauri-apps/plugin-store')
        const store = await load('toolchain-store.json')
        return await store.get(key)
      } catch {
        return undefined
      }
    },
    set: async (key: string, value: unknown): Promise<void> => {
      const { load } = await import('@tauri-apps/plugin-store')
      const store = await load('toolchain-store.json')
      await store.set(key, value)
      await store.save()
    },
    delete: async (key: string): Promise<void> => {
      const { load } = await import('@tauri-apps/plugin-store')
      const store = await load('toolchain-store.json')
      await store.delete(key)
      await store.save()
    },
    clear: async (): Promise<void> => {
      const { load } = await import('@tauri-apps/plugin-store')
      const store = await load('toolchain-store.json')
      await store.clear()
      await store.save()
    },
  },

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
    }): Promise<{ success: boolean; terminal?: TerminalInfo; error?: string }> => {
      try {
        const terminal: TerminalInfo = await invoke('spawn_agent', {
          projectPath: options.cwd,
          model: options.model || 'claude-sonnet-4-20250514',
          systemPrompt: options.contextContent || '',
          sessionId: options.resumeSessionId || null,
          context: options.contextContent || '',
        })
        return { success: true, terminal }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    sendMessage: async (id: string, message: Record<string, unknown>): Promise<void> => {
      // The message object has { role, content } — extract content for the Rust command
      const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content)
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

  // Stubs for features not in MVP
  git: createStubNamespace('git'),
  fs: createStubNamespace('fs'),
  ssh: createStubNamespace('ssh'),
  project: createStubNamespace('project'),
  cli: {
    detectAll: async () => ({ success: true, tools: [] }),
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
  updater: createStubNamespace('updater'),
  service: createStubNamespace('service'),
  docker: createStubNamespace('docker'),
  permission: createStubNamespace('permission'),
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
