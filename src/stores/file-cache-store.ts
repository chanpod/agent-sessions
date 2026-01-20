import { create } from 'zustand'
import type { DirEntry } from '../types/electron'

interface DirCache {
  entries: DirEntry[]
  timestamp: number
  isLoading: boolean
  error: string | null
}

interface FileCacheStore {
  // Map of path -> cached directory listing
  cache: Map<string, DirCache>

  // Actions
  getCachedDir: (path: string) => DirCache | undefined
  setCachedDir: (path: string, entries: DirEntry[], error?: string | null) => void
  setLoading: (path: string, isLoading: boolean) => void
  clearCache: (path?: string) => void
}

export const useFileCacheStore = create<FileCacheStore>((set, get) => ({
  cache: new Map(),

  getCachedDir: (path: string) => {
    return get().cache.get(path)
  },

  setCachedDir: (path: string, entries: DirEntry[], error: string | null = null) => {
    set((state) => {
      const newCache = new Map(state.cache)
      newCache.set(path, {
        entries,
        timestamp: Date.now(),
        isLoading: false,
        error,
      })
      return { cache: newCache }
    })
  },

  setLoading: (path: string, isLoading: boolean) => {
    set((state) => {
      const newCache = new Map(state.cache)
      const existing = newCache.get(path)
      if (existing || isLoading) {
        newCache.set(path, {
          entries: existing?.entries || [],
          timestamp: existing?.timestamp || Date.now(),
          isLoading,
          error: existing?.error || null,
        })
      }
      return { cache: newCache }
    })
  },

  clearCache: (path?: string) => {
    set((state) => {
      if (path) {
        const newCache = new Map(state.cache)
        newCache.delete(path)
        return { cache: newCache }
      }
      return { cache: new Map() }
    })
  },
}))
