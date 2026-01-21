import { create } from 'zustand'
import type { ChangedFile } from '../types/electron'

export interface GitInfo {
  branch: string | null
  branches: string[]
  isGitRepo: boolean
  hasChanges: boolean
  ahead: number
  behind: number
  changedFiles: ChangedFile[]
}

interface GitStore {
  // Map of projectId -> GitInfo
  gitInfo: Record<string, GitInfo>

  // Currently watched paths and their project IDs
  watchedProjects: Record<string, string> // path -> projectId

  // Set git info for a project
  setGitInfo: (projectId: string, info: GitInfo) => void

  // Remove git info for a project
  removeGitInfo: (projectId: string) => void

  // Start watching a project path
  watchProject: (projectId: string, projectPath: string) => Promise<void>

  // Stop watching a project path
  unwatchProject: (projectId: string, projectPath: string) => void

  // Refresh git info for a specific project
  refreshGitInfo: (projectId: string, projectPath: string) => Promise<void>

  // Refresh all projects
  refreshAll: (projects: Array<{ id: string; path: string }>) => Promise<void>
}

// Global listener setup - only set up once
let globalListenerSetup = false
let globalUnsubscribe: (() => void) | null = null

export const useGitStore = create<GitStore>((set, get) => ({
  gitInfo: {},
  watchedProjects: {},

  setGitInfo: (projectId: string, info: GitInfo) => {
    set((state) => ({
      gitInfo: {
        ...state.gitInfo,
        [projectId]: info,
      },
    }))
  },

  removeGitInfo: (projectId: string) => {
    set((state) => {
      const newGitInfo = { ...state.gitInfo }
      delete newGitInfo[projectId]
      return { gitInfo: newGitInfo }
    })
  },

  watchProject: async (projectId: string, projectPath: string) => {
    if (!window.electron || !projectPath) {
      return
    }

    const { watchedProjects } = get()

    // Set up global listener once
    if (!globalListenerSetup) {
      globalListenerSetup = true
      globalUnsubscribe = window.electron.git.onChanged((changedPath) => {
        const { watchedProjects } = get()
        const projectId = watchedProjects[changedPath]
        if (projectId) {
          get().refreshGitInfo(projectId, changedPath)
        }
      })
    }

    // Only watch if not already watching
    if (!watchedProjects[projectPath]) {
      try {
        const watchResult = await window.electron.git.watch(projectPath)

        if (!watchResult.success) {
          console.error(`[GitStore] Watch failed:`, watchResult.error)
          return
        }
      } catch (err) {
        console.error(`[GitStore] Exception calling watch:`, err)
        return
      }

      set((state) => {
        const newWatchedProjects = { ...state.watchedProjects }
        newWatchedProjects[projectPath] = projectId
        return { watchedProjects: newWatchedProjects }
      })

      // Fetch initial git info only for new watches
      await get().refreshGitInfo(projectId, projectPath)
    }
  },

  unwatchProject: (projectId: string, projectPath: string) => {
    if (!window.electron || !projectPath) return

    const { watchedProjects } = get()

    if (watchedProjects[projectPath]) {
      window.electron.git.unwatch(projectPath)

      set((state) => {
        const newWatchedProjects = { ...state.watchedProjects }
        delete newWatchedProjects[projectPath]
        return { watchedProjects: newWatchedProjects }
      })
    }

    get().removeGitInfo(projectId)
  },

  refreshGitInfo: async (projectId: string, projectPath: string) => {
    if (!window.electron || !projectPath) {
      return
    }

    try {
      const result = await window.electron.git.getInfo(projectPath, projectId)

      if (result.isGitRepo) {
        // Fetch branches
        const branchesResult = await window.electron.git.listBranches(projectPath, projectId)

        // Fetch changed files if there are changes
        let changedFiles: ChangedFile[] = []
        if (result.hasChanges) {
          const filesResult = await window.electron.git.getChangedFiles(projectPath, projectId)
          if (filesResult.success && filesResult.files) {
            changedFiles = filesResult.files
          }
        }

        get().setGitInfo(projectId, {
          branch: result.branch || null,
          branches: branchesResult.success && branchesResult.localBranches ? branchesResult.localBranches : [],
          isGitRepo: true,
          hasChanges: result.hasChanges || false,
          ahead: result.ahead || 0,
          behind: result.behind || 0,
          changedFiles,
        })
      } else {
        get().setGitInfo(projectId, {
          branch: null,
          branches: [],
          isGitRepo: false,
          hasChanges: false,
          ahead: 0,
          behind: 0,
          changedFiles: [],
        })
      }
    } catch (error) {
      console.error('Failed to refresh git info:', error)
      get().setGitInfo(projectId, {
        branch: null,
        branches: [],
        isGitRepo: false,
        hasChanges: false,
        ahead: 0,
        behind: 0,
        changedFiles: [],
      })
    }
  },

  refreshAll: async (projects: Array<{ id: string; path: string }>) => {
    await Promise.all(
      projects.map((project) => get().refreshGitInfo(project.id, project.path))
    )
  },
}))

// Cleanup function for when the app unmounts
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (globalUnsubscribe) {
      globalUnsubscribe()
    }
  })
}
