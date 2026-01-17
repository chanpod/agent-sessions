import { Terminal, Plus, Server, Play, Command, RefreshCw, Package } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTerminalStore } from '../stores/terminal-store'
import { useServerStore, ServerInstance } from '../stores/server-store'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { TerminalItem, ServerItem } from './ProjectItem'
import { Project } from '../stores/project-store'

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
    if (!window.electron) return

    const result = await window.electron!.project.getScripts(projectPath)
    if (result.hasPackageJson && result.packages) {
      setPackages(result.packages)
    }
  }

  useEffect(() => {
    fetchScripts()
  }, [projectPath])

  const handleRescanScripts = async () => {
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

  return (
    <>
      {/* Terminals Section */}
      <div className="mb-3 bg-zinc-800/20 rounded-md p-2">
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
                    {packages.map((pkg, pkgIndex) => (
                      <div key={pkg.packagePath}>
                        {pkgIndex > 0 && <div className="border-t border-zinc-700/50 my-1" />}
                        <div className="px-3 py-1.5 text-[10px] text-zinc-400 uppercase flex items-center gap-1.5">
                          <Package className="w-3 h-3" />
                          {pkg.packagePath === '.' ? (
                            <span>Root {pkg.packageName ? `(${pkg.packageName})` : ''}</span>
                          ) : (
                            <span title={pkg.packagePath}>
                              {pkg.packagePath}
                              {pkg.packageName && <span className="text-zinc-500 ml-1">({pkg.packageName})</span>}
                            </span>
                          )}
                        </div>
                        {pkg.scripts.map((script) => (
                          <button
                            key={`${pkg.packagePath}:${script.name}`}
                            onClick={() => handleScriptSelect(script, pkg)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
                            title={`${script.command} (${pkg.packageManager})`}
                          >
                            <Play className="w-3 h-3 text-green-500 flex-shrink-0" />
                            <span className="truncate">{script.name}</span>
                          </button>
                        ))}
                      </div>
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
