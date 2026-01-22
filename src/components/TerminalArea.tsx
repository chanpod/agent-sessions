import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useGridStore } from '../stores/grid-store'
import { useViewStore } from '../stores/view-store'
import { useProjectStore } from '../stores/project-store'
import { useTerminalStore, TerminalSession } from '../stores/terminal-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { TerminalGridView } from './TerminalGridView'
import { SingleTerminalView } from './SingleTerminalView'
import { FileViewer } from './FileViewer'
import { LayoutGrid, LayoutDashboard } from 'lucide-react'
import { cn } from '../lib/utils'

export function TerminalArea() {
  const activeView = useViewStore((s) => s.activeView)
  const projects = useProjectStore((s) => s.projects)
  const dashboard = useGridStore((s) => s.dashboard)
  const sessions = useTerminalStore((s) => s.sessions)
  const { isVisible: fileViewerVisible, openFiles } = useFileViewerStore()

  const showFileViewer = fileViewerVisible && openFiles.length > 0

  // Render based on active view type
  const renderContent = () => {
    if (activeView.type === 'dashboard') {
      // Dashboard grid view
      const displaySessions = dashboard.terminalRefs
        .map((id) => sessions.find((s) => s.id === id))
        .filter((s): s is TerminalSession => s !== undefined)

      if (displaySessions.length === 0) {
        return <EmptyState viewType="dashboard" />
      }

      return (
        <TerminalGridView
          viewType="dashboard"
          terminalIds={dashboard.terminalRefs}
          layoutMode={dashboard.layoutMode}
          focusedTerminalId={dashboard.focusedTerminalId}
        />
      )
    }

    if (activeView.type === 'project-grid') {
      // Project grid view - show all project terminals
      const project = projects.find((p) => p.id === activeView.projectId)
      if (!project) return <EmptyState viewType="project" />

      const displaySessions = project.gridTerminalIds
        .map((id) => sessions.find((s) => s.id === id))
        .filter((s): s is TerminalSession => s !== undefined)

      if (displaySessions.length === 0) {
        return <EmptyState viewType="project" />
      }

      return (
        <TerminalGridView
          viewType="project"
          projectId={project.id}
          terminalIds={project.gridTerminalIds}
          layoutMode={project.gridLayoutMode}
          focusedTerminalId={project.lastFocusedTerminalId}
        />
      )
    }

    if (activeView.type === 'project-terminal') {
      // Single terminal view
      const session = sessions.find((s) => s.id === activeView.terminalId)
      if (!session) return <EmptyState viewType="project" />

      return <SingleTerminalView session={session} />
    }

    return <EmptyState viewType="project" />
  }

  return (
    <main className="flex-1 flex min-w-0 min-h-0 bg-zinc-950 relative overflow-hidden">
      {/* Terminal section - always full width */}
      <div className="flex flex-col min-w-0 min-h-0 w-full h-full">
        {renderContent()}
      </div>

      {/* File viewer section - slides in from right */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 w-full h-full flex flex-col',
          'transition-transform duration-300 ease-in-out',
          showFileViewer ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <FileViewer />
      </div>
    </main>
  )
}

function EmptyState({ viewType }: { viewType: 'dashboard' | 'project' }) {
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
      <div className={cn('text-center transition-colors', isOver ? 'text-blue-400' : 'text-zinc-600')}>
        {viewType === 'dashboard' ? (
          <>
            <LayoutDashboard
              className={cn('w-12 h-12 mx-auto mb-4 transition-opacity', isOver ? 'opacity-100' : 'opacity-50')}
            />
            <p className="text-lg mb-2">{isOver ? 'Drop to add to dashboard' : 'No terminals in dashboard'}</p>
            <p className="text-sm">
              {isOver ? '' : 'Add terminals using the dashboard icon in the sidebar'}
            </p>
          </>
        ) : (
          <>
            <LayoutGrid
              className={cn('w-12 h-12 mx-auto mb-4 transition-opacity', isOver ? 'opacity-100' : 'opacity-50')}
            />
            <p className="text-lg mb-2">{isOver ? 'Drop to create view' : 'No terminals'}</p>
            <p className="text-sm">{isOver ? '' : 'Create a new terminal from the sidebar'}</p>
          </>
        )}
      </div>
    </div>
  )
}
