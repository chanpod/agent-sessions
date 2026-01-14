import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { ReactNode, cloneElement, isValidElement } from 'react'

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

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
  }

  // Pass drag props to child so it can apply them to the drag handle
  if (isValidElement(children)) {
    return (
      <div ref={setNodeRef} style={style} data-dragging={isDragging}>
        {cloneElement(children as React.ReactElement<{ dragHandleProps?: object }>, {
          dragHandleProps: { ...listeners, ...attributes },
        })}
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} data-dragging={isDragging}>
      {children}
    </div>
  )
}
