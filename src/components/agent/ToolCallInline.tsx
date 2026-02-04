import { useState } from 'react'
import {
  IconChevronRight,
  IconChevronDown,
  IconLoader2,
  IconCheck,
  IconX,
  IconClock,
} from '@tabler/icons-react'

import type { ToolUseBlock, ToolResultBlock } from '@/types/agent-ui'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { generateToolSummary } from '@/utils/tool-summary'

interface ToolCallInlineProps {
  toolUse: ToolUseBlock
  toolResult?: ToolResultBlock
  defaultExpanded?: boolean
  className?: string
}

type ToolStatus = ToolUseBlock['status']

const statusConfig: Record<
  ToolStatus,
  {
    label: string
    icon: React.ReactNode
    dotClass: string
    labelClass: string
  }
> = {
  pending: {
    label: 'Pending',
    icon: <IconClock className="size-3" />,
    dotClass: 'bg-yellow-500',
    labelClass: 'text-yellow-600 dark:text-yellow-400',
  },
  running: {
    label: 'Running',
    icon: <IconLoader2 className="size-3 animate-spin" />,
    dotClass: 'bg-blue-500 animate-pulse',
    labelClass: 'text-blue-600 dark:text-blue-400',
  },
  completed: {
    label: 'Done',
    icon: <IconCheck className="size-3" />,
    dotClass: 'bg-green-500',
    labelClass: 'text-green-600 dark:text-green-400',
  },
  error: {
    label: 'Error',
    icon: <IconX className="size-3" />,
    dotClass: 'bg-red-500',
    labelClass: 'text-red-500',
  },
}

function formatJson(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return jsonString
  }
}

export function ToolCallInline({
  toolUse,
  toolResult,
  defaultExpanded = false,
  className,
}: ToolCallInlineProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const status = statusConfig[toolUse.status]
  const summary = generateToolSummary(toolUse.toolName, toolUse.input)
  const formattedInput = formatJson(toolUse.input)
  const formattedResult = toolResult ? formatJson(toolResult.result) : null

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={cn('group', className)}>
        {/* Collapsed header row - always visible */}
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/20">
          {/* Status dot */}
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              status.dotClass
            )}
          />

          {/* Tool name */}
          <span className="shrink-0 font-mono text-xs font-medium text-foreground/80">
            {toolUse.toolName}
          </span>

          {/* Arrow separator */}
          {summary && (
            <>
              <IconChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
              {/* Brief summary */}
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {summary}
              </span>
            </>
          )}

          {/* Status label + icon (right-aligned) */}
          <span
            className={cn(
              'ml-auto flex shrink-0 items-center gap-1 text-xs',
              status.labelClass
            )}
          >
            {status.icon}
          </span>

          {/* Expand chevron */}
          <IconChevronDown
            className={cn(
              'size-3 shrink-0 text-muted-foreground/50 transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        </CollapsibleTrigger>

        {/* Expanded details */}
        <CollapsibleContent>
          <div className="ml-4 mt-1.5 space-y-2 border-l-2 border-border/20 pl-3 pb-1">
            {/* Input */}
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                Input
              </span>
              <pre className="mt-0.5 max-h-48 overflow-auto rounded-md bg-muted/15 p-2.5 font-mono text-xs text-foreground/70 ring-1 ring-border/10">
                <code>{formattedInput}</code>
              </pre>
            </div>

            {/* Result */}
            {toolResult && (
              <div>
                <span
                  className={cn(
                    'text-[10px] font-medium uppercase tracking-wider',
                    toolResult.isError
                      ? 'text-destructive/70'
                      : 'text-muted-foreground/50'
                  )}
                >
                  {toolResult.isError ? 'Error' : 'Result'}
                </span>
                <pre
                  className={cn(
                    'mt-0.5 max-h-64 overflow-auto rounded-md p-2.5 font-mono text-xs ring-1',
                    toolResult.isError
                      ? 'bg-destructive/10 text-destructive ring-destructive/10'
                      : 'bg-muted/15 text-foreground/70 ring-border/10'
                  )}
                >
                  <code>{formattedResult}</code>
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
