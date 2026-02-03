import { useState } from 'react'
import { IconBrain, IconChevronDown, IconLoader2 } from '@tabler/icons-react'

import type { ThinkingBlock as ThinkingBlockType } from '@/types/agent-ui'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  block: ThinkingBlockType
  defaultOpen?: boolean
  className?: string
}

export function ThinkingBlock({
  block,
  defaultOpen = false,
  className,
}: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const headerLabel = block.isStreaming ? 'Thinking...' : 'Thought process'

  return (
    <div
      className={cn(
        'rounded-md border border-dashed',
        'border-muted-foreground/30 bg-muted/30',
        className
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2',
            'text-muted-foreground hover:text-foreground',
            'text-xs font-medium transition-colors'
          )}
        >
          <div className="flex items-center gap-2">
            {block.isStreaming ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconBrain className="size-3.5" />
            )}
            <span className={cn(block.isStreaming && 'animate-pulse')}>
              {headerLabel}
            </span>
          </div>
          <IconChevronDown
            className={cn(
              'ml-auto size-3.5 transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div
            className={cn(
              'max-h-64 overflow-y-auto px-3 pb-3',
              'text-muted-foreground text-xs leading-relaxed',
              'whitespace-pre-wrap'
            )}
          >
            {block.content}
            {block.isStreaming && (
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
