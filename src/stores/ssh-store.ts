import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'

export type SSHAuthMethod = 'key' | 'agent' | 'password'

export interface SSHConnection {
  id: string
  name: string // Friendly name like "Production Server"
  host: string // hostname or IP
  port: number // default 22
  username: string
  authMethod: SSHAuthMethod
  identityFile?: string // Path to SSH key file (for 'key' auth)
  options?: string[] // Additional SSH options (e.g., ['-o', 'ServerAliveInterval=60'])
  createdAt: number
}

export interface SSHConnectionStatus {
  connectionId: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  connectedAt?: number
}

interface SSHStore {
  // Persisted connections
  connections: SSHConnection[]

  // Runtime connection status (not persisted)
  connectionStatuses: Map<string, SSHConnectionStatus>

  // Actions
  addConnection: (connection: Omit<SSHConnection, 'id' | 'createdAt'>) => string
  updateConnection: (id: string, updates: Partial<Omit<SSHConnection, 'id' | 'createdAt'>>) => void
  removeConnection: (id: string) => void
  getConnection: (id: string) => SSHConnection | undefined

  // Connection status management
  setConnectionStatus: (status: SSHConnectionStatus) => void
  getConnectionStatus: (connectionId: string) => SSHConnectionStatus | undefined
  clearConnectionStatus: (connectionId: string) => void
}

function generateId(): string {
  return crypto.randomUUID()
}

export const useSSHStore = create<SSHStore>()(
  persist(
    (set, get) => ({
      connections: [],
      connectionStatuses: new Map(),

      addConnection: (connection) => {
        const id = generateId()
        const newConnection: SSHConnection = {
          ...connection,
          id,
          createdAt: Date.now(),
        }
        set((state) => ({
          connections: [...state.connections, newConnection]
        }))
        return id
      },

      updateConnection: (id, updates) =>
        set((state) => ({
          connections: state.connections.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),

      removeConnection: (id) =>
        set((state) => {
          const statuses = new Map(state.connectionStatuses)
          statuses.delete(id)
          return {
            connections: state.connections.filter((c) => c.id !== id),
            connectionStatuses: statuses,
          }
        }),

      getConnection: (id) =>
        get().connections.find((c) => c.id === id),

      setConnectionStatus: (status) =>
        set((state) => {
          const statuses = new Map(state.connectionStatuses)
          statuses.set(status.connectionId, status)
          return { connectionStatuses: statuses }
        }),

      getConnectionStatus: (connectionId) =>
        get().connectionStatuses.get(connectionId),

      clearConnectionStatus: (connectionId) =>
        set((state) => {
          const statuses = new Map(state.connectionStatuses)
          statuses.delete(connectionId)
          return { connectionStatuses: statuses }
        }),
    }),
    {
      name: 'toolchain-ssh',
      storage: createJSONStorage(() => electronStorage),
      // Only persist connections, not runtime status
      partialize: (state) => ({
        connections: state.connections,
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('[SSHStore] Hydration error:', error)
          } else {
            console.log('[SSHStore] Loaded', state?.connections?.length || 0, 'SSH connections')
            // Initialize connectionStatuses Map after rehydration
            if (state) {
              state.connectionStatuses = new Map()
            }
          }
        }
      },
    }
  )
)
