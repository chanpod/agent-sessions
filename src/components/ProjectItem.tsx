import { ChevronRight, Terminal, X, Server, GitBranch, Plus, Minus, Folder, Play, Square, Command, RefreshCw, Check, Cloud, GripVertical, Pencil, FileCode, FileText, FilePlus, FileMinus, FileQuestion, FileSymlink, ExternalLink, Undo2 } from 'lucide-react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore, TerminalSession } from '../stores/terminal-store'
import { useServerStore, ServerInstance } from '../stores/server-store'
import { useGridStore } from '../stores/grid-store'
import { ActivityIndicator } from './ActivityIndicator'
import { FileBrowser } from './FileBrowser'
import { ProjectTabBar } from './ProjectTabBar'
import { TerminalsTab } from './TerminalsTab'
import { FilesTab } from './FilesTab'
import { GitTab } from './GitTab'
import { cn } from '../lib/utils'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ChangedFile } from '../types/electron'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { useFileViewerStore } from '../stores/file-viewer-store'

interface ShellInfo {
  name: string
  path: string
}

interface ScriptInfo {
  name: string
  command: string
}

interface ProjectItemProps {
  project: Project
  shells: ShellInfo[]
  onCreateTerminal: (projectId: string, shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onRestartServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

export function ProjectItem({
  project,
  shells,
  onCreateTerminal,
  onCloseTerminal,
  onStartServer,
  onStopServer,
  onRestartServer,
  onDeleteServer,
}: ProjectItemProps) {
  const { toggleProjectExpanded, activeProjectId, setActiveProject, setProjectTab } = useProjectStore()
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
  const { servers } = useServerStore()
  const { openFile } = useFileViewerStore()

  const [showShellMenu, setShowShellMenu] = useState(false)
  const [showServerMenu, setShowServerMenu] = useState(false)
  const [scripts, setScripts] = useState<ScriptInfo[]>([])
  const [packageManager, setPackageManager] = useState('npm')
  const [showCustomCommand, setShowCustomCommand] = useState(false)
  const [customCommand, setCustomCommand] = useState('')
  const [customName, setCustomName] = useState('')
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [gitHasChanges, setGitHasChanges] = useState(false)
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [localBranches, setLocalBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])
  const [showChangedFilesMenu, setShowChangedFilesMenu] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null) // file path to confirm discard

  // Refs and positions for portal-based dropdowns
  const changedFilesBtnRef = useRef<HTMLButtonElement>(null)
  const branchBtnRef = useRef<HTMLButtonElement>(null)
  const changedFilesMenuRef = useRef<HTMLDivElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const [changedFilesMenuPos, setChangedFilesMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [branchMenuPos, setBranchMenuPos] = useState<{ top: number; left: number } | null>(null)

  // Filter out server terminals from regular terminal list (they have shell: '')
  const projectSessions = sessions.filter((s) => s.projectId === project.id && s.shell !== '')
  const projectServers = servers.filter((s) => s.projectId === project.id)
  const isActive = activeProjectId === project.id

  // Check if this project contains the active/focused terminal
  const hasFocusedTerminal = activeSessionId &&
    sessions.some(s => s.id === activeSessionId && s.projectId === project.id)

  // Fetch git info and watch for changes
  useEffect(() => {
    if (!window.electron) return

    const fetchGitInfo = async () => {
      const result = await window.electron!.git.getInfo(project.path)
      if (result.isGitRepo) {
        setGitBranch(result.branch || null)
        setGitHasChanges(result.hasChanges || false)
        // Fetch changed files if there are changes
        if (result.hasChanges) {
          const filesResult = await window.electron!.git.getChangedFiles(project.path)
          if (filesResult.success && filesResult.files) {
            setChangedFiles(filesResult.files)
          }
        } else {
          setChangedFiles([])
        }
      } else {
        setGitBranch(null)
        setGitHasChanges(false)
        setChangedFiles([])
      }
    }

    // Initial fetch
    fetchGitInfo()

    // Start watching for git changes
    window.electron.git.watch(project.path)

    // Listen for changes from file watcher
    const unsubscribe = window.electron.git.onChanged((changedPath) => {
      if (changedPath === project.path) {
        fetchGitInfo()
      }
    })

    return () => {
      unsubscribe()
      window.electron?.git.unwatch(project.path)
    }
  }, [project.path])

  // Fetch scripts when project is expanded
  useEffect(() => {
    if (project.isExpanded && window.electron) {
      window.electron.project.getScripts(project.path).then((result) => {
        if (result.hasPackageJson) {
          setScripts(result.scripts)
          setPackageManager(result.packageManager || 'npm')
        } else {
          setScripts([])
        }
      })
    }
  }, [project.isExpanded, project.path])

  // Close portal menus when clicking outside
  useEffect(() => {
    if (!showBranchMenu && !showChangedFilesMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      // Check if click is outside the branch menu and button
      if (showBranchMenu && branchMenuRef.current && branchBtnRef.current) {
        if (!branchMenuRef.current.contains(target) && !branchBtnRef.current.contains(target)) {
          setShowBranchMenu(false)
        }
      }
      // Check if click is outside the changed files menu and button
      if (showChangedFilesMenu && changedFilesMenuRef.current && changedFilesBtnRef.current) {
        if (!changedFilesMenuRef.current.contains(target) && !changedFilesBtnRef.current.contains(target)) {
          setShowChangedFilesMenu(false)
          setConfirmDiscard(null)
        }
      }
    }

    // Use setTimeout to avoid immediate close from the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showBranchMenu, showChangedFilesMenu])

  const handleShellSelect = (shell: ShellInfo) => {
    onCreateTerminal(project.id, shell)
    setShowShellMenu(false)
  }

  const handleScriptSelect = (script: ScriptInfo) => {
    const command = `${packageManager} run ${script.name}`
    onStartServer(project.id, script.name, command)
    setShowServerMenu(false)
  }

  const handleCustomCommand = () => {
    if (customCommand.trim()) {
      onStartServer(project.id, customName || 'custom', customCommand.trim())
      setCustomCommand('')
      setCustomName('')
      setShowCustomCommand(false)
      setShowServerMenu(false)
    }
  }

  const refreshGitInfo = async () => {
    if (!window.electron) return
    const result = await window.electron.git.getInfo(project.path)
    if (result.isGitRepo) {
      setGitBranch(result.branch || null)
      setGitHasChanges(result.hasChanges || false)
    }
  }

  const handleBranchClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron || !gitBranch) return

    const newShowState = !showBranchMenu
    setShowBranchMenu(newShowState)
    setShowShellMenu(false)
    setShowServerMenu(false)
    setShowChangedFilesMenu(false)

    if (newShowState && branchBtnRef.current) {
      const rect = branchBtnRef.current.getBoundingClientRect()
      setBranchMenuPos({ top: rect.bottom + 4, left: rect.left })
      // Fetch branch list when opening menu
      const result = await window.electron.git.listBranches(project.path)
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
    }
  }

  const handleFetch = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron || isFetching) return

    setIsFetching(true)
    try {
      await window.electron.git.fetch(project.path)
      // Refresh branch list after fetch
      const result = await window.electron.git.listBranches(project.path)
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
    } finally {
      setIsFetching(false)
    }
  }

  const handleCheckout = async (branch: string) => {
    if (!window.electron || isCheckingOut) return

    setIsCheckingOut(true)
    try {
      const result = await window.electron.git.checkout(project.path, branch)
      if (result.success) {
        await refreshGitInfo()
        setShowBranchMenu(false)
      } else {
        console.error('Checkout failed:', result.error)
      }
    } finally {
      setIsCheckingOut(false)
    }
  }

  const handleChangedFilesClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newShowState = !showChangedFilesMenu
    setShowChangedFilesMenu(newShowState)
    setShowBranchMenu(false)
    setShowShellMenu(false)
    setShowServerMenu(false)

    if (newShowState && changedFilesBtnRef.current) {
      const rect = changedFilesBtnRef.current.getBoundingClientRect()
      setChangedFilesMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
  }

  const handleOpenInEditor = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron) return
    await window.electron.system.openInEditor(project.path)
  }

  const handleOpenChangedFile = async (filePath: string) => {
    if (!window.electron) return

    // Construct full path (handle both / and \ separators)
    const separator = project.path.includes('\\') ? '\\' : '/'
    const fullPath = `${project.path}${separator}${filePath}`.replace(/\/\//g, '/').replace(/\\\\/g, '\\')
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath

    // Read file content
    const result = await window.electron.fs.readFile(fullPath)
    if (result.success && result.content !== undefined) {
      openFile(fullPath, fileName, result.content, project.path)
      setShowChangedFilesMenu(false)
    }
  }

  const handleStageFile = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron) return
    await window.electron.git.stageFile(project.path, filePath)
  }

  const handleUnstageFile = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron) return
    await window.electron.git.unstageFile(project.path, filePath)
  }

  const handleDiscardFile = async (filePath: string) => {
    if (!window.electron) return
    await window.electron.git.discardFile(project.path, filePath)
    setConfirmDiscard(null)
  }

  // Group changed files by status
  const groupedFiles = {
    modified: changedFiles.filter((f) => f.status === 'modified'),
    added: changedFiles.filter((f) => f.status === 'added'),
    deleted: changedFiles.filter((f) => f.status === 'deleted'),
    untracked: changedFiles.filter((f) => f.status === 'untracked'),
    renamed: changedFiles.filter((f) => f.status === 'renamed'),
  }

  return (
    <div className="mb-1">
      {/* Project Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          setActiveProject(project.id)
          toggleProjectExpanded(project.id)
        }}
        onKeyDown={(e) => e.key === 'Enter' && toggleProjectExpanded(project.id)}
        className={cn(
          'w-full flex items-center gap-1 px-2 py-1.5 text-sm rounded-md transition-colors cursor-pointer group',
          isActive
            ? 'bg-zinc-800 text-white'
            : 'text-zinc-300 hover:bg-zinc-800/50',
          hasFocusedTerminal && 'ring-1 ring-green-500/50 bg-green-500/5'
        )}
      >
        <ChevronRight
          className={cn(
            'w-4 h-4 transition-transform flex-shrink-0',
            project.isExpanded && 'rotate-90'
          )}
        />
        <Folder className={cn('w-4 h-4 flex-shrink-0', hasFocusedTerminal ? 'text-green-400' : 'text-blue-400')} />
        <span className="truncate font-medium">{project.name}</span>
        {gitBranch && (
          <>
            <button
              ref={branchBtnRef}
              onClick={handleBranchClick}
              className={cn(
                'flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full transition-colors',
                gitHasChanges
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                  : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700'
              )}
            >
              <GitBranch className="w-3 h-3" />
              <span className="max-w-[80px] truncate">{gitBranch}</span>
              {gitHasChanges && <span className="text-amber-400">•</span>}
            </button>

            {showBranchMenu && branchMenuPos && createPortal(
              <div
                ref={branchMenuRef}
                className="fixed py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg min-w-[200px] max-h-[400px] overflow-y-auto"
                style={{ top: branchMenuPos.top, left: branchMenuPos.left, zIndex: 9999 }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Fetch button */}
                <button
                  onClick={handleFetch}
                  disabled={isFetching}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left border-b border-zinc-700 mb-1"
                >
                  <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
                  {isFetching ? 'Fetching...' : 'Fetch from remote'}
                </button>

                {/* Local branches */}
                {localBranches.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">
                      Local branches
                    </div>
                    {localBranches.map((branch) => (
                      <button
                        key={branch}
                        onClick={() => handleCheckout(branch)}
                        disabled={isCheckingOut || branch === gitBranch}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                          branch === gitBranch
                            ? 'text-green-400 bg-green-500/10'
                            : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                        )}
                      >
                        {branch === gitBranch ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <GitBranch className="w-3 h-3" />
                        )}
                        <span className="truncate">{branch}</span>
                      </button>
                    ))}
                  </>
                )}

                {/* Remote branches */}
                {remoteBranches.length > 0 && (
                  <>
                    <div className="border-t border-zinc-700 my-1" />
                    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">
                      Remote branches
                    </div>
                    {remoteBranches.map((branch) => {
                      const localName = branch.split('/').slice(1).join('/')
                      const hasLocal = localBranches.includes(localName)
                      return (
                        <button
                          key={branch}
                          onClick={() => handleCheckout(branch)}
                          disabled={isCheckingOut || hasLocal}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                            hasLocal
                              ? 'text-zinc-600'
                              : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                          )}
                          title={hasLocal ? 'Already have local branch' : `Checkout ${branch}`}
                        >
                          <Cloud className="w-3 h-3" />
                          <span className="truncate">{branch}</span>
                        </button>
                      )
                    })}
                  </>
                )}

                {localBranches.length === 0 && remoteBranches.length === 0 && (
                  <div className="px-3 py-2 text-xs text-zinc-500">
                    No branches found
                  </div>
                )}
              </div>,
              document.body
            )}
          </>
        )}
        <span className="flex-1" />
        <button
          onClick={handleOpenInEditor}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
          title="Open in editor"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded Content */}
      {project.isExpanded && (
        <div className="ml-4 mt-1">
          <ProjectTabBar
            activeTab={project.activeTab}
            onTabChange={(tab) => setProjectTab(project.id, tab)}
            terminalCount={projectSessions.length + projectServers.length}
            changedFilesCount={changedFiles.length}
          />

          <div className="mt-2 space-y-1">
            {project.activeTab === 'terminals' && (
              <TerminalsTab
                projectId={project.id}
                projectPath={project.path}
                shells={shells}
                onCreateTerminal={onCreateTerminal}
                onCloseTerminal={onCloseTerminal}
                onStartServer={onStartServer}
                onStopServer={onStopServer}
                onRestartServer={onRestartServer}
                onDeleteServer={onDeleteServer}
              />
            )}

            {project.activeTab === 'files' && (
              <FilesTab projectPath={project.path} />
            )}

            {project.activeTab === 'git' && (
              <GitTab
                projectPath={project.path}
                gitBranch={gitBranch}
                gitHasChanges={gitHasChanges}
                changedFiles={changedFiles}
                onRefreshGitInfo={refreshGitInfo}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export interface TerminalItemProps {
  session: TerminalSession
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  dragHandleProps?: Record<string, unknown>
}

export function TerminalItem({ session, isActive, onSelect, onClose, dragHandleProps }: TerminalItemProps) {
  const { setFocusedTerminal, setActiveGrid } = useGridStore()
  const grid = useGridStore((state) => state.grids.find((g) => g.terminalIds.includes(session.id)))
  const { updateSessionTitle } = useTerminalStore()

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSelect = () => {
    if (isEditing) return
    onSelect()
    // If terminal is in a grid, make that grid active and focus the terminal
    if (grid) {
      setActiveGrid(grid.id)
      setFocusedTerminal(grid.id, session.id)
    }
  }

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(session.title)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (editValue.trim()) {
      updateSessionTitle(session.id, editValue.trim())
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={(e) => !isEditing && e.key === 'Enter' && handleSelect()}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors group',
          isActive
            ? 'ring-2 ring-green-500 bg-green-500/10 text-green-400'
            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <div
          className="active:cursor-grabbing touch-none p-0.5"
          {...dragHandleProps}
          style={{ cursor: 'grab' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4 flex-shrink-0 opacity-30 group-hover:opacity-70" />
        </div>
        <ActivityIndicator sessionId={session.id} className="w-2 h-2" />
        <Terminal className={cn('w-3 h-3 flex-shrink-0', isActive && 'text-green-400')} />

        {/* Terminal name - editable */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-zinc-800 text-zinc-200 px-1 rounded border border-zinc-600 outline-none focus:border-green-500 text-xs"
          />
        ) : (
          <span
            className="truncate flex-1 text-left"
            onDoubleClick={handleStartEdit}
            title="Double-click to rename"
          >
            {session.title}
          </span>
        )}

        {isActive && !isEditing && (
          <span className="text-[10px] text-green-400 font-medium">focused</span>
        )}
        {grid && grid.terminalIds.length > 1 && !isActive && !isEditing && (
          <span className="text-[10px] text-blue-400">+{grid.terminalIds.length - 1}</span>
        )}
        {session.status === 'exited' && !isEditing && (
          <span className="text-[10px] text-zinc-600">exited</span>
        )}

        {/* Edit button */}
        {!isEditing && (
          <button
            onClick={handleStartEdit}
            onPointerDown={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-300"
            title="Rename"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </li>
  )
}

export interface ServerItemProps {
  server: ServerInstance
  isActive: boolean
  onSelect: () => void
  onStop: () => void
  onRestart: () => void
  onDelete: () => void
}

export function ServerItem({ server, isActive, onSelect, onStop, onRestart, onDelete }: ServerItemProps) {
  const { setFocusedTerminal, setActiveGrid } = useGridStore()
  const grid = useGridStore((state) => state.grids.find((g) => g.terminalIds.includes(server.terminalId)))

  const statusColors = {
    starting: 'text-yellow-500',
    running: 'text-green-500',
    stopped: 'text-zinc-500',
    error: 'text-red-500',
  }

  const handleClick = () => {
    onSelect()
    // Also focus in grid and make it active
    if (grid) {
      setActiveGrid(grid.id)
      setFocusedTerminal(grid.id, server.terminalId)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors cursor-pointer group',
          isActive
            ? 'bg-green-600/20 text-green-400'
            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <Server className={cn('w-3 h-3 flex-shrink-0', statusColors[server.status])} />
        <span className="truncate flex-1 text-left">{server.name}</span>
        <span className="text-[10px] text-zinc-600">{server.status}</span>

        {/* Action buttons - always visible on hover */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
          {/* Restart button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRestart()
            }}
            className="p-0.5 hover:bg-zinc-700 rounded text-blue-400 hover:text-blue-300"
            title="Restart server"
          >
            <RefreshCw className="w-3 h-3" />
          </button>

          {/* Stop button - only when running */}
          {server.status === 'running' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onStop()
              }}
              className="p-0.5 hover:bg-zinc-700 rounded text-yellow-400 hover:text-yellow-300"
              title="Stop server (keep logs)"
            >
              <Square className="w-3 h-3" />
            </button>
          )}

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-0.5 hover:bg-zinc-700 rounded text-red-400 hover:text-red-300"
            title="Delete server (close terminal)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </li>
  )
}
