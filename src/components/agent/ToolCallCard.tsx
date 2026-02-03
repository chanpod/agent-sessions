import { useState } from 'react'
import {
  IconTerminal2,
  IconChevronDown,
  IconLoader2,
  IconCheck,
  IconX,
  IconClock,
} from '@tabler/icons-react'

import type { ToolUseBlock, ToolResultBlock } from '@/types/agent-ui'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ToolCallCardProps {
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
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    icon: React.ReactNode
    className: string
  }
> = {
  pending: {
    label: 'Pending',
    variant: 'outline',
    icon: <IconClock className="size-3" />,
    className: 'border-yellow-500/50 text-yellow-600 dark:text-yellow-400',
  },
  running: {
    label: 'Running',
    variant: 'outline',
    icon: <IconLoader2 className="size-3 animate-spin" />,
    className:
      'border-blue-500/50 text-blue-600 dark:text-blue-400 animate-pulse',
  },
  completed: {
    label: 'Completed',
    variant: 'outline',
    icon: <IconCheck className="size-3" />,
    className: 'border-green-500/50 text-green-600 dark:text-green-400',
  },
  error: {
    label: 'Error',
    variant: 'destructive',
    icon: <IconX className="size-3" />,
    className: '',
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

export function ToolCallCard({
  toolUse,
  toolResult,
  defaultExpanded = false,
  className,
}: ToolCallCardProps) {
  const [inputExpanded, setInputExpanded] = useState(defaultExpanded)
  const [resultExpanded, setResultExpanded] = useState(defaultExpanded)

  const status = statusConfig[toolUse.status]
  const formattedInput = formatJson(toolUse.input)
  const formattedResult = toolResult ? formatJson(toolResult.result) : null

  return (
    <Card size="sm" className={cn('border-border/50', className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-2">
          <IconTerminal2 className="text-muted-foreground size-4" />
          <span className="font-mono text-sm font-semibold">
            {toolUse.toolName}
          </span>
        </div>
        <Badge variant={status.variant} className={cn('gap-1', status.className)}>
          {status.icon}
          {status.label}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {/* Input Section */}
        <Collapsible open={inputExpanded} onOpenChange={setInputExpanded}>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-xs font-medium transition-colors">
            <IconChevronDown
              className={cn(
                'size-3.5 transition-transform',
                inputExpanded && 'rotate-180'
              )}
            />
            Input
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="bg-muted/50 mt-1.5 overflow-x-auto rounded-md p-2 font-mono text-xs">
              <code className="text-foreground/90">{formattedInput}</code>
            </pre>
          </CollapsibleContent>
        </Collapsible>

        {/* Result Section */}
        {toolResult && (
          <Collapsible open={resultExpanded} onOpenChange={setResultExpanded}>
            <CollapsibleTrigger
              className={cn(
                'flex w-full items-center gap-1 text-xs font-medium transition-colors',
                toolResult.isError
                  ? 'text-destructive hover:text-destructive/80'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <IconChevronDown
                className={cn(
                  'size-3.5 transition-transform',
                  resultExpanded && 'rotate-180'
                )}
              />
              {toolResult.isError ? 'Error' : 'Result'}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre
                className={cn(
                  'mt-1.5 overflow-x-auto rounded-md p-2 font-mono text-xs',
                  toolResult.isError
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted/50 text-foreground/90'
                )}
              >
                <code>{formattedResult}</code>
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
