import { useState } from 'react'
import {
  IconChecklist,
  IconLoader2,
  IconCheck,
  IconCircleDashed,
  IconChevronDown,
} from '@tabler/icons-react'

import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

interface TodoCardProps {
  input: Record<string, unknown>
  toolResult?: { result: string; isError?: boolean }
  status: 'pending' | 'running' | 'completed' | 'error'
}

export function TodoCard({ input, status: toolStatus }: TodoCardProps) {
  const [isOpen, setIsOpen] = useState(true)

  const todos = input.todos as TodoItem[] | undefined

  if (!todos || todos.length === 0) return null

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const totalCount = todos.length

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'flex flex-col',
          'rounded-lg border border-emerald-500/30',
          'bg-emerald-500/5',
        )}
      >
        {/* Header / Trigger */}
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-emerald-500/10">
          <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15">
            <IconChecklist className="size-3.5 text-emerald-400" />
          </div>
          <span className="text-sm font-medium text-emerald-300">Tasks</span>
          <span className="text-xs text-emerald-400/60">
            {completedCount}/{totalCount}
          </span>
          {(toolStatus === 'running' || toolStatus === 'pending') && (
            <IconLoader2 className="size-3 animate-spin text-emerald-400/60" />
          )}
          <IconChevronDown
            className={cn(
              'ml-auto size-4 text-emerald-400/50 transition-transform',
              isOpen && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>

        {/* Collapsible body */}
        <CollapsibleContent>
          <div className="flex flex-col gap-0.5 px-4 pb-3 pl-12">
            {todos.map((todo, i) => (
              <TodoRow key={i} todo={todo} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function TodoRow({ todo }: { todo: TodoItem }) {
  switch (todo.status) {
    case 'completed':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <IconCheck className="size-3.5 shrink-0 text-emerald-400" />
          <span className="text-xs text-muted-foreground line-through">
            {todo.content}
          </span>
        </div>
      )
    case 'in_progress':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <IconLoader2 className="size-3.5 shrink-0 animate-spin text-blue-400" />
          <span className="text-xs text-foreground/90">
            {todo.activeForm || todo.content}
          </span>
        </div>
      )
    case 'pending':
    default:
      return (
        <div className="flex items-center gap-2 py-0.5">
          <IconCircleDashed className="size-3.5 shrink-0 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">
            {todo.content}
          </span>
        </div>
      )
  }
}
