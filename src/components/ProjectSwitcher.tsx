import { useState, useRef, useEffect } from 'react'
import { Popover } from '@base-ui-components/react/popover'
import { ChevronDown, Plus, Pin, LayoutDashboard, Settings2 } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { useViewStore } from '../stores/view-store'
import { useGitStore } from '../stores/git-store'
import { useGridStore } from '../stores/grid-store'
import { useGlobalRulesStore } from '../stores/global-rules-store'
import { useAllProjectAgentStatuses } from '../hooks/useProjectAgentStatus'
import { ProjectSwitcherItem } from './ProjectSwitcherItem'
import { SettingsModal } from './SettingsModal'
import { cn } from '../lib/utils'

interface ProjectSwitcherProps {
  onCreateProject: () => void
  onEditProject: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
}

export function ProjectSwitcher({
  onCreateProject,
  onEditProject,
  onDeleteProject,
}: ProjectSwitcherProps) {
  const { projects, activeProjectId, setActiveProject, pinProject, unpinProject } = useProjectStore()
  const { activeView, setDashboardActive } = useViewStore()
  const watchProject = useGitStore((state) => state.watchProject)
  const dashboardTerminalCount = useGridStore((s) => s.dashboard.terminalRefs.length)
  const enabledRulesCount = useGlobalRulesStore((s) => s.rules.filter(r => r.enabled).length)

  const [open, setOpen] = useState(false)
  const [showGlobalSettings, setShowGlobalSettings] = useState(false)
  const prevProjectIdsRef = useRef<string>('')

  const agentStatuses = useAllProjectAgentStatuses()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const pinnedProjects = projects.filter((p) => p.isPinned)
  const unpinnedProjects = projects.filter((p) => !p.isPinned)
  const isDashboard = activeView.type === 'dashboard'

  // Determine if any non-active project has a notification-worthy status
  const hasGlobalNotification = projects.some((p) => {
    if (p.id === activeProjectId) return false
    const summary = agentStatuses[p.id]
    if (!summary) return false
    return summary.done > 0 || summary.needsAttention > 0 || summary.responding > 0 || summary.thinking > 0
  })

  // Git watch effect (migrated from ProjectHeader)
  useEffect(() => {
    const projectKey = projects.map((p) => `${p.id}:${p.path}`).sort().join('|')
    if (projectKey !== prevProjectIdsRef.current) {
      prevProjectIdsRef.current = projectKey
      projects.forEach((project) => {
        const gitPath = project.remotePath || project.path
        if (gitPath) {
          watchProject(project.id, gitPath)
        }
      })
    }
  }, [projects, watchProject])

  const handleSelectProject = (projectId: string) => {
    setActiveProject(projectId)
    setOpen(false)
  }

  const handleSelectDashboard = () => {
    setDashboardActive()
    setOpen(false)
  }

  // Trigger display text
  const triggerLabel = isDashboard
    ? 'Dashboard'
    : activeProject?.name ?? 'Select Project'

  return (
    <>
      <div className="flex items-center gap-1 px-3 py-2">
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors min-w-0 flex-1',
              'text-zinc-200 hover:bg-zinc-700/50',
              'group cursor-pointer'
            )}
          >
            <span className="text-sm font-medium truncate">{triggerLabel}</span>
            <ChevronDown className={cn(
              'w-3.5 h-3.5 flex-shrink-0 transition-all',
              'text-zinc-500 group-hover:text-zinc-300',
              open && 'rotate-180 text-zinc-300'
            )} />
            {/* Global notification dot */}
            {hasGlobalNotification && !open && (
              <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0 animate-pulse" />
            )}
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Positioner sideOffset={4} align="start" className="z-[100]">
              <Popover.Popup className="w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl py-1.5 outline-none">
                {/* Dashboard */}
                <button
                  onClick={handleSelectDashboard}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors rounded-md mx-0',
                    isDashboard
                      ? 'bg-zinc-700/50 text-zinc-100'
                      : 'text-zinc-300 hover:bg-zinc-700/30 hover:text-zinc-100'
                  )}
                >
                  <LayoutDashboard className="w-4 h-4 flex-shrink-0 text-zinc-400" />
                  <span className="text-sm font-medium flex-1">Dashboard</span>
                  {isDashboard && (
                    <span className="text-blue-400">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  )}
                  {!isDashboard && dashboardTerminalCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-zinc-700 text-zinc-400">
                      {dashboardTerminalCount}
                    </span>
                  )}
                </button>

                {/* Project List */}
                {projects.length > 0 && (
                  <>
                    <div className="border-t border-zinc-700/50 my-1.5 mx-3" />
                    <div className="max-h-64 overflow-y-auto px-1.5">
                      {/* Pinned projects first */}
                      {pinnedProjects.length > 0 && (
                        <>
                          <div className="flex items-center gap-1.5 px-3 py-1.5">
                            <Pin className="w-2.5 h-2.5 text-zinc-600" />
                            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Pinned</span>
                          </div>
                          {pinnedProjects.map((project) => (
                            <ProjectSwitcherItem
                              key={project.id}
                              project={project}
                              isActive={
                                (activeView.type === 'project-grid' || activeView.type === 'project-terminal') &&
                                activeProjectId === project.id
                              }
                              agentSummary={agentStatuses[project.id] ?? {
                                responding: 0, thinking: 0, done: 0,
                                needsAttention: 0, idle: 0, exited: 0,
                                total: 0, topStatus: null,
                              }}
                              onSelect={() => handleSelectProject(project.id)}
                              onEdit={() => { setOpen(false); onEditProject(project.id) }}
                              onDelete={() => { setOpen(false); onDeleteProject(project.id) }}
                              onTogglePin={() => unpinProject(project.id)}
                            />
                          ))}
                          {unpinnedProjects.length > 0 && (
                            <div className="border-t border-zinc-700/50 my-1 mx-1.5" />
                          )}
                        </>
                      )}
                      {/* Unpinned projects */}
                      {unpinnedProjects.map((project) => (
                        <ProjectSwitcherItem
                          key={project.id}
                          project={project}
                          isActive={
                            (activeView.type === 'project-grid' || activeView.type === 'project-terminal') &&
                            activeProjectId === project.id
                          }
                          agentSummary={agentStatuses[project.id] ?? {
                            responding: 0, thinking: 0, done: 0,
                            needsAttention: 0, idle: 0, exited: 0,
                            total: 0, topStatus: null,
                          }}
                          onSelect={() => handleSelectProject(project.id)}
                          onEdit={() => { setOpen(false); onEditProject(project.id) }}
                          onDelete={() => { setOpen(false); onDeleteProject(project.id) }}
                          onTogglePin={() => pinProject(project.id)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Divider */}
                <div className="border-t border-zinc-700/50 my-1.5 mx-3" />

                {/* Add Project */}
                <button
                  onClick={() => { setOpen(false); onCreateProject() }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-zinc-400 hover:bg-zinc-700/30 hover:text-zinc-200 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm">Add Project</span>
                </button>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>

        {/* Global Settings button */}
        <button
          onClick={() => setShowGlobalSettings(true)}
          className={cn(
            'relative flex items-center justify-center w-7 h-7 rounded-md transition-colors flex-shrink-0',
            showGlobalSettings
              ? 'bg-zinc-700 text-zinc-200'
              : 'text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300'
          )}
          title="Global settings"
        >
          <Settings2 className="w-4 h-4" />
          {enabledRulesCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 text-[9px] font-bold rounded-full bg-emerald-500 text-zinc-950">
              {enabledRulesCount}
            </span>
          )}
        </button>
      </div>

      {showGlobalSettings && (
        <SettingsModal onClose={() => setShowGlobalSettings(false)} />
      )}
    </>
  )
}
