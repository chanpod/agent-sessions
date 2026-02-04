import { useState } from 'react'
import { IconBrain, IconChevronDown, IconLoader2 } from '@tabler/icons-react'

import type { ThinkingBlock as ThinkingBlockType } from '@/types/agent-ui'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ThinkingInlineProps {
  block: ThinkingBlockType
  defaultOpen?: boolean
  className?: string
}

export function ThinkingInline({
  block,
  defaultOpen = false,
  className,
}: ThinkingInlineProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const label = block.isStreaming ? 'Thinking\u2026' : 'Thought process'

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn('group', className)}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/20">
          {/* Status dot */}
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              block.isStreaming ? 'bg-purple-400 animate-pulse' : 'bg-purple-400/50'
            )}
          />

          {/* Icon */}
          {block.isStreaming ? (
            <IconLoader2 className="size-3.5 shrink-0 animate-spin text-purple-400/60" />
          ) : (
            <IconBrain className="size-3.5 shrink-0 text-purple-400/60" />
          )}

          {/* Label */}
          <span
            className={cn(
              'text-xs font-medium text-muted-foreground/80',
              block.isStreaming && 'animate-pulse'
            )}
          >
            {label}
          </span>

          {/* Chevron */}
          <IconChevronDown
            className={cn(
              'ml-auto size-3 shrink-0 text-muted-foreground/40 transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div
            className={cn(
              'ml-4 mt-1.5 max-h-48 overflow-y-auto border-l-2 border-purple-400/15 pl-3 pb-1',
              'text-xs leading-relaxed text-muted-foreground/70',
              'whitespace-pre-wrap'
            )}
          >
            {block.content}
            {block.isStreaming && (
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-purple-400/60" />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
