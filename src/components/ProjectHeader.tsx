import React, { useState, useRef, useEffect } from 'react'
import { Plus, X, FolderGit2, GitBranch, RefreshCw, Check, Settings, Trash2, Eye, EyeOff } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { useGitStore } from '../stores/git-store'
import { useToastStore } from '../stores/toast-store'
import { cn } from '../lib/utils'

interface ProjectHeaderProps {
  onCreateProject: () => void
  onEditProject: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
}

export const ProjectHeader: React.FC<ProjectHeaderProps> = ({
  onCreateProject,
  onEditProject,
  onDeleteProject,
}) => {
  const { projects, activeProjectId, setActiveProject, flashingProjects, clearProjectFlash, hideProject, showProject } = useProjectStore()
  const { gitInfo, watchProject, unwatchProject, refreshGitInfo } = useGitStore()
  const { addToast } = useToastStore()
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null)

  const [showBranchMenu, setShowBranchMenu] = useState<string | null>(null)
  const [showContextMenu, setShowContextMenu] = useState<string | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [showHiddenProjectsMenu, setShowHiddenProjectsMenu] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const hiddenProjectsMenuRef = useRef<HTMLDivElement>(null)
  const branchButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Watch git changes for all projects
  useEffect(() => {
    // Start watching all projects
    projects.forEach((project) => {
      if (project.path) {
        watchProject(project.id, project.path)
      }
    })

    // Cleanup: unwatch projects that are no longer in the list
    return () => {
      projects.forEach((project) => {
        if (project.path) {
          unwatchProject(project.id, project.path)
        }
      })
    }
  }, [projects, watchProject, unwatchProject])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(event.target as Node)) {
        const clickedButton = Object.values(branchButtonRefs.current).some(
          ref => ref && ref.contains(event.target as Node)
        )
        if (!clickedButton) {
          setShowBranchMenu(null)
        }
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setShowContextMenu(null)
      }
      if (hiddenProjectsMenuRef.current && !hiddenProjectsMenuRef.current.contains(event.target as Node)) {
        setShowHiddenProjectsMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSwitchBranch = async (projectId: string, branch: string) => {
    const project = projects.find(p => p.id === projectId)
    if (!project || isCheckingOut) return

    setIsCheckingOut(true)
    try {
      const result = await window.electron.git.checkout(project.path, branch)
      if (result.success) {
        setShowBranchMenu(null)
        addToast(`Switched to branch '${branch}'`, 'success', 3000)
        // Refresh git info after successful checkout
        await refreshGitInfo(projectId, project.path)
      } else {
        addToast(result.error || 'Failed to switch branch', 'error')
      }
    } catch (error) {
      addToast(`Error switching branch: ${error}`, 'error')
    } finally {
      setIsCheckingOut(false)
    }
  }

  const handleFetch = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    const project = projects.find(p => p.id === projectId)
    if (!project || !window.electron || isFetching) return

    setIsFetching(true)
    try {
      const result = await window.electron.git.fetch(project.path)
      if (result.success) {
        addToast('Fetched from remote', 'success', 3000)
        // Refresh git info after fetch
        await refreshGitInfo(projectId, project.path)
      } else {
        addToast(result.error || 'Failed to fetch from remote', 'error')
      }
    } catch (error) {
      addToast(`Error fetching: ${error}`, 'error')
    } finally {
      setIsFetching(false)
    }
  }

  const handleOpenBranchTool = (projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    window.electron.openExternalTool('branch', project.path)
    setShowBranchMenu(null)
  }

  const handleContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(projectId)
  }

  const handleEditProject = (projectId: string) => {
    setShowContextMenu(null)
    onEditProject(projectId)
  }

  const handleRemoveProject = (projectId: string) => {
    setShowContextMenu(null)
    onDeleteProject(projectId)
  }

  return (
    <div className="h-10 bg-[#1e1e1e] border-b border-gray-800 flex items-stretch app-drag-region">
      {/* Project Tabs */}
      <div className="flex items-stretch overflow-x-auto no-drag">
        {projects.filter(p => !p.isHidden).map((project, index) => {
          const projectGitInfo = gitInfo[project.id]
          const isFlashing = flashingProjects.has(project.id)
          return (
            <div
              key={project.id}
              className={cn(
                'relative flex items-center gap-2 px-3 border-r border-gray-800 cursor-pointer group',
                'transition-[background-color,width] duration-300 ease-out',
                activeProjectId === project.id
                  ? 'bg-[#252526] text-gray-200'
                  : 'bg-[#1e1e1e] text-gray-400 hover:bg-[#2a2a2b]',
                isFlashing && 'animate-pulse bg-blue-500/20'
              )}
              style={{
                width: 'fit-content',
                minWidth: '160px',
                maxWidth: '280px'
              }}
              onClick={() => {
                setActiveProject(project.id)
                if (isFlashing) {
                  clearProjectFlash(project.id)
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, project.id)}
              onMouseEnter={() => setHoveredProjectId(project.id)}
              onMouseLeave={() => setHoveredProjectId(null)}
            >
              <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs truncate flex-1">{project.name}</span>

              {/* Git Branch - inline in tab */}
              {projectGitInfo?.branch && (
                <button
                  ref={(el) => { branchButtonRefs.current[project.id] = el }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowBranchMenu(showBranchMenu === project.id ? null : project.id)
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-700/50 hover:bg-zinc-700 transition-colors flex-shrink-0"
                  title="Switch branch"
                >
                  <GitBranch className="w-3 h-3 text-blue-400" />
                  <span className="text-xs text-gray-300 max-w-[60px] truncate">{projectGitInfo.branch}</span>
                </button>
              )}

              {/* Close button - always reserve space to prevent layout shift */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  hideProject(project.id)
                }}
                className={cn(
                  'p-0.5 hover:bg-gray-700 rounded transition-opacity flex-shrink-0',
                  hoveredProjectId === project.id ? 'opacity-70 hover:opacity-100' : 'opacity-0 pointer-events-none'
                )}
                title="Hide project"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}

        {/* Add Project Tab */}
        <button
          onClick={onCreateProject}
          className="flex items-center justify-center px-3 border-r border-gray-800 hover:bg-[#2a2a2b] transition-colors no-drag"
          title="Add project"
        >
          <Plus className="w-4 h-4 text-gray-500" />
        </button>

        {/* Show Hidden Projects Button - only show if there are hidden projects */}
        {projects.some(p => p.isHidden) && (
          <button
            onClick={() => setShowHiddenProjectsMenu(!showHiddenProjectsMenu)}
            className="flex items-center justify-center px-3 border-r border-gray-800 hover:bg-[#2a2a2b] transition-colors no-drag"
            title="Show hidden projects"
          >
            <EyeOff className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Branch Menu Dropdown - positioned with fixed positioning */}
      {showBranchMenu && gitInfo[showBranchMenu] && (() => {
        const buttonRect = branchButtonRefs.current[showBranchMenu]?.getBoundingClientRect()
        return (
          <div
            ref={branchMenuRef}
            className="fixed py-1 bg-[#2d2d2d] border border-gray-700 rounded shadow-lg z-[100] min-w-[200px] max-h-80 overflow-y-auto no-drag"
            style={{
              top: buttonRect ? `${buttonRect.bottom + 2}px` : '0px',
              left: buttonRect ? `${buttonRect.left}px` : '0px',
            }}
          >
          {/* Fetch button */}
          <button
            onClick={(e) => handleFetch(e, showBranchMenu)}
            disabled={isFetching}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left border-b border-zinc-700 mb-1"
          >
            <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
            {isFetching ? 'Fetching...' : 'Fetch from remote'}
          </button>

          {/* Branch list */}
          {gitInfo[showBranchMenu].branches.length > 0 ? (
            <>
              <div className="px-3 py-1 text-xs text-zinc-500 uppercase">
                Local branches
              </div>
              {gitInfo[showBranchMenu].branches.map((branch) => (
                <button
                  key={branch}
                  onClick={() => handleSwitchBranch(showBranchMenu, branch)}
                  disabled={isCheckingOut || branch === gitInfo[showBranchMenu].branch}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                    branch === gitInfo[showBranchMenu].branch
                      ? 'text-green-400 bg-green-500/10'
                      : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                  )}
                >
                  {branch === gitInfo[showBranchMenu].branch ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : (
                    <GitBranch className="w-3 h-3" />
                  )}
                  <span className="truncate">{branch}</span>
                </button>
              ))}
            </>
          ) : (
            <div className="px-3 py-2 text-xs text-zinc-500">
              No branches found
            </div>
          )}

          <div className="border-t border-zinc-700 mt-1">
            <button
              onClick={() => handleOpenBranchTool(showBranchMenu)}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              Open branch tool...
            </button>
          </div>
        </div>
        )
      })()}

      {/* Context Menu - positioned with fixed positioning */}
      {showContextMenu && contextMenuPos && (
        <div
          ref={contextMenuRef}
          className="fixed py-1 bg-[#2d2d2d] border border-gray-700 rounded shadow-lg z-[100] min-w-[180px] no-drag"
          style={{
            top: `${contextMenuPos.y}px`,
            left: `${contextMenuPos.x}px`,
          }}
        >
          <button
            onClick={() => handleEditProject(showContextMenu)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
          >
            <Settings className="w-3 h-3" />
            Edit Project
          </button>
          <div className="border-t border-zinc-700 my-1" />
          <button
            onClick={() => handleRemoveProject(showContextMenu)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 text-left"
          >
            <Trash2 className="w-3 h-3" />
            Remove Project
          </button>
        </div>
      )}

      {/* Hidden Projects Menu - positioned below the eye icon button */}
      {showHiddenProjectsMenu && (
        <div
          ref={hiddenProjectsMenuRef}
          className="fixed top-10 left-0 py-1 bg-[#2d2d2d] border border-gray-700 rounded shadow-lg z-[100] min-w-[200px] max-h-80 overflow-y-auto no-drag"
          style={{
            left: `${projects.filter(p => !p.isHidden).length * 200 + 48}px`, // Approximate position after visible tabs + buttons
          }}
        >
          <div className="px-3 py-1.5 text-xs text-zinc-500 uppercase border-b border-zinc-700">
            Hidden Projects
          </div>
          {projects.filter(p => p.isHidden).map((project) => (
            <button
              key={project.id}
              onClick={() => {
                showProject(project.id)
                setShowHiddenProjectsMenu(false)
                setActiveProject(project.id)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
            >
              <Eye className="w-3 h-3" />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
