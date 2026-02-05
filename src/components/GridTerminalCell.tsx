import { X, Pencil, Check } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useTerminalStore, TerminalSession } from '../stores/terminal-store'
import { useProjectStore } from '../stores/project-store'
import { Terminal } from './Terminal'
import { DetectedServers } from './DetectedServers'
import { cn } from '../lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ViewType } from './TerminalGridView'

interface GridTerminalCellProps {
  session: TerminalSession
  viewType: ViewType
  projectId?: string
  isFocused: boolean
  onFocusChange: (terminalId: string) => void
  canRemove?: boolean
  onRemove?: (terminalId: string) => void
}

export function GridTerminalCell({
  session,
  viewType,
  projectId,
  isFocused,
  onFocusChange,
  canRemove = true,
  onRemove,
}: GridTerminalCellProps) {
  const { updateSessionTitle, setActiveSession, setActiveAgentSession } = useTerminalStore()
  const { projects } = useProjectStore()

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Get project name
  const project = projects.find((p) => p.id === session.projectId)
  const projectName = project?.name || 'Unknown'

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(session.title)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (editValue.trim()) {
      updateSessionTitle(session.id, editValue.trim())
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: session.id,
    data: { viewType, projectId, terminalTitle: session.title },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Show drop indicator when something is dragged over this terminal
  const showDropIndicator = isOver && !isDragging

  const handleFocus = () => {
    onFocusChange(session.id)
    setActiveSession(session.id)
    if (session.terminalType === 'agent') {
      setActiveAgentSession(session.id)
    }
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove?.(session.id)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid-cell',
        isFocused && 'focused',
        showDropIndicator && 'ring-2 ring-inset ring-blue-500 bg-blue-500/10'
      )}
      onClick={handleFocus}
      data-dragging={isDragging}
    >
      {/* Header bar */}
      <div className="h-7 flex items-center gap-2 px-2 bg-zinc-900/50 border-b border-zinc-800 flex-shrink-0 group">
        {/* Drag handle area */}
        <div
          className="flex items-center gap-2 flex-1 min-w-0 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          {/* Shell type badge */}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 flex-shrink-0">
            {session.shellName || 'shell'}
          </span>

          {/* Project name */}
          <span className="text-[10px] text-zinc-500 truncate flex-shrink-0 max-w-[80px]">{projectName}</span>

          <span className="text-zinc-700">|</span>

          {/* Terminal name - editable */}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-xs bg-zinc-800 text-zinc-200 px-1 rounded border border-zinc-600 outline-none focus:border-blue-500 flex-1 min-w-0"
            />
          ) : (
            <span
              className="text-xs text-zinc-400 truncate flex-1 min-w-0"
              onDoubleClick={handleStartEdit}
              title="Double-click to rename"
            >
              {session.title}
            </span>
          )}
        </div>

        {/* Action buttons - outside drag handle */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Edit button */}
          {!isEditing && (
            <button
              onClick={handleStartEdit}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100"
              title="Rename terminal"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {isEditing && (
            <button
              onClick={handleSaveEdit}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded hover:bg-zinc-700 text-green-500 hover:text-green-400"
              title="Save"
            >
              <Check className="w-3 h-3" />
            </button>
          )}
          {canRemove && (
            <button
              onClick={handleRemove}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
              title={viewType === 'dashboard' ? 'Unpin from dashboard' : 'Remove from grid'}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Detected Servers */}
      <DetectedServers terminalId={session.id} />

      {/* Terminal */}
      <div className="flex-1 min-h-0 min-w-0 w-full">
        <Terminal key={session.id} sessionId={session.id} isFocused={isFocused} />
      </div>
    </div>
  )
}
