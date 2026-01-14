import { useTerminalStore } from '../stores/terminal-store'
import { Terminal } from './Terminal'

export function TerminalArea() {
  const { sessions, activeSessionId } = useTerminalStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  if (!activeSession) {
    return (
      <main className="flex-1 flex items-center justify-center bg-zinc-950">
        <div className="text-center text-zinc-600">
          <p className="text-lg mb-2">No terminal selected</p>
          <p className="text-sm">Create a new terminal to get started</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
      {/* Terminal tabs header */}
      <div className="h-10 flex items-center px-4 border-b border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-400">{activeSession.title}</span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-600 text-xs">{activeSession.cwd}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-600">PID: {activeSession.pid}</span>
          {activeSession.status === 'running' ? (
            <span className="w-2 h-2 rounded-full bg-green-500" title="Running" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-zinc-600" title="Exited" />
          )}
        </div>
      </div>

      {/* Terminal container */}
      <div className="flex-1 relative">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={session.id === activeSessionId ? 'h-full' : 'hidden'}
          >
            <Terminal sessionId={session.id} />
          </div>
        ))}
      </div>
    </main>
  )
}
