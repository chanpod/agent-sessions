import { useState } from 'react'
import {
  IconMap,
  IconLoader2,
  IconCheck,
  IconChevronDown,
} from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { MarkdownCodeBlock } from '@/components/agent/MessageBlock'

interface PlanCardProps {
  input: Record<string, unknown>
  toolResult?: { result: string; isError?: boolean }
  status: 'pending' | 'running' | 'completed' | 'error'
}

const markdownComponents = {
  pre({ children }: React.ComponentProps<'pre'>) {
    return <>{children}</>
  },
  code({ className, children, ...props }: React.ComponentProps<'code'>) {
    const match = /language-(\w+)/.exec(className || '')
    const isBlock = match || (typeof children === 'string' && children.includes('\n'))

    if (isBlock) {
      const codeText = typeof children === 'string' ? children : String(children ?? '')
      return (
        <MarkdownCodeBlock language={match?.[1]} codeText={codeText}>
          <code className="font-mono text-[13px] leading-relaxed text-zinc-200" {...props}>
            {children}
          </code>
        </MarkdownCodeBlock>
      )
    }

    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px]" {...props}>
        {children}
      </code>
    )
  },
}

export function PlanCard({ input, toolResult, status }: PlanCardProps) {
  const [isOpen, setIsOpen] = useState(true)

  const allowedPrompts = input.allowedPrompts as
    | Array<{ tool: string; prompt: string }>
    | undefined

  // Plan content: check input.plan first, then fall back to tool result text.
  // The CLI reads the plan from a file and may return it in the tool result
  // rather than the tool input (ExitPlanMode doesn't take plan as a parameter).
  const planText = typeof input.plan === 'string'
    ? input.plan
    : input.plan != null
      ? JSON.stringify(input.plan, null, 2)
      : (toolResult?.result && !toolResult.isError)
        ? toolResult.result
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
              <div className="pl-8 pr-2">
                <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80 text-[13.5px] leading-[1.7]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {planText}
                  </ReactMarkdown>
                </div>
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

            {/* Completed but no plan content found */}
            {!planText && isComplete && !toolResult?.isError && (
              <div className="pl-8">
                <p className="text-sm text-muted-foreground/60">
                  Plan submitted for approval.
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
