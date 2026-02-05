import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'
import { useProjectStore } from './project-store'

export type ActiveView =
  | { type: 'dashboard' }
  | { type: 'project-grid'; projectId: string }
  | { type: 'project-terminal'; projectId: string; terminalId: string }

interface ViewStore {
  activeView: ActiveView
  isTerminalDockOpen: boolean

  // Actions
  setDashboardActive: () => void
  setProjectGridActive: (projectId: string) => void
  setProjectTerminalActive: (projectId: string, terminalId: string) => void
  setTerminalDockOpen: (open: boolean) => void

  // Selectors
  isDashboardActive: () => boolean
  getActiveProjectId: () => string | null
}

export const useViewStore = create<ViewStore>()(
  persist(
    (set, get) => ({
      activeView: { type: 'dashboard' } as ActiveView,
      isTerminalDockOpen: false,

      setDashboardActive: () =>
        set({ activeView: { type: 'dashboard' } }),

      setProjectGridActive: (projectId: string) => {
        set({ activeView: { type: 'project-grid', projectId } })
        // Save view state to project
        useProjectStore.getState().updateProjectLastViewState(projectId, { type: 'grid' })
      },

      setProjectTerminalActive: (projectId: string, terminalId: string) => {
        set({ activeView: { type: 'project-terminal', projectId, terminalId } })
        // Save view state to project
        useProjectStore.getState().updateProjectLastViewState(projectId, { type: 'terminal', terminalId })
      },

      setTerminalDockOpen: (open: boolean) =>
        set({ isTerminalDockOpen: open }),

      isDashboardActive: () =>
        get().activeView.type === 'dashboard',

      getActiveProjectId: () => {
        const view = get().activeView
        return view.type === 'project-grid' || view.type === 'project-terminal'
          ? view.projectId
          : null
      },
    }),
    {
      name: 'toolchain-view',
      storage: createJSONStorage(() => electronStorage),
    }
  )
)
