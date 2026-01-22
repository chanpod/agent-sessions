import { useCallback, useEffect, useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useTerminalStore, TerminalSession } from '../stores/terminal-store'
import { useGridStore, LayoutMode } from '../stores/grid-store'
import { useProjectStore } from '../stores/project-store'
import { GridTerminalCell } from './GridTerminalCell'
import { cn } from '../lib/utils'
import { Grid2X2, Grid3X3, LayoutGrid, Square } from 'lucide-react'
import { resizeTerminal } from '../lib/terminal-registry'

export type ViewType = 'dashboard' | 'project'

interface TerminalGridViewProps {
  viewType: ViewType
  projectId?: string
  terminalIds: string[]
  layoutMode: LayoutMode
  focusedTerminalId: string | null
  showHeader?: boolean
}

export function TerminalGridView({
  viewType,
  projectId,
  terminalIds,
  layoutMode,
  focusedTerminalId,
  showHeader = true,
}: TerminalGridViewProps) {
  const sessions = useTerminalStore((s) => s.sessions)

  // Get sessions for terminals in the grid
  const displaySessions = useMemo(() => {
    return terminalIds
      .map((id) => sessions.find((s) => s.id === id))
      .filter((s): s is TerminalSession => s !== undefined)
  }, [terminalIds, sessions])

  // Action handlers based on view type
  const handleLayoutModeChange = useCallback(
    (mode: LayoutMode) => {
      if (viewType === 'dashboard') {
        useGridStore.getState().setDashboardLayoutMode(mode)
      } else if (projectId) {
        useProjectStore.getState().setProjectLayoutMode(projectId, mode)
      }
    },
    [viewType, projectId]
  )

  const handleFocusChange = useCallback(
    (terminalId: string) => {
      if (viewType === 'dashboard') {
        useGridStore.getState().setDashboardFocusedTerminal(terminalId)
      } else if (projectId) {
        useProjectStore.getState().setProjectFocusedTerminal(projectId, terminalId)
      }
    },
    [viewType, projectId]
  )

  const handleRemove = useCallback(
    (terminalId: string) => {
      if (viewType === 'dashboard') {
        useGridStore.getState().removeTerminalFromDashboard(terminalId)
      } else if (projectId) {
        useProjectStore.getState().removeTerminalFromProject(projectId, terminalId)
      }
    },
    [viewType, projectId]
  )

  const { isOver, setNodeRef } = useDroppable({
    id: viewType === 'dashboard' ? 'dashboard-drop-zone' : `project-drop-zone-${projectId}`,
    data: { viewType, projectId },
  })

  // Determine the data-count for CSS grid layout
  const count = Math.min(displaySessions.length, 6)

  // Determine layout attribute - only apply manual layout if not auto
  const dataLayout = layoutMode !== 'auto' ? layoutMode : undefined

  // Trigger resize when grid layout or terminal count changes
  useEffect(() => {
    const timer = setTimeout(() => {
      terminalIds.forEach((terminalId) => {
        resizeTerminal(terminalId)
      })
    }, 100)
    return () => clearTimeout(timer)
  }, [count, dataLayout, terminalIds])

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full h-full">
      {/* Grid header with layout controls */}
      {showHeader && displaySessions.length > 1 && (
        <div className="h-10 flex items-center px-4 border-b border-zinc-800 bg-zinc-900/30">
          <span className="text-sm text-zinc-400">
            {viewType === 'dashboard' ? 'Dashboard' : 'Terminal Grid'} ({displaySessions.length})
          </span>
          <div className="ml-auto flex items-center gap-1">
            <LayoutSelector currentMode={layoutMode} onSelect={handleLayoutModeChange} />
          </div>
        </div>
      )}

      {/* Grid area */}
      <div
        ref={setNodeRef}
        className={cn('terminal-grid flex-1', isOver && 'ring-2 ring-inset ring-blue-500 bg-blue-500/10')}
        data-count={count}
        data-layout={dataLayout}
      >
        {displaySessions.length === 0 ? (
          <div className="grid-drop-placeholder">
            <div className="text-center">
              <LayoutGrid className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Drag terminals here to add them to the grid</p>
            </div>
          </div>
        ) : (
          <SortableContext items={terminalIds} strategy={rectSortingStrategy}>
            {displaySessions.map((session) => (
              <GridTerminalCell
                key={session.id}
                session={session}
                viewType={viewType}
                projectId={projectId}
                isFocused={focusedTerminalId === session.id}
                onFocusChange={handleFocusChange}
                canRemove={displaySessions.length > 1 || viewType === 'dashboard'}
                onRemove={handleRemove}
              />
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
            currentMode === mode ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50'
          )}
          title={label}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
