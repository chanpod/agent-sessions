import { useDroppable } from '@dnd-kit/core'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useGridStore } from '../stores/grid-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { TerminalGridView } from './TerminalGridView'
import { FileViewer } from './FileViewer'
import { LayoutGrid } from 'lucide-react'
import { cn } from '../lib/utils'

export function TerminalArea() {
  const { grids, activeGridId } = useGridStore()
  const { isVisible: fileViewerVisible, openFiles } = useFileViewerStore()
  const [splitPosition, setSplitPosition] = useState(50) // percentage
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Find the active grid
  const activeGrid = grids.find((g) => g.id === activeGridId)
  const showFileViewer = fileViewerVisible && openFiles.length > 0

  const handleMouseDown = useCallback(() => {
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      const newPosition = ((e.clientX - rect.left) / rect.width) * 100

      // Clamp between 20% and 80%
      setSplitPosition(Math.max(20, Math.min(80, newPosition)))
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  return (
    <main
      ref={containerRef}
      className={cn(
        'flex-1 flex min-w-0 min-h-0 bg-zinc-950 relative',
        isDragging && 'select-none cursor-col-resize'
      )}
    >
      {/* Terminal section */}
      <div
        className="flex flex-col min-w-0 min-h-0 w-full h-full"
        style={{ width: showFileViewer ? `${splitPosition}%` : '100%' }}
      >
        {activeGrid ? (
          <TerminalGridView gridId={activeGrid.id} />
        ) : (
          <EmptyState />
        )}
      </div>

      {/* Resizer */}
      {showFileViewer && (
        <div
          className={cn(
            'w-1 cursor-col-resize hover:bg-blue-500 transition-colors flex-shrink-0',
            isDragging ? 'bg-blue-500' : 'bg-zinc-800'
          )}
          onMouseDown={handleMouseDown}
        />
      )}

      {/* File viewer section */}
      {showFileViewer && (
        <div
          className="flex flex-col min-w-0 h-full"
          style={{ width: `${100 - splitPosition}%` }}
        >
          <FileViewer />
        </div>
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
