import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'
import { removeTerminalFromAllGrids } from './grid-store'

// Config that gets persisted (no runtime state like pid)
export interface SavedTerminalConfig {
  id: string
  projectId: string
  shell: string
  shellName: string // Friendly name like "bash" or "SSH: Production"
  cwd: string
  sshConnectionId?: string // For SSH terminals
}

// Full runtime session (includes pid, status, etc.)
export interface TerminalSession extends SavedTerminalConfig {
  pid: number
  title: string
  createdAt: number
  isActive: boolean
  status: 'running' | 'exited'
  exitCode?: number
  lastActivityTime: number
}

interface TerminalStore {
  // Persisted configs (survive restart)
  savedConfigs: SavedTerminalConfig[]

  // Runtime sessions (cleared on restart)
  sessions: TerminalSession[]
  activeSessionId: string | null

  // Flag to track if we've restored sessions
  hasRestored: boolean

  // Actions for saved configs
  saveConfig: (config: SavedTerminalConfig) => void
  removeSavedConfig: (id: string) => void
  getSavedConfigs: () => SavedTerminalConfig[]
  markRestored: () => void

  // Actions for runtime sessions
  addSession: (session: Omit<TerminalSession, 'isActive' | 'status' | 'lastActivityTime'>) => void
  addSessionsBatch: (sessions: Omit<TerminalSession, 'isActive' | 'status' | 'lastActivityTime'>[]) => void
  removeSession: (id: string) => void
  removeSessionsByProject: (projectId: string) => void
  setActiveSession: (id: string | null) => void
  updateSessionTitle: (id: string, title: string) => void
  markSessionExited: (id: string, exitCode: number) => void
  updateSessionActivity: (id: string) => void

  // Selectors
  getSessionsByProject: (projectId: string) => TerminalSession[]
}

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, get) => ({
      savedConfigs: [],
      sessions: [],
      activeSessionId: null,
      hasRestored: false,

      // Saved config actions
      saveConfig: (config) =>
        set((state) => ({
          savedConfigs: [...state.savedConfigs.filter(c => c.id !== config.id), config],
        })),

      removeSavedConfig: (id) =>
        set((state) => ({
          savedConfigs: state.savedConfigs.filter((c) => c.id !== id),
        })),

      getSavedConfigs: () => get().savedConfigs,

      markRestored: () => set({ hasRestored: true }),

      // Runtime session actions
      addSession: (session) =>
        set((state) => {
          const newSession: TerminalSession = {
            ...session,
            isActive: true,
            status: 'running',
            lastActivityTime: Date.now(),
          }
          return {
            sessions: [...state.sessions, newSession],
            activeSessionId: session.id,
          }
        }),

      addSessionsBatch: (sessions) =>
        set((state) => {
          const newSessions = sessions.map((session) => ({
            ...session,
            isActive: true,
            status: 'running' as const,
            lastActivityTime: Date.now(),
          }))
          return {
            sessions: [...state.sessions, ...newSessions],
            activeSessionId: newSessions[newSessions.length - 1]?.id ?? state.activeSessionId,
          }
        }),

      removeSession: (id) => {
        // Also remove from any grid
        removeTerminalFromAllGrids(id)
        return set((state) => {
          const filtered = state.sessions.filter((s) => s.id !== id)
          const newActiveId =
            state.activeSessionId === id
              ? filtered[filtered.length - 1]?.id ?? null
              : state.activeSessionId
          return {
            sessions: filtered,
            activeSessionId: newActiveId,
            savedConfigs: state.savedConfigs.filter((c) => c.id !== id),
          }
        })
      },

      removeSessionsByProject: (projectId) => {
        // Remove all project sessions from grids
        const state = get()
        const projectSessionIds = state.sessions
          .filter((s) => s.projectId === projectId)
          .map((s) => s.id)
        projectSessionIds.forEach((id) => {
          removeTerminalFromAllGrids(id)
        })

        return set((state) => {
          const filtered = state.sessions.filter((s) => s.projectId !== projectId)
          const currentActive = state.sessions.find((s) => s.id === state.activeSessionId)
          const newActiveId =
            currentActive?.projectId === projectId
              ? filtered[filtered.length - 1]?.id ?? null
              : state.activeSessionId
          return {
            sessions: filtered,
            activeSessionId: newActiveId,
            savedConfigs: state.savedConfigs.filter((c) => c.projectId !== projectId),
          }
        })
      },

      setActiveSession: (id) =>
        set({ activeSessionId: id }),

      updateSessionTitle: (id, title) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title } : s
          ),
        })),

      markSessionExited: (id, exitCode) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, status: 'exited', exitCode } : s
          ),
        })),

      updateSessionActivity: (id) => {
        const now = Date.now()
        console.log('[DEBUG] updateSessionActivity called:', { id, timestamp: now })
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, lastActivityTime: now } : s
          ),
        }))
      },

      getSessionsByProject: (projectId) =>
        get().sessions.filter((s) => s.projectId === projectId),
    }),
    {
      name: 'toolchain-terminals',
      storage: createJSONStorage(() => electronStorage),
      // Only persist savedConfigs, not runtime sessions
      partialize: (state) => ({
        savedConfigs: state.savedConfigs,
      }),
    }
  )
)
