import { useState } from 'react'
import {
  IconMap,
  IconLoader2,
  IconCheck,
  IconChevronDown,
} from '@tabler/icons-react'

import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PlanCardProps {
  input: Record<string, unknown>
  toolResult?: { result: string; isError?: boolean }
  status: 'pending' | 'running' | 'completed' | 'error'
}

export function PlanCard({ input, toolResult, status }: PlanCardProps) {
  const [isOpen, setIsOpen] = useState(true)

  const allowedPrompts = input.allowedPrompts as
    | Array<{ tool: string; prompt: string }>
    | undefined

  // Plan content lives in input.plan (it's a string with markdown)
  const planText = typeof input.plan === 'string'
    ? input.plan
    : input.plan != null
      ? JSON.stringify(input.plan, null, 2)
      : null

  const isComplete = status === 'completed' || status === 'error'

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'flex flex-col',
          'rounded-lg border border-blue-500/30',
          'bg-blue-500/5',
        )}
      >
        {/* Header / Trigger */}
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-blue-500/10">
          <div className="flex size-6 items-center justify-center rounded-full bg-blue-500/15">
            <IconMap className="size-3.5 text-blue-400" />
          </div>
          <span className="text-sm font-medium text-blue-300">Plan</span>
          {!isComplete && (
            <IconLoader2 className="size-3 animate-spin text-blue-400/60" />
          )}
          {isComplete && status !== 'error' && (
            <IconCheck className="size-3.5 text-blue-400/60" />
          )}
          <IconChevronDown
            className={cn(
              'ml-auto size-4 text-blue-400/50 transition-transform',
              isOpen && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>

        {/* Collapsible body */}
        <CollapsibleContent>
          <div className="flex flex-col gap-2 px-4 pb-3">
            {/* Plan content */}
            {planText && (
              <div className="pl-8">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                  {planText}
                </pre>
              </div>
            )}

            {/* Waiting state */}
            {!planText && !isComplete && (
              <div className="pl-8">
                <p className="text-sm text-muted-foreground/60">
                  Preparing plan...
                </p>
              </div>
            )}

            {/* Allowed prompts as badges */}
            {allowedPrompts && allowedPrompts.length > 0 && (
              <div className="flex flex-col gap-1 pl-8">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                  Allowed Actions
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {allowedPrompts.map((p, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="border-blue-500/30 text-blue-300/80 text-[11px]"
                    >
                      {p.prompt}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Error from result */}
            {toolResult?.isError && (
              <div className="pl-8">
                <p className="text-xs text-destructive">{toolResult.result}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
