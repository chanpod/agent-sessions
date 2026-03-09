import { create } from 'zustand'

interface PermissionRequestForUI {
  id: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  receivedAt: number
  subCommandMatches?: Array<{ tokens: string[]; operator: string | null; matched: boolean }>
}

interface PermissionState {
  pendingRequests: PermissionRequestForUI[]
  hooksInstalled: boolean | null
  // Legacy per-project cache kept for backward compat
  hookInstalledCache: Record<string, boolean>
  addRequest: (request: PermissionRequestForUI) => void
  removeRequest: (id: string) => void
  getNextRequest: () => PermissionRequestForUI | null
  getNextRequestForSession: (sessionId: string | null) => PermissionRequestForUI | null
  hasRequestsForSession: (sessionId: string | null) => boolean
  getSessionIdsWithPending: () => Set<string>
  setHooksInstalled: (installed: boolean) => void
  setHookInstalled: (projectPath: string, installed: boolean) => void
  isHookInstalled: (projectPath: string) => boolean | undefined
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pendingRequests: [],
  hooksInstalled: null,
  hookInstalledCache: {},

  addRequest: (request) =>
    set((state) => ({
      pendingRequests: [...state.pendingRequests, request],
    })),

  removeRequest: (id) =>
    set((state) => ({
      pendingRequests: state.pendingRequests.filter((r) => r.id !== id),
    })),

  getNextRequest: () => get().pendingRequests[0] ?? null,

  getNextRequestForSession: (sessionId) => {
    if (!sessionId) return null
    return get().pendingRequests.find((r) => r.sessionId === sessionId) ?? null
  },

  hasRequestsForSession: (sessionId) => {
    if (!sessionId) return false
    return get().pendingRequests.some((r) => r.sessionId === sessionId)
  },

  getSessionIdsWithPending: () => {
    return new Set(get().pendingRequests.map((r) => r.sessionId))
  },

  setHooksInstalled: (installed) => set({ hooksInstalled: installed }),

  // Legacy compat: maps per-project to global
  setHookInstalled: (_projectPath, installed) =>
    set((state) => ({
      hooksInstalled: installed,
      hookInstalledCache: { ...state.hookInstalledCache, [_projectPath]: installed },
    })),

  isHookInstalled: (_projectPath) => get().hooksInstalled ?? get().hookInstalledCache[_projectPath],
}))
