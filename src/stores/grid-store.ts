import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'
import { useTerminalStore } from './terminal-store'

export type LayoutMode = 'auto' | '1x1' | '2x1' | '2x2' | '3x2'

export interface DashboardState {
  terminalRefs: string[]
  layoutMode: LayoutMode
  focusedTerminalId: string | null
}

interface GridStore {
  dashboard: DashboardState

  // Actions
  addTerminalToDashboard: (terminalId: string) => void
  removeTerminalFromDashboard: (terminalId: string) => void
  setDashboardLayoutMode: (mode: LayoutMode) => void
  setDashboardFocusedTerminal: (terminalId: string | null) => void
  reorderDashboardTerminals: (fromIndex: number, toIndex: number) => void
  cleanupTerminalReferences: (terminalId: string) => void
  validateDashboardState: () => void
}

const initialDashboardState: DashboardState = {
  terminalRefs: [],
  layoutMode: 'auto',
  focusedTerminalId: null,
}

export const useGridStore = create<GridStore>()(
  persist(
    (set, get) => ({
      dashboard: initialDashboardState,

      addTerminalToDashboard: (terminalId: string) =>
        set((state) => {
          // Don't add if already in dashboard
          if (state.dashboard.terminalRefs.includes(terminalId)) {
            return {
              dashboard: {
                ...state.dashboard,
                focusedTerminalId: terminalId,
              },
            }
          }
          return {
            dashboard: {
              ...state.dashboard,
              terminalRefs: [...state.dashboard.terminalRefs, terminalId],
              focusedTerminalId: terminalId,
            },
          }
        }),

      removeTerminalFromDashboard: (terminalId: string) =>
        set((state) => {
          const newTerminalRefs = state.dashboard.terminalRefs.filter(
            (id) => id !== terminalId
          )
          const newFocused =
            state.dashboard.focusedTerminalId === terminalId
              ? newTerminalRefs[newTerminalRefs.length - 1] ?? null
              : state.dashboard.focusedTerminalId
          return {
            dashboard: {
              ...state.dashboard,
              terminalRefs: newTerminalRefs,
              focusedTerminalId: newFocused,
            },
          }
        }),

      setDashboardLayoutMode: (mode: LayoutMode) =>
        set((state) => ({
          dashboard: {
            ...state.dashboard,
            layoutMode: mode,
          },
        })),

      setDashboardFocusedTerminal: (terminalId: string | null) =>
        set((state) => ({
          dashboard: {
            ...state.dashboard,
            focusedTerminalId: terminalId,
          },
        })),

      reorderDashboardTerminals: (fromIndex: number, toIndex: number) =>
        set((state) => {
          const newRefs = [...state.dashboard.terminalRefs]
          const [removed] = newRefs.splice(fromIndex, 1)
          if (removed !== undefined) {
            newRefs.splice(toIndex, 0, removed)
          }
          return {
            dashboard: {
              ...state.dashboard,
              terminalRefs: newRefs,
            },
          }
        }),

      cleanupTerminalReferences: (terminalId: string) => {
        get().removeTerminalFromDashboard(terminalId)
      },

      validateDashboardState: () => {
        const validTerminalIds = new Set(
          useTerminalStore.getState().sessions.map((s) => s.id)
        )

        set((state) => {
          const validRefs = state.dashboard.terminalRefs.filter((id) =>
            validTerminalIds.has(id)
          )
          const newFocused = state.dashboard.focusedTerminalId &&
            validTerminalIds.has(state.dashboard.focusedTerminalId)
            ? state.dashboard.focusedTerminalId
            : validRefs[0] ?? null

          return {
            dashboard: {
              ...state.dashboard,
              terminalRefs: validRefs,
              focusedTerminalId: newFocused,
            },
          }
        })
      },
    }),
    {
      name: 'toolchain-grid',
      storage: createJSONStorage(() => electronStorage),
      partialize: (state) => ({
        dashboard: {
          terminalRefs: state.dashboard.terminalRefs,
          layoutMode: state.dashboard.layoutMode,
          focusedTerminalId: state.dashboard.focusedTerminalId,
        },
      }),
    }
  )
)
