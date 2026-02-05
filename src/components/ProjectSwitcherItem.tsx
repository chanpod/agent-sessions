import React, { useState, useRef, useEffect } from 'react'
import { FolderGit2, Check, Settings, Trash2, Pin, PinOff } from 'lucide-react'
import type { Project } from '../stores/project-store'
import type { ProjectAgentSummary } from '../hooks/useProjectAgentStatus'
import { cn } from '../lib/utils'

interface ProjectSwitcherItemProps {
  project: Project
  isActive: boolean
  agentSummary: ProjectAgentSummary
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onTogglePin: () => void
}

function StatusBadge({ summary }: { summary: ProjectAgentSummary }) {
  if (summary.total === 0) return null

  const { topStatus } = summary

  if (!topStatus || topStatus === 'idle' || topStatus === 'exited') return null

  const colorMap: Record<string, string> = {
    'responding': 'bg-blue-400',
    'thinking': 'bg-amber-400',
    'done': 'bg-emerald-400',
    'needs-attention': 'bg-yellow-400',
  }

  const count =
    topStatus === 'responding' ? summary.responding + summary.thinking :
    topStatus === 'thinking' ? summary.thinking :
    topStatus === 'done' ? summary.done :
    topStatus === 'needs-attention' ? summary.needsAttention :
    0

  const dotColor = colorMap[topStatus] ?? 'bg-zinc-400'

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('w-2 h-2 rounded-full', dotColor)} />
      {count > 0 && (
        <span className="text-[10px] font-medium text-zinc-400">
          {count}
        </span>
      )}
    </div>
  )
}

export function ProjectSwitcherItem({
  project,
  isActive,
  agentSummary,
  onSelect,
  onEdit,
  onDelete,
  onTogglePin,
}: ProjectSwitcherItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showContextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showContextMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }

  // Truncate path for display
  const displayPath = project.path
    ? project.path.replace(/^\//, '').split('/').slice(-2).join('/')
    : project.remotePath ?? ''

  return (
    <>
      <button
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors rounded-md',
          isActive
            ? 'bg-zinc-700/50 text-zinc-100'
            : 'text-zinc-300 hover:bg-zinc-700/30 hover:text-zinc-100'
        )}
      >
        <FolderGit2 className="w-4 h-4 flex-shrink-0 text-zinc-400" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{project.name}</div>
          {displayPath && (
            <div className="text-[11px] text-zinc-500 truncate">{displayPath}</div>
          )}
        </div>
        <div className="flex-shrink-0">
          {isActive ? (
            <Check className="w-4 h-4 text-blue-400" />
          ) : (
            <StatusBadge summary={agentSummary} />
          )}
        </div>
      </button>

      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl z-[200] min-w-[160px]"
          style={{
            top: `${contextMenuPos.y}px`,
            left: `${contextMenuPos.x}px`,
          }}
        >
          <button
            onClick={() => { setShowContextMenu(false); onEdit() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
          >
            <Settings className="w-3 h-3" />
            Edit Project
          </button>
          <button
            onClick={() => { setShowContextMenu(false); onTogglePin() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
          >
            {project.isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
            {project.isPinned ? 'Unpin Project' : 'Pin Project'}
          </button>
          <div className="border-t border-zinc-700 my-1" />
          <button
            onClick={() => { setShowContextMenu(false); onDelete() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 text-left"
          >
            <Trash2 className="w-3 h-3" />
            Remove Project
          </button>
        </div>
      )}
    </>
  )
}
