import { useState, useMemo } from 'react'
import {
  IconChevronRight,
  IconChevronDown,
  IconLoader2,
  IconCheck,
  IconX,
  IconClock,
  IconShieldCheck,
} from '@tabler/icons-react'

import type { ToolUseBlock, ToolResultBlock } from '@/types/agent-ui'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { generateToolSummary } from '@/utils/tool-summary'
import { usePermissionRulesContext } from './BashRulesContext'

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
  const permRules = usePermissionRulesContext()

  const status = statusConfig[toolUse.status]
  const summary = generateToolSummary(toolUse.toolName, toolUse.input)
  const formattedInput = formatJson(toolUse.input)
  const formattedResult = toolResult ? formatJson(toolResult.result) : null

  // Check if this tool call was auto-allowed
  const autoAllow = useMemo(
    () => permRules?.checkAutoAllow(toolUse.toolName, toolUse.input) ?? null,
    [permRules, toolUse.toolName, toolUse.input]
  )

  const isRevocable = autoAllow && autoAllow.type !== 'safe-tool'

  const handleRevoke = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!autoAllow || !permRules || !isRevocable) return
    if (autoAllow.type === 'bash-rule') {
      permRules.revokeBashRule(autoAllow.rule)
    } else if (autoAllow.type === 'blanket-tool') {
      permRules.revokeToolAllow(autoAllow.toolName)
    }
  }

  const autoAllowLabel = autoAllow
    ? autoAllow.type === 'bash-rule'
      ? `Auto-allowed by rule: ${autoAllow.rule.join(' ')}`
      : autoAllow.type === 'blanket-tool'
        ? `Auto-allowed: ${autoAllow.toolName} is always allowed`
        : `Safe tool: always allowed`
    : null

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

          {/* Auto-allowed badge */}
          {autoAllow && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              <IconShieldCheck className="size-2.5" />
              auto
            </span>
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
            {/* Auto-allowed rule info + revoke */}
            {autoAllow && (
              <div className="flex items-center justify-between rounded-md bg-emerald-500/5 border border-emerald-500/15 px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <IconShieldCheck className="size-3.5 text-emerald-400 shrink-0" />
                  <span className="text-xs text-emerald-300/80">
                    {autoAllowLabel}
                  </span>
                </div>
                {isRevocable && (
                  <button
                    onClick={handleRevoke}
                    className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors underline underline-offset-2 shrink-0 ml-2"
                  >
                    Revoke
                  </button>
                )}
              </div>
            )}

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
