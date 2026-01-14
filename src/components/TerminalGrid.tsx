import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useTerminalStore } from '../stores/terminal-store'
import { useGridStore, LayoutMode } from '../stores/grid-store'
import { GridTerminal } from './GridTerminal'
import { cn } from '../lib/utils'
import { Grid2X2, Grid3X3, LayoutGrid, Square } from 'lucide-react'

export function TerminalGrid() {
  const { sessions } = useTerminalStore()
  const { gridTerminalIds, layoutMode, setLayoutMode } = useGridStore()

  const { isOver, setNodeRef } = useDroppable({
    id: 'terminal-grid-drop-zone',
  })

  // Get the actual sessions for terminals in the grid
  const gridSessions = gridTerminalIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)

  // Determine the data-count for CSS grid layout
  const count = Math.min(gridSessions.length, 6)

  // Determine layout attribute - only apply manual layout if not auto
  const dataLayout = layoutMode !== 'auto' ? layoutMode : undefined

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Grid header with layout controls */}
      <div className="h-10 flex items-center px-4 border-b border-zinc-800 bg-zinc-900/30">
        <span className="text-sm text-zinc-400">
          Terminal Grid ({gridSessions.length})
        </span>
        <div className="ml-auto flex items-center gap-1">
          <LayoutSelector currentMode={layoutMode} onSelect={setLayoutMode} />
        </div>
      </div>

      {/* Grid area */}
      <div
        ref={setNodeRef}
        className={cn(
          'terminal-grid flex-1',
          isOver && 'ring-2 ring-inset ring-blue-500 bg-blue-500/10'
        )}
        data-count={count}
        data-layout={dataLayout}
      >
        {gridSessions.length === 0 ? (
          <div className="grid-drop-placeholder">
            <div className="text-center">
              <LayoutGrid className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Drag terminals here to add them to the grid</p>
            </div>
          </div>
        ) : (
          <SortableContext items={gridTerminalIds} strategy={rectSortingStrategy}>
            {gridSessions.map((session) => (
              <GridTerminal key={session.id} session={session} />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  )
}

interface LayoutSelectorProps {
  currentMode: LayoutMode
  onSelect: (mode: LayoutMode) => void
}

function LayoutSelector({ currentMode, onSelect }: LayoutSelectorProps) {
  const layouts: { mode: LayoutMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'auto', icon: <LayoutGrid className="w-3.5 h-3.5" />, label: 'Auto' },
    { mode: '1x1', icon: <Square className="w-3.5 h-3.5" />, label: '1x1' },
    { mode: '2x1', icon: <Grid2X2 className="w-3.5 h-3.5" />, label: '2x1' },
    { mode: '2x2', icon: <Grid2X2 className="w-3.5 h-3.5" />, label: '2x2' },
    { mode: '3x2', icon: <Grid3X3 className="w-3.5 h-3.5" />, label: '3x2' },
  ]

  return (
    <div className="flex items-center gap-0.5 bg-zinc-800 rounded p-0.5">
      {layouts.map(({ mode, icon, label }) => (
        <button
          key={mode}
          onClick={() => onSelect(mode)}
          className={cn(
            'p-1 rounded text-xs',
            currentMode === mode
              ? 'bg-zinc-700 text-white'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50'
          )}
          title={label}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
