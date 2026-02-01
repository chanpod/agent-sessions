import { create } from 'zustand'

// Memoization cache for filtered results to prevent new array references on every call
const memoCache = {
  dockerServices: new Map<string, { services: ServiceInfo[]; result: ServiceInfo[] }>(),
  ptyServices: new Map<string, { services: ServiceInfo[]; result: ServiceInfo[] }>(),
  projectServices: new Map<string, { services: ServiceInfo[]; result: ServiceInfo[] }>(),
}

// Helper to get memoized filtered results
function getMemoizedFilter<T>(
  cache: Map<string, { services: T[]; result: T[] }>,
  key: string,
  services: T[],
  filterFn: (services: T[]) => T[]
): T[] {
  const cached = cache.get(key)
  // Return cached result if services array reference hasn't changed
  if (cached && cached.services === services) {
    return cached.result
  }
  const result = filterFn(services)
  cache.set(key, { services, result })
  return result
}

// Service status type matching the backend
export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'error' | 'unknown'

// Service info from the backend
export interface ServiceInfo {
  id: string
  type: 'pty' | 'docker-compose'
  name: string
  projectId: string
  status: ServiceStatus
  // For docker-compose
  composePath?: string
  serviceName?: string
  // For PTY
  pid?: number
  command?: string
}

interface ServiceStore {
  // All discovered services
  services: ServiceInfo[]

  // Docker availability flag
  dockerAvailable: boolean | null

  // Loading state per project
  loadingProjects: Set<string>

  // Actions
  setServices: (projectId: string, services: ServiceInfo[]) => void
  updateServiceStatus: (serviceId: string, status: ServiceStatus) => void
  removeService: (serviceId: string) => void
  clearProjectServices: (projectId: string) => void
  setDockerAvailable: (available: boolean) => void
  setProjectLoading: (projectId: string, loading: boolean) => void

  // Selectors
  getServicesByProject: (projectId: string) => ServiceInfo[]
  getDockerServices: (projectId: string) => ServiceInfo[]
  getPtyServices: (projectId: string) => ServiceInfo[]
  getServiceById: (serviceId: string) => ServiceInfo | undefined
}

export const useServiceStore = create<ServiceStore>()((set, get) => ({
  services: [],
  dockerAvailable: null,
  loadingProjects: new Set(),

  setServices: (projectId, newServices) =>
    set((state) => {
      // Remove existing services for this project and add new ones
      const otherServices = state.services.filter(s => s.projectId !== projectId)
      return { services: [...otherServices, ...newServices] }
    }),

  updateServiceStatus: (serviceId, status) =>
    set((state) => ({
      services: state.services.map((s) =>
        s.id === serviceId ? { ...s, status } : s
      ),
    })),

  removeService: (serviceId) =>
    set((state) => ({
      services: state.services.filter((s) => s.id !== serviceId),
    })),

  clearProjectServices: (projectId) =>
    set((state) => ({
      services: state.services.filter((s) => s.projectId !== projectId),
    })),

  setDockerAvailable: (available) =>
    set({ dockerAvailable: available }),

  setProjectLoading: (projectId, loading) =>
    set((state) => {
      const newSet = new Set(state.loadingProjects)
      if (loading) {
        newSet.add(projectId)
      } else {
        newSet.delete(projectId)
      }
      return { loadingProjects: newSet }
    }),

  // Selectors - using memoization to prevent new array references on every call
  getServicesByProject: (projectId) =>
    getMemoizedFilter(
      memoCache.projectServices,
      projectId,
      get().services,
      (services) => services.filter((s) => s.projectId === projectId)
    ),

  getDockerServices: (projectId) =>
    getMemoizedFilter(
      memoCache.dockerServices,
      projectId,
      get().services,
      (services) => services.filter((s) => s.projectId === projectId && s.type === 'docker-compose')
    ),

  getPtyServices: (projectId) =>
    getMemoizedFilter(
      memoCache.ptyServices,
      projectId,
      get().services,
      (services) => services.filter((s) => s.projectId === projectId && s.type === 'pty')
    ),

  getServiceById: (serviceId) =>
    get().services.find((s) => s.id === serviceId),
}))
