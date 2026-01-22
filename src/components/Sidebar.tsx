import { useState, useEffect, useCallback, useRef } from 'react'
import { Settings, Terminal, ChevronDown } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useSSHStore } from '../stores/ssh-store'
import { ProjectContent } from './ProjectContent'
import { NewProjectModal } from './NewProjectModal'
import { SettingsModal } from './SettingsModal'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { TerminalItem } from './ProjectItem'

interface ShellInfo {
  name: string
  path: string
}

interface SidebarProps {
  onCreateTerminal: (projectId: string, shell: ShellInfo) => void
  onCreateQuickTerminal: (shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onRestartServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

const MIN_WIDTH = 180
const MAX_WIDTH = 650
const DEFAULT_WIDTH = 500

export function Sidebar({ onCreateTerminal, onCreateQuickTerminal, onCloseTerminal, onReconnectTerminal, onStartServer, onStopServer, onRestartServer, onDeleteServer }: SidebarProps) {
  const { projects, activeProjectId } = useProjectStore()
  const { connections: sshConnections } = useSSHStore()
  const { getGlobalSessions, activeSessionId, setActiveSession } = useTerminalStore()

  const activeProject = projects.find(p => p.id === activeProjectId)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [showQuickTerminalMenu, setShowQuickTerminalMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width')
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing && sidebarRef.current) {
      const newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
        localStorage.setItem('sidebar-width', String(newWidth))
      }
    }
  }, [isResizing])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize)
      window.addEventListener('mouseup', stopResizing)
    }
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing, resize, stopResizing])

  useEffect(() => {
    async function loadShells() {
      if (!window.electron) return
      try {
        const availableShells = await window.electron.system.getShells(activeProject?.path)
        setShells(availableShells)
      } catch (err) {
        console.error('Failed to load shells:', err)
      }
    }
    loadShells()
  }, [activeProject])

  // Combine local shells with SSH connections for terminal creation
  const allShells = [
    ...shells,
    ...sshConnections.map((conn) => ({
      name: `SSH: ${conn.name}`,
      path: `ssh:${conn.id}`, // Special format to identify SSH connections
    })),
  ]

  // Get global terminals
  const globalSessions = getGlobalSessions()

  return (
    <>
      <aside
        ref={sidebarRef}
        style={{ width }}
        className={`flex-shrink-0 bg-zinc-900/50 border-r border-zinc-800 flex flex-col relative z-20 ${isResizing ? 'select-none' : ''}`}
      >
        {/* Project Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {/* Quick Terminal */}
          <div className="mb-4">
            <div className="relative">
              <button
                onClick={() => setShowQuickTerminalMenu(!showQuickTerminalMenu)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  New Terminal
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${showQuickTerminalMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Shell Dropdown */}
              {showQuickTerminalMenu && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-10 max-h-60 overflow-y-auto">
                  {allShells.map((shell) => (
                    <button
                      key={shell.path}
                      onClick={() => {
                        onCreateQuickTerminal(shell)
                        setShowQuickTerminalMenu(false)
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                      {shell.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Global Terminals Section */}
          {globalSessions.length > 0 && (
            <div className="mb-4 bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
              <div className="mb-2 bg-zinc-800/20 rounded-md p-2">
                <div className="flex items-center justify-between px-2 py-2">
                  <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                    Global
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {globalSessions.map((session) => (
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
              </div>
            </div>
          )}

          {/* Project Tabs Section - Only show active project */}
          {!activeProject ? (
            <div className="px-2 py-4 text-center">
              <p className="text-xs text-zinc-600 mb-2">No project selected</p>
              <p className="text-xs text-zinc-500">Select a project from the header</p>
            </div>
          ) : (
            <ProjectContent
              project={activeProject}
              shells={allShells}
              onCreateTerminal={onCreateTerminal}
              onCloseTerminal={onCloseTerminal}
              onReconnectTerminal={onReconnectTerminal}
              onStartServer={onStartServer}
              onStopServer={onStopServer}
              onRestartServer={onRestartServer}
              onDeleteServer={onDeleteServer}
            />
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors ${isResizing ? 'bg-blue-500' : ''}`}
        />
      </aside>

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </>
  )
}
