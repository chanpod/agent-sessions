import { Terminal, X, Server, GitBranch, Settings } from 'lucide-react'
import { useTerminalStore } from '../stores/terminal-store'
import { cn } from '../lib/utils'
import { ShellSelector } from './ShellSelector'

interface ShellInfo {
  name: string
  path: string
}

interface SidebarProps {
  onCreateTerminal: (shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
}

export function Sidebar({ onCreateTerminal, onCloseTerminal }: SidebarProps) {
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()

  return (
    <aside className="w-64 flex-shrink-0 bg-zinc-900/50 border-r border-zinc-800 flex flex-col">
      {/* Header - draggable region for window */}
      <div className="h-12 flex items-center px-4 border-b border-zinc-800 app-drag-region">
        <h1 className="text-sm font-semibold text-zinc-300">Agent Sessions</h1>
      </div>

      {/* Quick Actions */}
      <div className="p-3 border-b border-zinc-800">
        <ShellSelector onSelect={onCreateTerminal} />
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-4">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-2 mb-2">
            Terminals
          </h2>
          {sessions.length === 0 ? (
            <p className="text-xs text-zinc-600 px-2">No active sessions</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((session) => (
                <li key={session.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveSession(session.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setActiveSession(session.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors group cursor-pointer',
                      activeSessionId === session.id
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
                    )}
                  >
                    <Terminal className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate flex-1 text-left">{session.title}</span>
                    {session.status === 'exited' && (
                      <span className="text-xs text-zinc-600">exited</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloseTerminal(session.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Future sections - placeholder */}
        <div className="mb-4">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-2 mb-2">
            Servers
          </h2>
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-600">
            <Server className="w-4 h-4" />
            <span>No servers running</span>
          </div>
        </div>

        <div className="mb-4">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-2 mb-2">
            Worktrees
          </h2>
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-600">
            <GitBranch className="w-4 h-4" />
            <span>Not configured</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-zinc-800">
        <button className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors">
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>
    </aside>
  )
}
