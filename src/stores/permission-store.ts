import { create } from 'zustand'

interface PermissionRequestForUI {
  id: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  receivedAt: number
}

interface PermissionState {
  pendingRequests: PermissionRequestForUI[]
  hookInstalledCache: Record<string, boolean>
  addRequest: (request: PermissionRequestForUI) => void
  removeRequest: (id: string) => void
  getNextRequest: () => PermissionRequestForUI | null
  setHookInstalled: (projectPath: string, installed: boolean) => void
  isHookInstalled: (projectPath: string) => boolean | undefined
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pendingRequests: [],
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

  setHookInstalled: (projectPath, installed) =>
    set((state) => ({
      hookInstalledCache: { ...state.hookInstalledCache, [projectPath]: installed },
    })),

  isHookInstalled: (projectPath) => get().hookInstalledCache[projectPath],
}))
