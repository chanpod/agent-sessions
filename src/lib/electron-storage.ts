import { StateStorage } from 'zustand/middleware'

/**
 * Custom storage adapter for Zustand that uses Electron's main process
 * to persist data to the filesystem via electron-store.
 *
 * This is more reliable than localStorage in Electron dev mode.
 */
export const electronStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined' || !window.electron?.store) {
      // Fallback to localStorage if not in Electron
      return localStorage.getItem(name)
    }

    try {
      const value = await window.electron.store.get(name)
      return value ? JSON.stringify(value) : null
    } catch (err) {
      console.error('[electronStorage] getItem error:', err)
      return null
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined' || !window.electron?.store) {
      // Fallback to localStorage if not in Electron
      localStorage.setItem(name, value)
      return
    }

    try {
      // Parse the JSON string back to an object for storage
      const parsed = JSON.parse(value)
      await window.electron.store.set(name, parsed)
    } catch (err) {
      console.error('[electronStorage] setItem error:', err)
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined' || !window.electron?.store) {
      // Fallback to localStorage if not in Electron
      localStorage.removeItem(name)
      return
    }

    try {
      await window.electron.store.delete(name)
    } catch (err) {
      console.error('[electronStorage] removeItem error:', err)
    }
  },
}
