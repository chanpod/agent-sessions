import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'

export type LayoutMode = 'auto' | '1x1' | '2x1' | '2x2' | '3x2'

interface GridStore {
  // Terminals currently displayed in the grid (ordered)
  gridTerminalIds: string[]

  // Which terminal in the grid is focused (receives keyboard input)
  focusedGridTerminalId: string | null

  // Layout mode preference
  layoutMode: LayoutMode

  // Actions
  addToGrid: (terminalId: string) => void
  removeFromGrid: (terminalId: string) => void
  reorderGrid: (fromIndex: number, toIndex: number) => void
  setFocusedTerminal: (terminalId: string | null) => void
  setLayoutMode: (mode: LayoutMode) => void
  clearGrid: () => void

  // Selectors
  isInGrid: (terminalId: string) => boolean
}

export const useGridStore = create<GridStore>()(
  persist(
    (set, get) => ({
      gridTerminalIds: [],
      focusedGridTerminalId: null,
      layoutMode: 'auto',

      addToGrid: (terminalId) =>
        set((state) => {
          // Don't add if already in grid
          if (state.gridTerminalIds.includes(terminalId)) {
            return { focusedGridTerminalId: terminalId }
          }
          return {
            gridTerminalIds: [...state.gridTerminalIds, terminalId],
            focusedGridTerminalId: terminalId,
          }
        }),

      removeFromGrid: (terminalId) =>
        set((state) => {
          const filtered = state.gridTerminalIds.filter((id) => id !== terminalId)
          // If removing the focused terminal, focus the last one or null
          const newFocused =
            state.focusedGridTerminalId === terminalId
              ? filtered[filtered.length - 1] ?? null
              : state.focusedGridTerminalId
          return {
            gridTerminalIds: filtered,
            focusedGridTerminalId: newFocused,
          }
        }),

      reorderGrid: (fromIndex, toIndex) =>
        set((state) => {
          const newIds = [...state.gridTerminalIds]
          const [removed] = newIds.splice(fromIndex, 1)
          if (removed !== undefined) {
            newIds.splice(toIndex, 0, removed)
          }
          return { gridTerminalIds: newIds }
        }),

      setFocusedTerminal: (terminalId) =>
        set({ focusedGridTerminalId: terminalId }),

      setLayoutMode: (mode) =>
        set({ layoutMode: mode }),

      clearGrid: () =>
        set({ gridTerminalIds: [], focusedGridTerminalId: null }),

      isInGrid: (terminalId) => get().gridTerminalIds.includes(terminalId),
    }),
    {
      name: 'agent-sessions-grid',
      storage: createJSONStorage(() => electronStorage),
      // Persist all grid state
      partialize: (state) => ({
        gridTerminalIds: state.gridTerminalIds,
        layoutMode: state.layoutMode,
        // Don't persist focusedGridTerminalId - reset on app start
      }),
    }
  )
)
