import { useMemo, useState, useEffect, useCallback } from 'react'
import { Terminal, ChevronDown, X, Server as ServerIcon } from 'lucide-react'
import { useTerminalStore } from '../stores/terminal-store'
import { useProjectStore } from '../stores/project-store'
import { useServerStore } from '../stores/server-store'
import { useSSHStore } from '../stores/ssh-store'
import { SingleTerminalView } from './SingleTerminalView'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Separator } from './ui/separator'
import { cn } from '../lib/utils'
import { ServerItem } from './ProjectItem'

interface ShellInfo {
  name: string
  path: string
}

interface TerminalAreaProps {
  onCreateTerminal: (projectId: string, shell: ShellInfo) => void
  onCreateQuickTerminal: (shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
  onStopServer: (serverId: string) => void
  onRestartServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
  onToggleCollapse?: () => void
}

export function TerminalArea({
  onCreateTerminal,
  onCreateQuickTerminal,
  onCloseTerminal,
  onStopServer,
  onRestartServer,
  onDeleteServer,
  onToggleCollapse,
}: TerminalAreaProps) {
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
  const { activeProjectId, projects } = useProjectStore()
  const { servers } = useServerStore()
  const { connections: sshConnections } = useSSHStore()
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [showShellMenu, setShowShellMenu] = useState(false)

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null

  useEffect(() => {
    async function loadShells() {
      if (!window.electron?.system) return
      try {
        const availableShells = await window.electron.system.getShells(activeProject?.path)
        setShells(availableShells)
      } catch (err) {
        console.error('Failed to load shells:', err)
      }
    }
    loadShells()
  }, [activeProject])

  const allShells = useMemo(() => [
    ...shells,
    ...(activeProject?.isSSHProject
      ? sshConnections.map((conn) => ({
          name: `SSH: ${conn.name}`,
          path: `ssh:${conn.id}`,
        }))
      : []),
  ], [shells, activeProject, sshConnections])

  const visibleSessions = useMemo(() => {
    return sessions.filter((s) =>
      s.terminalType !== 'agent' &&
      s.shell !== '' &&
      (s.projectId === activeProjectId || s.projectId === '')
    )
  }, [sessions, activeProjectId])

  const activeSession = useMemo(() => {
    if (activeSessionId) {
      // First check visible terminal tabs
      const visible = visibleSessions.find((s) => s.id === activeSessionId)
      if (visible) return visible

      // Then check all non-agent terminals (e.g. service terminals with shell === '')
      const fromAll = sessions.find((s) => s.id === activeSessionId && s.terminalType !== 'agent')
      if (fromAll) return fromAll
    }

    if (!visibleSessions.length) return null
    return visibleSessions[visibleSessions.length - 1]
  }, [visibleSessions, sessions, activeSessionId])

  const projectServers = useMemo(() => {
    if (!activeProjectId) return []
    return servers.filter((s) => s.projectId === activeProjectId)
  }, [servers, activeProjectId])

  const handleShellSelect = useCallback((shell: ShellInfo) => {
    if (activeProjectId) {
      onCreateTerminal(activeProjectId, shell)
    } else {
      onCreateQuickTerminal(shell)
    }
    setShowShellMenu(false)
  }, [activeProjectId, onCreateTerminal, onCreateQuickTerminal])

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-zinc-500" />
          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Terminals</span>
          <Badge variant="secondary" className="text-[10px]">{visibleSessions.length}</Badge>
        </div>

        <div className="flex-1 overflow-x-auto">
          <div className="flex items-center gap-1">
            {visibleSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1 text-xs',
                  activeSessionId === session.id
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200'
                )}
              >
                <span className="max-w-[140px] truncate">{session.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTerminal(session.id)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShowShellMenu(!showShellMenu)}
          >
            New Terminal
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          {showShellMenu && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-md border border-zinc-700 bg-zinc-900 shadow-lg z-20 max-h-64 overflow-y-auto">
              {allShells.map((shell) => (
                <button
                  key={shell.path}
                  onClick={() => handleShellSelect(shell)}
                  className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  {shell.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleCollapse}
            title="Minimize terminal drawer"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        )}
      </div>

      {projectServers.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
            <ServerIcon className="h-3.5 w-3.5" />
            Servers
          </div>
          <div className="px-3 pb-2">
            <ul className="space-y-1">
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
          </div>
          <Separator />
        </>
      )}

      <div className="flex-1 min-h-0">
        {activeSession ? (
          <SingleTerminalView session={activeSession} />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">Terminal Dock</p>
              <p className="mt-2 text-xs text-zinc-600">Create a terminal to get started.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
