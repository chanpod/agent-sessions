import { create } from 'zustand'

export interface TerminalSession {
  id: string
  pid: number
  shell: string
  cwd: string
  title: string
  createdAt: number
  isActive: boolean
  status: 'running' | 'exited'
  exitCode?: number
}

interface TerminalStore {
  sessions: TerminalSession[]
  activeSessionId: string | null

  // Actions
  addSession: (session: Omit<TerminalSession, 'isActive' | 'status'>) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  updateSessionTitle: (id: string, title: string) => void
  markSessionExited: (id: string, exitCode: number) => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  activeSessionId: null,

  addSession: (session) =>
    set((state) => {
      const newSession: TerminalSession = {
        ...session,
        isActive: true,
        status: 'running',
      }
      return {
        sessions: [...state.sessions, newSession],
        activeSessionId: session.id,
      }
    }),

  removeSession: (id) =>
    set((state) => {
      const filtered = state.sessions.filter((s) => s.id !== id)
      const newActiveId =
        state.activeSessionId === id
          ? filtered[filtered.length - 1]?.id ?? null
          : state.activeSessionId
      return {
        sessions: filtered,
        activeSessionId: newActiveId,
      }
    }),

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
}))
