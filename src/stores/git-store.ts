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
  watchedProjects: Map<string, string> // path -> projectId

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
  watchedProjects: new Map(),

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
    console.log(`[GitStore] watchProject called for projectId=${projectId}, projectPath=${projectPath}`)
    if (!window.electron || !projectPath) {
      console.log(`[GitStore] Skipping watchProject - no electron or projectPath`)
      return
    }

    const { watchedProjects } = get()

    // Set up global listener once
    if (!globalListenerSetup) {
      console.log(`[GitStore] Setting up global git change listener`)
      globalListenerSetup = true
      globalUnsubscribe = window.electron.git.onChanged((changedPath) => {
        const { watchedProjects } = get()
        const projectId = watchedProjects.get(changedPath)
        if (projectId) {
          console.log(`[GitStore] Git changed for path ${changedPath}, refreshing project ${projectId}`)
          get().refreshGitInfo(projectId, changedPath)
        }
      })
    }

    // Only watch if not already watching
    if (!watchedProjects.has(projectPath)) {
      console.log(`[GitStore] Starting git watch for ${projectPath}`)
      window.electron.git.watch(projectPath)

      set((state) => {
        const newWatchedProjects = new Map(state.watchedProjects)
        newWatchedProjects.set(projectPath, projectId)
        return { watchedProjects: newWatchedProjects }
      })

      // Fetch initial git info only for new watches
      console.log(`[GitStore] Fetching initial git info for new watch`)
      await get().refreshGitInfo(projectId, projectPath)
    } else {
      console.log(`[GitStore] Already watching ${projectPath}, skipping refresh`)
    }
  },

  unwatchProject: (projectId: string, projectPath: string) => {
    if (!window.electron || !projectPath) return

    const { watchedProjects } = get()

    if (watchedProjects.has(projectPath)) {
      window.electron.git.unwatch(projectPath)

      set((state) => {
        const newWatchedProjects = new Map(state.watchedProjects)
        newWatchedProjects.delete(projectPath)
        return { watchedProjects: newWatchedProjects }
      })
    }

    get().removeGitInfo(projectId)
  },

  refreshGitInfo: async (projectId: string, projectPath: string) => {
    console.log('🌍 HELLO WORLD - GIT REFRESH STARTING 🌍')
    console.log(`[GitStore] refreshGitInfo called for projectId=${projectId}, projectPath=${projectPath}`)
    if (!window.electron || !projectPath) {
      console.log(`[GitStore] Skipping - no electron or projectPath`)
      return
    }

    // Log project details for debugging
    const projects = (window as any).__project_store__?.getState?.()?.projects
    const project = projects?.find((p: any) => p.id === projectId)
    console.log(`[GitStore] Project details:`, { isSSHProject: project?.isSSHProject, connectionStatus: project?.connectionStatus })

    // Note: We don't check connection status here anymore - let the backend decide if it can handle the request
    // The backend will use SSH if connected, or fail appropriately if not

    try {
      console.log(`[GitStore] Calling window.electron.git.getInfo with projectPath=${projectPath}, projectId=${projectId}`)
      const result = await window.electron.git.getInfo(projectPath, projectId)
      console.log(`[GitStore] getInfo result:`, result)

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
