import { useDroppable } from '@dnd-kit/core'
import { useTerminalStore } from '../stores/terminal-store'
import { useGridStore } from '../stores/grid-store'
import { Terminal } from './Terminal'
import { TerminalGrid } from './TerminalGrid'
import { LayoutGrid } from 'lucide-react'
import { cn } from '../lib/utils'

export function TerminalArea() {
  const { sessions, activeSessionId } = useTerminalStore()
  const { gridTerminalIds } = useGridStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // Check if the active session is in the grid
  const activeIsInGrid = activeSessionId && gridTerminalIds.includes(activeSessionId)

  // Show grid view only if:
  // 1. Grid has terminals AND
  // 2. Either no active session selected OR active session is in the grid
  if (gridTerminalIds.length > 0 && (activeIsInGrid || !activeSessionId)) {
    return (
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        <TerminalGrid />
      </main>
    )
  }

  // Otherwise show single terminal view (for non-grid terminals or empty state)
  return <SingleTerminalView activeSession={activeSession} sessions={sessions} activeSessionId={activeSessionId} />
}

interface SingleTerminalViewProps {
  activeSession: ReturnType<typeof useTerminalStore.getState>['sessions'][number] | undefined
  sessions: ReturnType<typeof useTerminalStore.getState>['sessions']
  activeSessionId: string | null
}

function SingleTerminalView({ activeSession, sessions, activeSessionId }: SingleTerminalViewProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'terminal-grid-drop-zone',
  })

  if (!activeSession) {
    return (
      <main
        ref={setNodeRef}
        className={cn(
          'flex-1 flex items-center justify-center bg-zinc-950 transition-colors',
          isOver && 'bg-blue-500/10 ring-2 ring-inset ring-blue-500'
        )}
      >
        <div className={cn(
          'text-center transition-colors',
          isOver ? 'text-blue-400' : 'text-zinc-600'
        )}>
          <LayoutGrid className={cn(
            'w-12 h-12 mx-auto mb-4 transition-opacity',
            isOver ? 'opacity-100' : 'opacity-50'
          )} />
          <p className="text-lg mb-2">{isOver ? 'Drop to add to grid' : 'No terminal selected'}</p>
          <p className="text-sm">{isOver ? '' : 'Create a new terminal or drag one here to start'}</p>
        </div>
      </main>
    )
  }

  return (
    <main ref={setNodeRef} className={cn(
      'flex-1 flex flex-col min-w-0 bg-zinc-950 transition-colors',
      isOver && 'ring-2 ring-inset ring-blue-500 bg-blue-500/5'
    )}>
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
