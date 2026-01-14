import { ChevronRight, Terminal, X, Server, GitBranch, Plus, Folder, Play, Square, Command, RefreshCw, Check, Cloud, GripVertical } from 'lucide-react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore, TerminalSession } from '../stores/terminal-store'
import { useServerStore, ServerInstance } from '../stores/server-store'
import { useGridStore } from '../stores/grid-store'
import { cn } from '../lib/utils'
import { useState, useEffect } from 'react'
import { DraggableTerminalItem } from './DraggableTerminalItem'

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
}

export function ProjectItem({
  project,
  shells,
  onCreateTerminal,
  onCloseTerminal,
  onStartServer,
  onStopServer,
}: ProjectItemProps) {
  const { toggleProjectExpanded, activeProjectId, setActiveProject } = useProjectStore()
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
  const { servers } = useServerStore()

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

  // Filter out server terminals from regular terminal list (they have shell: '')
  const projectSessions = sessions.filter((s) => s.projectId === project.id && s.shell !== '')
  const projectServers = servers.filter((s) => s.projectId === project.id)
  const isActive = activeProjectId === project.id

  // Check if this project contains the active/focused terminal
  const hasFocusedTerminal = activeSessionId &&
    sessions.some(s => s.id === activeSessionId && s.projectId === project.id)

  // Fetch git info on mount
  useEffect(() => {
    if (window.electron) {
      window.electron.git.getInfo(project.path).then((result) => {
        if (result.isGitRepo) {
          setGitBranch(result.branch || null)
          setGitHasChanges(result.hasChanges || false)
        } else {
          setGitBranch(null)
          setGitHasChanges(false)
        }
      })
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

    setShowBranchMenu(!showBranchMenu)
    setShowShellMenu(false)
    setShowServerMenu(false)

    if (!showBranchMenu) {
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
          <div className="relative">
            <button
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

            {showBranchMenu && (
              <div className="absolute left-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[200px] max-h-[400px] overflow-y-auto">
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
              </div>
            )}
          </div>
        )}
        <span className="flex-1" />
        <span className="text-xs text-zinc-600 opacity-0 group-hover:opacity-100">
          {projectSessions.length + projectServers.length}
        </span>
      </div>

      {/* Expanded Content */}
      {project.isExpanded && (
        <div className="ml-4 mt-1 space-y-1">
          {/* Terminals Section */}
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Terminals
              </span>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowShellMenu(!showShellMenu)
                    setShowServerMenu(false)
                  }}
                  className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {showShellMenu && (
                  <div className="absolute right-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[140px]">
                    {shells.map((shell) => (
                      <button
                        key={shell.path}
                        onClick={() => handleShellSelect(shell)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
                      >
                        <Terminal className="w-3 h-3" />
                        {shell.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {projectSessions.length === 0 ? (
              <p className="text-xs text-zinc-600 px-2 py-1">No terminals</p>
            ) : (
              <ul className="space-y-0.5">
                {projectSessions.map((session) => (
                  <DraggableTerminalItem
                    key={session.id}
                    terminalId={session.id}
                    terminalTitle={session.title}
                  >
                    <TerminalItem
                      session={session}
                      isActive={activeSessionId === session.id}
                      onSelect={() => setActiveSession(session.id)}
                      onClose={() => onCloseTerminal(session.id)}
                    />
                  </DraggableTerminalItem>
                ))}
              </ul>
            )}
          </div>

          {/* Servers Section */}
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Servers
              </span>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowServerMenu(!showServerMenu)
                    setShowShellMenu(false)
                    setShowCustomCommand(false)
                  }}
                  className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {showServerMenu && !showCustomCommand && (
                  <div className="absolute right-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[180px] max-h-[300px] overflow-y-auto">
                    {scripts.length > 0 ? (
                      <>
                        <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">
                          package.json scripts
                        </div>
                        {scripts.map((script) => (
                          <button
                            key={script.name}
                            onClick={() => handleScriptSelect(script)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
                            title={script.command}
                          >
                            <Play className="w-3 h-3 text-green-500" />
                            <span className="truncate">{script.name}</span>
                          </button>
                        ))}
                        <div className="border-t border-zinc-700 my-1" />
                      </>
                    ) : (
                      <div className="px-3 py-2 text-xs text-zinc-500">
                        No package.json found
                      </div>
                    )}
                    <button
                      onClick={() => setShowCustomCommand(true)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
                    >
                      <Command className="w-3 h-3 text-blue-400" />
                      Custom command...
                    </button>
                  </div>
                )}
                {showServerMenu && showCustomCommand && (
                  <div className="absolute right-0 top-full mt-1 p-2 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[240px]">
                    <div className="text-[10px] text-zinc-500 uppercase mb-2">
                      Custom Command
                    </div>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Name (e.g., dev-server)"
                      className="w-full px-2 py-1 mb-2 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={customCommand}
                      onChange={(e) => setCustomCommand(e.target.value)}
                      placeholder="Command (e.g., node server.js)"
                      className="w-full px-2 py-1 mb-2 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600"
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomCommand()}
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => setShowCustomCommand(false)}
                        className="flex-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCustomCommand}
                        disabled={!customCommand.trim()}
                        className="flex-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded"
                      >
                        Start
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {projectServers.length === 0 ? (
              <p className="text-xs text-zinc-600 px-2 py-1 flex items-center gap-1">
                <Server className="w-3 h-3" />
                None running
              </p>
            ) : (
              <ul className="space-y-0.5">
                {projectServers.map((server) => (
                  <ServerItem
                    key={server.id}
                    server={server}
                    isActive={activeSessionId === server.terminalId}
                    onSelect={() => setActiveSession(server.terminalId)}
                    onStop={() => onStopServer(server.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Worktrees Section (placeholder) */}
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Worktrees
              </span>
            </div>
            <p className="text-xs text-zinc-600 px-2 py-1 flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              Not detected
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

interface TerminalItemProps {
  session: TerminalSession
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function TerminalItem({ session, isActive, onSelect, onClose }: TerminalItemProps) {
  const { isInGrid, setFocusedTerminal } = useGridStore()
  const inGrid = isInGrid(session.id)

  const handleSelect = () => {
    onSelect()
    // If terminal is in grid, also focus it in the grid
    if (inGrid) {
      setFocusedTerminal(session.id)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={(e) => e.key === 'Enter' && handleSelect()}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors cursor-grab active:cursor-grabbing group',
          isActive
            ? 'ring-2 ring-green-500 bg-green-500/10 text-green-400'
            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <GripVertical className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-50" />
        <Terminal className={cn('w-3 h-3 flex-shrink-0', isActive && 'text-green-400')} />
        <span className="truncate flex-1 text-left">{session.title}</span>
        {isActive && (
          <span className="text-[10px] text-green-400 font-medium">focused</span>
        )}
        {inGrid && !isActive && (
          <span className="text-[10px] text-blue-400">in grid</span>
        )}
        {session.status === 'exited' && (
          <span className="text-[10px] text-zinc-600">exited</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </li>
  )
}

interface ServerItemProps {
  server: ServerInstance
  isActive: boolean
  onSelect: () => void
  onStop: () => void
}

function ServerItem({ server, isActive, onSelect, onStop }: ServerItemProps) {
  const statusColors = {
    starting: 'text-yellow-500',
    running: 'text-green-500',
    stopped: 'text-zinc-500',
    error: 'text-red-500',
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
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
        {server.status === 'running' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onStop()
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded text-red-400 hover:text-red-300"
            title="Stop server"
          >
            <Square className="w-3 h-3" />
          </button>
        )}
      </div>
    </li>
  )
}
