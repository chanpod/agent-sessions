import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'

export type LayoutMode = 'auto' | '1x1' | '2x1' | '2x2' | '3x2'

export interface GridInstance {
  id: string
  terminalIds: string[]
  layoutMode: LayoutMode
  focusedTerminalId: string | null
}

interface GridStore {
  // All grid instances
  grids: GridInstance[]

  // Which grid is currently active/visible in the main view
  activeGridId: string | null

  // Actions
  createGrid: (terminalId?: string) => string
  deleteGrid: (gridId: string) => void
  addTerminalToGrid: (gridId: string, terminalId: string) => void
  removeTerminalFromGrid: (gridId: string, terminalId: string) => void
  moveTerminal: (terminalId: string, fromGridId: string, toGridId: string) => void
  reorderInGrid: (gridId: string, fromIndex: number, toIndex: number) => void
  setGridLayoutMode: (gridId: string, mode: LayoutMode) => void
  setFocusedTerminal: (gridId: string, terminalId: string | null) => void
  setActiveGrid: (gridId: string | null) => void

  // Selectors
  getGridForTerminal: (terminalId: string) => GridInstance | undefined
  getGrid: (gridId: string) => GridInstance | undefined
}

export const useGridStore = create<GridStore>()(
  persist(
    (set, get) => ({
      grids: [],
      activeGridId: null,

      createGrid: (terminalId?: string) => {
        const newId = crypto.randomUUID()
        set((state) => ({
          grids: [
            ...state.grids,
            {
              id: newId,
              terminalIds: terminalId ? [terminalId] : [],
              layoutMode: 'auto',
              focusedTerminalId: terminalId || null,
            },
          ],
          activeGridId: newId,
        }))
        return newId
      },

      deleteGrid: (gridId) =>
        set((state) => {
          const filtered = state.grids.filter((g) => g.id !== gridId)
          const newActiveId =
            state.activeGridId === gridId
              ? filtered[filtered.length - 1]?.id ?? null
              : state.activeGridId
          return {
            grids: filtered,
            activeGridId: newActiveId,
          }
        }),

      addTerminalToGrid: (gridId, terminalId) =>
        set((state) => ({
          grids: state.grids.map((g) => {
            if (g.id !== gridId) return g
            // Don't add if already in this grid
            if (g.terminalIds.includes(terminalId)) {
              return { ...g, focusedTerminalId: terminalId }
            }
            return {
              ...g,
              terminalIds: [...g.terminalIds, terminalId],
              focusedTerminalId: terminalId,
            }
          }),
          activeGridId: gridId,
        })),

      removeTerminalFromGrid: (gridId, terminalId) =>
        set((state) => {
          const grid = state.grids.find((g) => g.id === gridId)
          if (!grid) return state

          const newTerminalIds = grid.terminalIds.filter((id) => id !== terminalId)

          // If grid becomes empty, delete it
          if (newTerminalIds.length === 0) {
            const filtered = state.grids.filter((g) => g.id !== gridId)
            return {
              grids: filtered,
              activeGridId:
                state.activeGridId === gridId
                  ? filtered[filtered.length - 1]?.id ?? null
                  : state.activeGridId,
            }
          }

          // Update the grid
          return {
            grids: state.grids.map((g) => {
              if (g.id !== gridId) return g
              const newFocused =
                g.focusedTerminalId === terminalId
                  ? newTerminalIds[newTerminalIds.length - 1] ?? null
                  : g.focusedTerminalId
              return {
                ...g,
                terminalIds: newTerminalIds,
                focusedTerminalId: newFocused,
              }
            }),
          }
        }),

      moveTerminal: (terminalId, fromGridId, toGridId) => {
        // Remove from source grid
        get().removeTerminalFromGrid(fromGridId, terminalId)
        // Add to destination grid
        get().addTerminalToGrid(toGridId, terminalId)
      },

      reorderInGrid: (gridId, fromIndex, toIndex) =>
        set((state) => ({
          grids: state.grids.map((g) => {
            if (g.id !== gridId) return g
            const newIds = [...g.terminalIds]
            const [removed] = newIds.splice(fromIndex, 1)
            if (removed !== undefined) {
              newIds.splice(toIndex, 0, removed)
            }
            return { ...g, terminalIds: newIds }
          }),
        })),

      setGridLayoutMode: (gridId, mode) =>
        set((state) => ({
          grids: state.grids.map((g) =>
            g.id === gridId ? { ...g, layoutMode: mode } : g
          ),
        })),

      setFocusedTerminal: (gridId, terminalId) =>
        set((state) => ({
          grids: state.grids.map((g) =>
            g.id === gridId ? { ...g, focusedTerminalId: terminalId } : g
          ),
        })),

      setActiveGrid: (gridId) =>
        set({ activeGridId: gridId }),

      getGridForTerminal: (terminalId) =>
        get().grids.find((g) => g.terminalIds.includes(terminalId)),

      getGrid: (gridId) =>
        get().grids.find((g) => g.id === gridId),
    }),
    {
      name: 'toolchain-grid',
      storage: createJSONStorage(() => electronStorage),
      // Don't persist grids - they are recreated when terminals are restored
      // This avoids orphaned grids when terminal IDs change on restart
      partialize: () => ({}),
    }
  )
)

// Helper to clean up grids when a terminal is closed
export function removeTerminalFromAllGrids(terminalId: string): void {
  const state = useGridStore.getState()
  const grid = state.getGridForTerminal(terminalId)
  if (grid) {
    state.removeTerminalFromGrid(grid.id, terminalId)
  }
}
