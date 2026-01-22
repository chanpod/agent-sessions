import { Terminal, Plus, Server, Play, Command, RefreshCw, Package, ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useTerminalStore } from '../stores/terminal-store'
import { useServerStore } from '../stores/server-store'
import { usePackageUIStore } from '../stores/package-ui-store'
import { useViewStore } from '../stores/view-store'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { TerminalItem, ServerItem } from './ProjectItem'
import { Project } from '../stores/project-store'
import { cn } from '../lib/utils'

interface ShellInfo {
  name: string
  path: string
}

interface ScriptInfo {
  name: string
  command: string
}

interface PackageScripts {
  packagePath: string
  packageName?: string
  scripts: ScriptInfo[]
  packageManager?: string
}

interface TerminalsTabProps {
  project: Project
  projectId: string
  projectPath: string
  shells: ShellInfo[]
  onCreateTerminal: (projectId: string, shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onRestartServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

export function TerminalsTab({
  project,
  projectId,
  projectPath,
  shells,
  onCreateTerminal,
  onCloseTerminal,
  onReconnectTerminal,
  onStartServer,
  onStopServer,
  onRestartServer,
  onDeleteServer,
}: TerminalsTabProps) {
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
  const { servers } = useServerStore()
  const { packageStates, toggleMinimized, togglePinned, isMinimized, isPinned } = usePackageUIStore()
  const { activeView, setProjectGridActive } = useViewStore()

  // Check if currently in project grid view for this project
  const isInGridView = activeView.type === 'project-grid' && activeView.projectId === projectId

  const [showShellMenu, setShowShellMenu] = useState(false)

  // For SSH projects, we'll use a dummy shell - the actual SSH connection
  // is determined by the project's sshConnectionId
  const isSSHProject = project.isSSHProject
  const [showServerMenu, setShowServerMenu] = useState(false)
  const [packages, setPackages] = useState<PackageScripts[]>([])
  const [showCustomCommand, setShowCustomCommand] = useState(false)
  const [customCommand, setCustomCommand] = useState('')
  const [customName, setCustomName] = useState('')
  const [isRescanningScripts, setIsRescanningScripts] = useState(false)

  // Filter sessions and servers for this project
  const projectSessions = sessions.filter((s) => s.projectId === projectId && s.shell !== '')
  const projectServers = servers.filter((s) => s.projectId === projectId)

  // Fetch package.json scripts
  const fetchScripts = async () => {
    console.log('[TerminalsTab] fetchScripts called', {
      isSSHProject,
      connectionStatus: project.connectionStatus,
      projectPath,
      projectId
    })

    if (!window.electron) {
      console.log('[TerminalsTab] No electron API available')
      return
    }

    // For SSH projects, only fetch scripts when connected
    if (isSSHProject && project.connectionStatus !== 'connected') {
      console.log('[TerminalsTab] SSH project not connected, skipping script fetch')
      return
    }

    console.log('[TerminalsTab] Calling electron.project.getScripts...')
    const result = await window.electron!.project.getScripts(projectPath, projectId)
    console.log('[TerminalsTab] Got result:', result)

    if (result.hasPackageJson && result.packages) {
      console.log('[TerminalsTab] Setting packages:', result.packages)
      setPackages(result.packages)
    }
  }

  useEffect(() => {
    fetchScripts()
  }, [projectPath, project.connectionStatus])

  const handleRescanScripts = async () => {
    console.log('[TerminalsTab] handleRescanScripts clicked')
    setIsRescanningScripts(true)
    try {
      await fetchScripts()
    } finally {
      setIsRescanningScripts(false)
    }
  }

  const handleShellSelect = (shell: ShellInfo) => {
    onCreateTerminal(projectId, shell)
    setShowShellMenu(false)
  }

  const handleCreateTerminalClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    if (isSSHProject) {
      // For SSH projects, directly create terminal without showing menu
      // Use a dummy shell - App.tsx will use the project's SSH connection
      onCreateTerminal(projectId, { name: 'SSH', path: 'ssh' })
    } else {
      // For local projects, show shell menu
      setShowShellMenu(!showShellMenu)
      setShowServerMenu(false)
    }
  }

  const handleScriptSelect = (script: ScriptInfo, packageInfo: PackageScripts) => {
    const command = `${packageInfo.packageManager || 'npm'} run ${script.name}`
    const displayName = packageInfo.packagePath === '.'
      ? script.name
      : `${packageInfo.packagePath}:${script.name}`
    onStartServer(projectId, displayName, command)
    setShowServerMenu(false)
  }

  const handleCustomCommand = () => {
    if (!customCommand.trim()) return
    const name = customName.trim() || 'custom'
    onStartServer(projectId, name, customCommand.trim())
    setShowServerMenu(false)
    setShowCustomCommand(false)
    setCustomCommand('')
    setCustomName('')
  }

  // Determine if packages should be minimized by default (when there are more than 2)
  const defaultMinimized = packages.length > 2

  // Sort packages: pinned first, then by path
  const sortedPackages = useMemo(() => {
    return [...packages].sort((a, b) => {
      const aPinned = isPinned(projectId, a.packagePath)
      const bPinned = isPinned(projectId, b.packagePath)

      if (aPinned && !bPinned) return -1
      if (!aPinned && bPinned) return 1

      // If both pinned or both not pinned, sort by path
      if (a.packagePath === '.') return -1
      if (b.packagePath === '.') return 1
      return a.packagePath.localeCompare(b.packagePath)
    })
  }, [packages, projectId, packageStates, isPinned])

  return (
    <>
      {/* Terminals Section */}
      <div className="mb-3 bg-zinc-800/20 rounded-md p-2">
        {/* Project Dashboard Button */}
        {projectSessions.length > 0 && (
          <button
            onClick={() => setProjectGridActive(projectId)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-2 mb-2 rounded-md transition-colors',
              isInGridView
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'bg-zinc-700/30 text-zinc-300 hover:bg-zinc-700/50 border border-transparent'
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-sm font-medium">Project Dashboard</span>
            <span className="ml-auto text-xs text-zinc-500">{projectSessions.length}</span>
          </button>
        )}

        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Terminals
          </span>
          <div className="relative">
            <button
              onClick={handleCreateTerminalClick}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
              title={isSSHProject ? 'Create SSH terminal' : 'Select shell'}
            >
              <Plus className="w-4 h-4" />
            </button>
            {showShellMenu && !isSSHProject && (
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
          <p className="text-sm text-zinc-600 px-2 py-1">No terminals</p>
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
                  onReconnect={() => onReconnectTerminal(session.id)}
                />
              </DraggableTerminalItem>
            ))}
          </ul>
        )}
      </div>

      {/* Servers Section */}
      <div className="mt-3 pt-3 bg-zinc-800/20 rounded-md p-2 border-t border-zinc-700/50">
        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Servers
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleRescanScripts()
              }}
              disabled={isRescanningScripts}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              title="Rescan package.json scripts"
            >
              <RefreshCw className={`w-4 h-4 ${isRescanningScripts ? 'animate-spin' : ''}`} />
            </button>
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
                <Plus className="w-4 h-4" />
              </button>
              {showServerMenu && !showCustomCommand && (
              <div className="absolute right-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[220px] max-h-[400px] overflow-y-auto">
                {packages.length > 0 ? (
                  <>
                    {sortedPackages.map((pkg, pkgIndex) => {
                      const pinned = isPinned(projectId, pkg.packagePath)
                      // Pinned packages should never use default minimized state
                      const minimized = isMinimized(projectId, pkg.packagePath, pinned ? false : defaultMinimized)

                      return (
                        <div key={pkg.packagePath}>
                          {pkgIndex > 0 && <div className="border-t border-zinc-700/50 my-1" />}
                          <div className="px-2 py-1.5 text-[10px] text-zinc-400 uppercase flex items-center gap-1.5 group">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleMinimized(projectId, pkg.packagePath)
                              }}
                              className="p-0.5 hover:bg-zinc-700 rounded flex-shrink-0"
                              title={minimized ? 'Expand' : 'Minimize'}
                            >
                              {minimized ? (
                                <ChevronRight className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                            <Package className="w-3 h-3 flex-shrink-0" />
                            <span className="flex-1 truncate" title={pkg.packagePath}>
                              {pkg.packagePath === '.' ? (
                                <>Root {pkg.packageName ? `(${pkg.packageName})` : ''}</>
                              ) : (
                                <>
                                  {pkg.packagePath}
                                  {pkg.packageName && <span className="text-zinc-500 ml-1">({pkg.packageName})</span>}
                                </>
                              )}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                togglePinned(projectId, pkg.packagePath)
                              }}
                              className={`p-0.5 hover:bg-zinc-700 rounded flex-shrink-0 transition-colors ${
                                pinned ? 'text-yellow-500' : 'text-zinc-600 opacity-0 group-hover:opacity-100'
                              }`}
                              title={pinned ? 'Unpin' : 'Pin'}
                            >
                              <Pin className={`w-3 h-3 ${pinned ? 'fill-current' : ''}`} />
                            </button>
                          </div>
                          {!minimized && pkg.scripts.map((script) => (
                            <button
                              key={`${pkg.packagePath}:${script.name}`}
                              onClick={() => handleScriptSelect(script, pkg)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left ml-4"
                              title={`${script.command} (${pkg.packageManager})`}
                            >
                              <Play className="w-3 h-3 text-green-500 flex-shrink-0" />
                              <span className="truncate">{script.name}</span>
                            </button>
                          ))}
                        </div>
                      )
                    })}
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
        </div>
        {projectServers.length === 0 ? (
          <p className="text-sm text-zinc-600 px-2 py-1 flex items-center gap-1">
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
                onRestart={() => onRestartServer(server.id)}
                onDelete={() => onDeleteServer(server.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
