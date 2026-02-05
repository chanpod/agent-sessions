import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { ReactNode, cloneElement, isValidElement, useCallback } from 'react'

interface DraggableTerminalItemProps {
  terminalId: string
  terminalTitle: string
  children: ReactNode
}

export function DraggableTerminalItem({ terminalId, terminalTitle, children }: DraggableTerminalItemProps) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: terminalId,
    data: {
      type: 'terminal',
      terminalId,
      terminalTitle,
    },
  })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${terminalId}`,
    data: {
      type: 'terminal',
      terminalId,
    },
  })

  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
  }

  // Pass drag props to child so it can apply them to the drag handle
  if (isValidElement(children)) {
    return (
      <div ref={setNodeRef} style={style} data-dragging={isDragging} data-drag-over={isOver}>
        {cloneElement(children as React.ReactElement<{ dragHandleProps?: object }>, {
          dragHandleProps: { ...listeners, ...attributes },
        })}
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} data-dragging={isDragging} data-drag-over={isOver}>
      {children}
    </div>
  )
}
