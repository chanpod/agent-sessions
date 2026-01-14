import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { ReactNode } from 'react'

interface DraggableTerminalItemProps {
  terminalId: string
  terminalTitle: string
  children: ReactNode
}

export function DraggableTerminalItem({ terminalId, terminalTitle, children }: DraggableTerminalItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: terminalId,
    data: {
      type: 'terminal',
      terminalId,
      terminalTitle,
    },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  )
}
