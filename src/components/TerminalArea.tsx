import { useDroppable } from '@dnd-kit/core'
import { useGridStore } from '../stores/grid-store'
import { TerminalGridView } from './TerminalGridView'
import { LayoutGrid } from 'lucide-react'
import { cn } from '../lib/utils'

export function TerminalArea() {
  const { grids, activeGridId } = useGridStore()

  // Find the active grid
  const activeGrid = grids.find((g) => g.id === activeGridId)

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-zinc-950 relative">
      {activeGrid ? (
        <TerminalGridView gridId={activeGrid.id} />
      ) : (
        <EmptyState />
      )}
    </main>
  )
}

function EmptyState() {
  const { isOver, setNodeRef } = useDroppable({
    id: 'empty-terminal-area-drop-zone',
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-1 flex items-center justify-center transition-colors',
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
        <p className="text-lg mb-2">{isOver ? 'Drop to create view' : 'No terminal selected'}</p>
        <p className="text-sm">{isOver ? '' : 'Create a new terminal or select one from the sidebar'}</p>
      </div>
    </div>
  )
}
