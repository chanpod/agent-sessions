import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'

interface SearchExclusionsStore {
  // User-defined exclusions (directory names or glob patterns)
  exclusions: string[]

  // Actions
  addExclusion: (pattern: string) => void
  removeExclusion: (pattern: string) => void
  setExclusions: (patterns: string[]) => void
  clearExclusions: () => void
}

export const useSearchExclusionsStore = create<SearchExclusionsStore>()(
  persist(
    (set) => ({
      exclusions: [],

      addExclusion: (pattern: string) =>
        set((state) => {
          const trimmed = pattern.trim()
          if (!trimmed || state.exclusions.includes(trimmed)) {
            return state
          }
          return { exclusions: [...state.exclusions, trimmed] }
        }),

      removeExclusion: (pattern: string) =>
        set((state) => ({
          exclusions: state.exclusions.filter((e) => e !== pattern),
        })),

      setExclusions: (patterns: string[]) =>
        set({ exclusions: patterns.filter((p) => p.trim()) }),

      clearExclusions: () =>
        set({ exclusions: [] }),
    }),
    {
      name: 'toolchain-search-exclusions',
      storage: createJSONStorage(() => electronStorage),
    }
  )
)
