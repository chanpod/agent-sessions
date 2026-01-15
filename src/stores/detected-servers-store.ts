/**
 * Detected Servers Store - Tracks servers detected from terminal output
 */

import { create } from 'zustand'
import { DetectedServer } from '../types/electron'

export interface DetectedServerInfo extends DetectedServer {
  terminalId: string
  status: 'running' | 'crashed' | 'stopped'
  crashedAt?: number
  exitCode?: number
}

interface DetectedServersState {
  servers: Map<string, DetectedServerInfo> // key is `${terminalId}:${url}`

  // Actions
  addServer: (terminalId: string, server: DetectedServer) => void
  markServerCrashed: (terminalId: string, exitCode: number) => void
  markServerStopped: (terminalId: string) => void
  removeServer: (terminalId: string, url: string) => void
  clearTerminalServers: (terminalId: string) => void
  getServersByTerminal: (terminalId: string) => DetectedServerInfo[]
  getAllServers: () => DetectedServerInfo[]
}

export const useDetectedServersStore = create<DetectedServersState>((set, get) => ({
  servers: new Map(),

  addServer: (terminalId, server) => {
    console.log(`[DetectedServersStore] Adding server ${server.url} for terminal ${terminalId}`)
    set((state) => {
      const key = `${terminalId}:${server.url}`
      const newServers = new Map(state.servers)

      newServers.set(key, {
        ...server,
        terminalId,
        status: 'running',
      })

      return { servers: newServers }
    })
  },

  markServerCrashed: (terminalId, exitCode) => {
    console.log(`[DetectedServersStore] markServerCrashed called for terminal ${terminalId} with exit code ${exitCode}`)
    set((state) => {
      const newServers = new Map(state.servers)
      let updated = false

      for (const [key, server] of newServers.entries()) {
        if (server.terminalId === terminalId && server.status === 'running') {
          console.log(`[DetectedServersStore] Marking server ${server.url} as crashed`)
          newServers.set(key, {
            ...server,
            status: 'crashed',
            crashedAt: Date.now(),
            exitCode,
          })
          updated = true
        }
      }

      if (!updated) {
        console.log(`[DetectedServersStore] No running servers found for terminal ${terminalId}`)
      }

      return updated ? { servers: newServers } : state
    })
  },

  markServerStopped: (terminalId) => {
    set((state) => {
      const newServers = new Map(state.servers)
      let updated = false

      for (const [key, server] of newServers.entries()) {
        if (server.terminalId === terminalId && server.status === 'running') {
          newServers.set(key, {
            ...server,
            status: 'stopped',
          })
          updated = true
        }
      }

      return updated ? { servers: newServers } : state
    })
  },

  removeServer: (terminalId, url) => {
    set((state) => {
      const key = `${terminalId}:${url}`
      const newServers = new Map(state.servers)
      newServers.delete(key)
      return { servers: newServers }
    })
  },

  clearTerminalServers: (terminalId) => {
    set((state) => {
      const newServers = new Map(state.servers)

      for (const [key, server] of newServers.entries()) {
        if (server.terminalId === terminalId) {
          newServers.delete(key)
        }
      }

      return { servers: newServers }
    })
  },

  getServersByTerminal: (terminalId) => {
    const servers = get().servers
    const result: DetectedServerInfo[] = []

    for (const server of servers.values()) {
      if (server.terminalId === terminalId) {
        result.push(server)
      }
    }

    return result
  },

  getAllServers: () => {
    return Array.from(get().servers.values())
  },
}))
