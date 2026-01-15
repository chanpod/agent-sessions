import { useDroppable } from '@dnd-kit/core'
import { useGridStore } from '../stores/grid-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { TerminalGridView } from './TerminalGridView'
import { FileViewer } from './FileViewer'
import { LayoutGrid } from 'lucide-react'
import { cn } from '../lib/utils'

export function TerminalArea() {
  const { grids, activeGridId } = useGridStore()
  const { isVisible: fileViewerVisible, openFiles } = useFileViewerStore()

  // Find the active grid
  const activeGrid = grids.find((g) => g.id === activeGridId)
  const showFileViewer = fileViewerVisible && openFiles.length > 0

  return (
    <main className="flex-1 flex min-w-0 min-h-0 bg-zinc-950 relative overflow-hidden">
      {/* Terminal section - always full width */}
      <div className="flex flex-col min-w-0 min-h-0 w-full h-full">
        {activeGrid ? (
          <TerminalGridView gridId={activeGrid.id} />
        ) : (
          <EmptyState />
        )}
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
