import { StateStorage } from 'zustand/middleware'

/**
 * Custom storage adapter for Zustand that persists data via window.electron.store.
 *
 * Important: window.electron may not be set yet when zustand hydrates (race condition
 * with tauri-api.ts loading). We wait for it to appear before giving up.
 */

/** Wait for window.electron.store to be available (set by tauri-api.ts or Electron preload) */
function waitForStore(timeoutMs = 3000): Promise<typeof window.electron.store | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.electron?.store) return Promise.resolve(window.electron.store)

  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      if (window.electron?.store) {
        resolve(window.electron.store)
      } else if (Date.now() - start > timeoutMs) {
        console.warn('[electronStorage] Timed out waiting for store API')
        resolve(null)
      } else {
        setTimeout(check, 10)
      }
    }
    check()
  })
}

export const electronStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const store = await waitForStore()
    if (!store) {
      return localStorage.getItem(name)
    }

    try {
      const value = await store.get(name)
      return value ? JSON.stringify(value) : null
    } catch (err) {
      console.error('[electronStorage] getItem error:', err)
      return null
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    const store = await waitForStore()
    if (!store) {
      localStorage.setItem(name, value)
      return
    }

    try {
      const parsed = JSON.parse(value)
      await store.set(name, parsed)
    } catch (err) {
      console.error('[electronStorage] setItem error:', err)
    }
  },

  removeItem: async (name: string): Promise<void> => {
    const store = await waitForStore()
    if (!store) {
      localStorage.removeItem(name)
      return
    }

    try {
      await store.delete(name)
    } catch (err) {
      console.error('[electronStorage] removeItem error:', err)
    }
  },
}
