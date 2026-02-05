import { useMemo } from 'react'
import {
  IconChecklist,
  IconCheck,
  IconCircleDashed,
  IconLoader2,
} from '@tabler/icons-react'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AgentConversation } from '@/types/agent-ui'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

interface TodoSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversation: AgentConversation
}

/**
 * Extract the latest TodoWrite todos from all conversation messages.
 * Scans both completed messages and the current streaming message.
 */
export function extractLatestTodos(conversation: AgentConversation): TodoItem[] {
  const allMessages = [
    ...conversation.messages,
    ...(conversation.currentMessage ? [conversation.currentMessage] : []),
  ]

  let latestTodos: TodoItem[] = []

  for (const msg of allMessages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.blocks) {
      if (block.type === 'tool_use' && block.toolName === 'TodoWrite') {
        try {
          const parsed = JSON.parse(block.input)
          if (Array.isArray(parsed?.todos)) {
            latestTodos = parsed.todos
          }
        } catch {
          // Ignore parse errors (e.g. streaming partial JSON)
        }
      }
    }
  }

  return latestTodos
}

export function TodoSheet({ open, onOpenChange, conversation }: TodoSheetProps) {
  const todos = useMemo(() => extractLatestTodos(conversation), [conversation])

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length
  const totalCount = todos.length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex flex-col w-80">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15">
              <IconChecklist className="size-3.5 text-emerald-400" />
            </div>
            Tasks
          </SheetTitle>
          <SheetDescription>
            {totalCount === 0
              ? 'No tasks yet'
              : `${completedCount}/${totalCount} completed${inProgressCount > 0 ? ` · ${inProgressCount} in progress` : ''}`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-4 px-4">
          {totalCount === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              Tasks will appear here when the agent creates them.
            </div>
          ) : (
            <div className="flex flex-col gap-1 py-2">
              {todos.map((todo, i) => (
                <TodoRow key={i} todo={todo} />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function TodoRow({ todo }: { todo: TodoItem }) {
  switch (todo.status) {
    case 'completed':
      return (
        <div className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
          <IconCheck className="size-4 shrink-0 mt-0.5 text-emerald-400" />
          <span className="text-sm text-muted-foreground line-through">
            {todo.content}
          </span>
        </div>
      )
    case 'in_progress':
      return (
        <div className="flex items-start gap-2.5 rounded-md bg-blue-500/5 border border-blue-500/20 px-2 py-1.5">
          <IconLoader2 className="size-4 shrink-0 mt-0.5 animate-spin text-blue-400" />
          <span className="text-sm text-foreground/90">
            {todo.activeForm || todo.content}
          </span>
        </div>
      )
    case 'pending':
    default:
      return (
        <div className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
          <IconCircleDashed className="size-4 shrink-0 mt-0.5 text-muted-foreground/50" />
          <span className="text-sm text-muted-foreground">
            {todo.content}
          </span>
        </div>
      )
  }
}
