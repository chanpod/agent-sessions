import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'
import { LayoutMode } from './grid-store'
import { useViewStore } from './view-store'
import { useTerminalStore } from './terminal-store'
import { useNotificationStore } from './notification-store'

export type ProjectTab = 'terminals' | 'files' | 'git' | 'search'

export type ProjectViewState =
  | { type: 'grid' }
  | { type: 'terminal'; terminalId: string }

export interface Project {
  id: string
  name: string
  path: string // Root directory path (optional - can be empty for SSH-only projects)
  createdAt: number
  isExpanded: boolean
  activeTab: ProjectTab
  isPinned?: boolean // Whether the project is pinned to the top of the list
  // SSH project fields
  isSSHProject?: boolean // Whether this project uses SSH
  sshConnectionId?: string // ID of the SSH connection to use
  remotePath?: string // Remote directory path on the SSH host
  // Connection state (runtime only, not persisted)
  connectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error'
  connectionError?: string
  // Grid state embedded in project
  gridTerminalIds: string[]
  gridLayoutMode: LayoutMode
  lastFocusedTerminalId: string | null
  // View state memory - remembers if user was viewing grid or single terminal
  lastViewState?: ProjectViewState
  // Remembers which agent session was active for this project
  lastActiveAgentSessionId?: string
  // Timestamp of when this project was last viewed/active
  lastViewedAt?: number
}

export interface ProjectNotification {
  type: 'done' | 'needs-attention' | 'activity'
  count: number
  updatedAt: number
}

interface ProjectStore {
  projects: Project[]
  activeProjectId: string | null
  projectNotifications: Record<string, ProjectNotification>

  // Actions
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'isExpanded' | 'activeTab'>) => string
  removeProject: (id: string) => void
  pinProject: (id: string) => void
  unpinProject: (id: string) => void
  setActiveProject: (id: string | null) => void
  toggleProjectExpanded: (id: string) => void
  setProjectTab: (id: string, tab: ProjectTab) => void
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'path' | 'isSSHProject' | 'sshConnectionId' | 'remotePath'>>) => void
  setProjectNotification: (projectId: string, notification: ProjectNotification) => void
  clearProjectNotification: (projectId: string) => void
  // SSH connection management
  setProjectConnectionStatus: (id: string, status: 'disconnected' | 'connecting' | 'connected' | 'error', error?: string) => void
  connectProject: (id: string) => Promise<{ success: boolean; requiresInteractive?: boolean; error?: string } | undefined>
  disconnectProject: (id: string) => Promise<void>
  // Grid actions (per-project)
  addTerminalToProject: (projectId: string, terminalId: string) => void
  removeTerminalFromProject: (projectId: string, terminalId: string) => void
  setProjectLayoutMode: (projectId: string, mode: LayoutMode) => void
  setProjectFocusedTerminal: (projectId: string, terminalId: string | null) => void
  reorderProjectTerminals: (projectId: string, fromIndex: number, toIndex: number) => void
  // View state memory
  updateProjectLastViewState: (projectId: string, viewState: ProjectViewState) => void
  updateProjectLastActiveAgentSession: (projectId: string, agentSessionId: string | null) => void
}

function generateId(): string {
  return crypto.randomUUID()
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      projectNotifications: {} as Record<string, ProjectNotification>,

      addProject: (project) => {
        const id = generateId()
        const newProject: Project = {
          ...project,
          id,
          createdAt: Date.now(),
          isExpanded: true,
          activeTab: 'terminals',
          gridTerminalIds: [],
          gridLayoutMode: 'auto',
          lastFocusedTerminalId: null,
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

      pinProject: (id) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, isPinned: true } : p
          ),
        })),

      unpinProject: (id) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, isPinned: false } : p
          ),
        })),

      setActiveProject: (id) => {
        const state = get()
        const terminalStore = useTerminalStore.getState()

        // Save current project's active agent session before switching
        if (state.activeProjectId) {
          const currentAgentSessionId = terminalStore.activeAgentSessionId
          if (currentAgentSessionId) {
            // Save the active agent session to the current project
            set((s) => ({
              projects: s.projects.map((p) =>
                p.id === state.activeProjectId
                  ? { ...p, lastActiveAgentSessionId: currentAgentSessionId }
                  : p
              ),
            }))
          }
        }

        // If switching to a project, restore its view state
        if (id) {
          const project = state.projects.find((p) => p.id === id)
          if (project?.lastViewState) {
            // Restore the saved view state
            if (project.lastViewState.type === 'terminal') {
              useViewStore.getState().setProjectTerminalActive(id, project.lastViewState.terminalId)
              terminalStore.setActiveSession(project.lastViewState.terminalId)
            } else {
              useViewStore.getState().setProjectGridActive(id)
            }
          } else {
            // Default to grid view
            useViewStore.getState().setProjectGridActive(id)
          }

          // Restore the project's active agent session
          if (project?.lastActiveAgentSessionId) {
            terminalStore.setActiveAgentSession(project.lastActiveAgentSessionId)
          } else {
            // No saved agent session - find the most recent agent session for this project
            const projectAgentSessions = terminalStore.sessions.filter(
              (s) => s.projectId === id && s.terminalType === 'agent'
            )
            const lastAgent = projectAgentSessions[projectAgentSessions.length - 1]
            terminalStore.setActiveAgentSession(lastAgent?.id ?? null)
          }
        } else {
          terminalStore.setActiveAgentSession(null)
        }

        set((state) => {
          // Clear notification when project becomes active
          const projectNotifications = id
            ? (() => { const { [id]: _, ...rest } = state.projectNotifications; return rest })()
            : state.projectNotifications
          return {
            activeProjectId: id,
            projectNotifications,
            projects: state.projects.map((p) =>
              p.id === id ? { ...p, lastViewedAt: Date.now() } : p
            ),
          }
        })

        // Auto-dismiss notifications for the newly active project
        if (id) {
          useNotificationStore.getState().dismissAllForProject(id)
        }

        // Auto-dismiss notifications for the newly active project
        if (id) {
          useNotificationStore.getState().dismissAllForProject(id)
        }
      },

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

      setProjectNotification: (projectId, notification) =>
        set((state) => ({
          projectNotifications: { ...state.projectNotifications, [projectId]: notification },
        })),

      clearProjectNotification: (projectId) =>
        set((state) => {
          const { [projectId]: _, ...rest } = state.projectNotifications
          return { projectNotifications: rest }
        }),

      setProjectConnectionStatus: (id, status, error) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, connectionStatus: status, connectionError: error } : p
          ),
        })),

      connectProject: async (id) => {
        const project = get().projects.find((p) => p.id === id)
        if (!project?.isSSHProject || !project.sshConnectionId) {
          console.error('[ProjectStore] Cannot connect non-SSH project or missing sshConnectionId')
          return
        }

        // Set connecting status
        get().setProjectConnectionStatus(id, 'connecting')

        try {
          if (!window.electron) {
            throw new Error('Electron API not available')
          }

          // The SSH connection should already be established by the SSH store
          // Just establish the project-level master connection
          console.log('[ProjectStore] Establishing project master connection...')
          const result = await window.electron.ssh.connectProject(id, project.sshConnectionId)

          if (result.success) {
            get().setProjectConnectionStatus(id, 'connected')
          } else if (result.requiresInteractive) {
            // Password auth requires an interactive terminal
            // Return the requiresInteractive flag so UI can handle it
            console.log('[ProjectStore] Password auth requires interactive terminal')
            // Status stays as 'connecting' - will be updated when terminal connects
            return result
          } else {
            get().setProjectConnectionStatus(id, 'error', result.error)
          }

          return result
        } catch (error) {
          console.error('[ProjectStore] Failed to connect project:', error)
          get().setProjectConnectionStatus(id, 'error', String(error))
        }
      },

      disconnectProject: async (id) => {
        const project = get().projects.find((p) => p.id === id)
        if (!project?.isSSHProject) {
          return
        }

        try {
          if (!window.electron) {
            throw new Error('Electron API not available')
          }

          await window.electron.ssh.disconnectProject(id)
          get().setProjectConnectionStatus(id, 'disconnected')
        } catch (error) {
          console.error('[ProjectStore] Failed to disconnect project:', error)
        }
      },

      addTerminalToProject: (projectId, terminalId) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId && !p.gridTerminalIds.includes(terminalId)
              ? { ...p, gridTerminalIds: [...p.gridTerminalIds, terminalId], lastFocusedTerminalId: terminalId }
              : p
          ),
        })),

      removeTerminalFromProject: (projectId, terminalId) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  gridTerminalIds: p.gridTerminalIds.filter((id) => id !== terminalId),
                  lastFocusedTerminalId: p.lastFocusedTerminalId === terminalId ? null : p.lastFocusedTerminalId,
                }
              : p
          ),
        })),

      setProjectLayoutMode: (projectId, mode) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, gridLayoutMode: mode } : p
          ),
        })),

      setProjectFocusedTerminal: (projectId, terminalId) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, lastFocusedTerminalId: terminalId } : p
          ),
        })),

      reorderProjectTerminals: (projectId, fromIndex, toIndex) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id !== projectId) return p
            const newIds = [...p.gridTerminalIds]
            const [removed] = newIds.splice(fromIndex, 1)
            newIds.splice(toIndex, 0, removed)
            return { ...p, gridTerminalIds: newIds }
          }),
        })),

      updateProjectLastViewState: (projectId, viewState) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, lastViewState: viewState } : p
          ),
        })),

      updateProjectLastActiveAgentSession: (projectId, agentSessionId) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, lastActiveAgentSessionId: agentSessionId ?? undefined } : p
          ),
        })),
    }),
    {
      name: 'toolchain-projects',
      storage: createJSONStorage(() => electronStorage),
      // Don't persist projectNotifications and connection status (runtime state only)
      partialize: (state) => ({
        projects: state.projects.map(p => ({
          ...p,
          connectionStatus: undefined,
          connectionError: undefined,
        })),
        activeProjectId: state.activeProjectId,
      }),
      onRehydrateStorage: () => {
        console.log('[ProjectStore] Starting hydration...')
        return (state, error) => {
          if (error) {
            console.error('[ProjectStore] Hydration error:', error)
          } else {
            console.log('[ProjectStore] Hydrated with state:', state)
            // Initialize projectNotifications if not present
            if (state && !state.projectNotifications) {
              state.projectNotifications = {}
            }
            // Migration: Add activeTab to existing projects (only if missing)
            if (state) {
              const needsActiveTabMigration = state.projects.some((p) => !(p as any).activeTab)
              if (needsActiveTabMigration) {
                console.log('[ProjectStore] Running migration for activeTab...')
                state.projects = state.projects.map((p) => ({
                  ...p,
                  activeTab: (p as any).activeTab || 'terminals',
                }))
              }
              // Migration: Convert isHidden to isPinned (hidden projects become unpinned)
              const needsHiddenMigration = state.projects.some((p) => (p as any).isHidden !== undefined)
              if (needsHiddenMigration) {
                console.log('[ProjectStore] Running migration: isHidden → isPinned...')
                state.projects = state.projects.map((p) => {
                  const { isHidden, ...rest } = p as any
                  return { ...rest, isPinned: rest.isPinned ?? false }
                })
              }
              // Migration: Add grid fields to existing projects
              const needsGridMigration = state.projects.some((p) => !Array.isArray((p as any).gridTerminalIds))
              if (needsGridMigration) {
                console.log('[ProjectStore] Running migration for grid fields...')
                state.projects = state.projects.map((p) => ({
                  ...p,
                  gridTerminalIds: (p as any).gridTerminalIds ?? [],
                  gridLayoutMode: (p as any).gridLayoutMode ?? 'auto',
                  lastFocusedTerminalId: (p as any).lastFocusedTerminalId ?? null,
                }))
              }
            }
          }
        }
      },
    }
  )
)

// Expose store globally for cross-store access
if (typeof window !== 'undefined') {
  (window as any).__project_store__ = useProjectStore
}
