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

export type ActivityLevel = 'substantial' | 'minor' | 'idle'

// Full runtime session (includes pid, status, etc.)
export interface TerminalSession extends SavedTerminalConfig {
  pid: number
  title: string
  createdAt: number
  isActive: boolean
  status: 'running' | 'exited'
  exitCode?: number
  lastActivityTime: number
  lastActivityLevel: ActivityLevel // Current activity level
  lastSubstantialActivityTime: number // Last time we had substantial (green) activity
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
  addSession: (session: Omit<TerminalSession, 'isActive' | 'status' | 'lastActivityTime' | 'lastActivityLevel' | 'lastSubstantialActivityTime'>) => void
  addSessionsBatch: (sessions: Omit<TerminalSession, 'isActive' | 'status' | 'lastActivityTime' | 'lastActivityLevel' | 'lastSubstantialActivityTime'>[]) => void
  removeSession: (id: string) => void
  removeSessionsByProject: (projectId: string) => void
  setActiveSession: (id: string | null) => void
  updateSessionTitle: (id: string, title: string) => void
  updateSessionPid: (id: string, pid: number) => void
  markSessionExited: (id: string, exitCode: number) => void
  updateSessionActivity: (id: string, level: ActivityLevel) => void

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
          const now = Date.now()
          const newSession: TerminalSession = {
            ...session,
            isActive: true,
            status: 'running',
            lastActivityTime: now,
            lastActivityLevel: 'idle',
            lastSubstantialActivityTime: now,
          }
          return {
            sessions: [...state.sessions, newSession],
            activeSessionId: session.id,
          }
        }),

      addSessionsBatch: (sessions) =>
        set((state) => {
          const now = Date.now()
          const newSessions = sessions.map((session) => ({
            ...session,
            isActive: true,
            status: 'running' as const,
            lastActivityTime: now,
            lastActivityLevel: 'idle' as const,
            lastSubstantialActivityTime: now,
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

      updateSessionPid: (id, pid) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, pid, status: 'running' as const, exitCode: undefined } : s
          ),
        })),

      markSessionExited: (id, exitCode) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, status: 'exited', exitCode } : s
          ),
        })),

      updateSessionActivity: (id, level) => {
        const now = Date.now()
        const state = get()
        const session = state.sessions.find((s) => s.id === id)

        // Only update if last activity was more than 1 second ago (throttle)
        if (!session || (now - session.lastActivityTime) < 1000) {
          return
        }

        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id === id) {
              return {
                ...s,
                lastActivityTime: now,
                lastActivityLevel: level,
                // Update lastSubstantialActivityTime only if this is substantial activity
                lastSubstantialActivityTime: level === 'substantial' ? now : s.lastSubstantialActivityTime,
              }
            }
            return s
          }),
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
