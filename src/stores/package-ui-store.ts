/**
 * Package UI Store - Manages UI state for package.json scripts display
 * Handles minimize/expand and pin functionality for monorepo packages
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'

interface PackageUIState {
  // Map of projectId -> packagePath -> state
  packageStates: Record<string, Record<string, {
    minimized: boolean
    pinned: boolean
  }>>

  // Actions
  toggleMinimized: (projectId: string, packagePath: string) => void
  togglePinned: (projectId: string, packagePath: string) => void
  isMinimized: (projectId: string, packagePath: string, defaultMinimized?: boolean) => boolean
  isPinned: (projectId: string, packagePath: string) => boolean
}

export const usePackageUIStore = create<PackageUIState>()(
  persist(
    (set, get) => ({
      packageStates: {},

      toggleMinimized: (projectId, packagePath) =>
        set((state) => {
          const projectStates = state.packageStates[projectId] || {}
          const currentState = projectStates[packagePath] || { minimized: false, pinned: false }

          return {
            packageStates: {
              ...state.packageStates,
              [projectId]: {
                ...projectStates,
                [packagePath]: {
                  ...currentState,
                  minimized: !currentState.minimized,
                },
              },
            },
          }
        }),

      togglePinned: (projectId, packagePath) =>
        set((state) => {
          const projectStates = state.packageStates[projectId] || {}
          const currentState = projectStates[packagePath] || { minimized: false, pinned: false }

          return {
            packageStates: {
              ...state.packageStates,
              [projectId]: {
                ...projectStates,
                [packagePath]: {
                  ...currentState,
                  pinned: !currentState.pinned,
                },
              },
            },
          }
        }),

      isMinimized: (projectId, packagePath, defaultMinimized = false) => {
        const state = get()
        const packageState = state.packageStates[projectId]?.[packagePath]

        // If state exists, use it; otherwise use the default
        if (packageState !== undefined) {
          return packageState.minimized
        }
        return defaultMinimized
      },

      isPinned: (projectId, packagePath) => {
        const state = get()
        return state.packageStates[projectId]?.[packagePath]?.pinned || false
      },
    }),
    {
      name: 'package-ui-state',
      storage: createJSONStorage(() => electronStorage),
    }
  )
)
