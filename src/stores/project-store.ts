import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'

export type ProjectTab = 'terminals' | 'files' | 'git'

export interface Project {
  id: string
  name: string
  path: string // Root directory path (optional - can be empty for SSH-only projects)
  createdAt: number
  isExpanded: boolean
  activeTab: ProjectTab
  // SSH project fields
  isSSHProject?: boolean // Whether this project uses SSH
  sshConnectionId?: string // ID of the SSH connection to use
  remotePath?: string // Remote directory path on the SSH host
}

interface ProjectStore {
  projects: Project[]
  activeProjectId: string | null

  // Actions
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'isExpanded' | 'activeTab'>) => string
  removeProject: (id: string) => void
  setActiveProject: (id: string | null) => void
  toggleProjectExpanded: (id: string) => void
  setProjectTab: (id: string, tab: ProjectTab) => void
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'path' | 'isSSHProject' | 'sshConnectionId' | 'remotePath'>>) => void
}

function generateId(): string {
  return crypto.randomUUID()
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,

      addProject: (project) => {
        const id = generateId()
        const newProject: Project = {
          ...project,
          id,
          createdAt: Date.now(),
          isExpanded: true,
          activeTab: 'terminals',
        }
        set((state) => ({
          projects: [...state.projects, newProject],
          activeProjectId: id,
        }))
        return id
      },

      removeProject: (id) =>
        set((state) => {
          const filtered = state.projects.filter((p) => p.id !== id)
          const newActiveId =
            state.activeProjectId === id
              ? filtered[0]?.id ?? null
              : state.activeProjectId
          return {
            projects: filtered,
            activeProjectId: newActiveId,
          }
        }),

      setActiveProject: (id) =>
        set({ activeProjectId: id }),

      toggleProjectExpanded: (id) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, isExpanded: !p.isExpanded } : p
          ),
        })),

      setProjectTab: (id, tab) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, activeTab: tab } : p
          ),
        })),

      updateProject: (id, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),
    }),
    {
      name: 'toolchain-projects',
      storage: createJSONStorage(() => electronStorage),
      onRehydrateStorage: () => {
        console.log('[ProjectStore] Starting hydration...')
        return (state, error) => {
          if (error) {
            console.error('[ProjectStore] Hydration error:', error)
          } else {
            console.log('[ProjectStore] Hydrated with state:', state)
            // Migration: Add activeTab to existing projects (only if missing)
            if (state) {
              const needsMigration = state.projects.some((p) => !(p as any).activeTab)
              if (needsMigration) {
                console.log('[ProjectStore] Running migration for activeTab...')
                state.projects = state.projects.map((p) => ({
                  ...p,
                  activeTab: (p as any).activeTab || 'terminals',
                }))
              }
            }
          }
        }
      },
    }
  )
)
