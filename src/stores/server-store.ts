import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'

// Config that gets persisted
export interface SavedServerConfig {
  id: string
  projectId: string
  name: string // Display name (e.g., "dev", "build")
  command: string // Full command (e.g., "npm run dev")
  cwd: string
  serviceId?: string // Optional link to ManagedService for unified stop/restart
  serviceType?: 'pty' | 'docker-compose' // Type of service backing this server
}

// Full runtime server (includes terminal id, status)
export interface ServerInstance extends SavedServerConfig {
  terminalId: string // Reference to the terminal running this server
  status: 'starting' | 'running' | 'stopped' | 'error'
  startedAt: number
}

interface ServerStore {
  // Persisted configs (survive restart)
  savedConfigs: SavedServerConfig[]

  // Runtime servers
  servers: ServerInstance[]

  // Flag to track restoration
  hasRestored: boolean

  // Actions for saved configs
  saveConfig: (config: SavedServerConfig) => void
  removeSavedConfig: (id: string) => void
  markRestored: () => void

  // Actions for runtime servers
  addServer: (server: ServerInstance) => void
  removeServer: (id: string) => void
  updateServerStatus: (id: string, status: ServerInstance['status']) => void
  getServersByProject: (projectId: string) => ServerInstance[]
}

export const useServerStore = create<ServerStore>()(
  persist(
    (set, get) => ({
      savedConfigs: [],
      servers: [],
      hasRestored: false,

      saveConfig: (config) =>
        set((state) => ({
          savedConfigs: [...state.savedConfigs.filter(c => c.id !== config.id), config],
        })),

      removeSavedConfig: (id) =>
        set((state) => ({
          savedConfigs: state.savedConfigs.filter((c) => c.id !== id),
        })),

      markRestored: () => set({ hasRestored: true }),

      addServer: (server) =>
        set((state) => ({
          servers: [...state.servers, server],
        })),

      removeServer: (id) =>
        set((state) => ({
          servers: state.servers.filter((s) => s.id !== id),
          savedConfigs: state.savedConfigs.filter((c) => c.id !== id),
        })),

      updateServerStatus: (id, status) =>
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, status } : s
          ),
        })),

      getServersByProject: (projectId) =>
        get().servers.filter((s) => s.projectId === projectId),
    }),
    {
      name: 'toolchain-servers',
      storage: createJSONStorage(() => electronStorage),
      partialize: (state) => ({
        savedConfigs: state.savedConfigs,
      }),
    }
  )
)
