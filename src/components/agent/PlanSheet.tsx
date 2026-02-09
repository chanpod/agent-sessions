import { useMemo } from 'react'
import {
  IconMap,
  IconLoader2,
  IconCheck,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { MarkdownCodeBlock } from '@/components/agent/MessageBlock'
import type { AgentConversation } from '@/types/agent-ui'

interface PlanData {
  planText: string | null
  allowedPrompts?: Array<{ tool: string; prompt: string }>
  status: 'pending' | 'running' | 'completed' | 'error'
}

interface PlanSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversation: AgentConversation
}

/**
 * Extract the latest ExitPlanMode plan from all conversation messages.
 * If an agent returns multiple plans, only the latest one is used (full replacement).
 */
export function extractLatestPlan(conversation: AgentConversation): PlanData | null {
  const allMessages = [
    ...conversation.messages,
    ...(conversation.currentMessage ? [conversation.currentMessage] : []),
  ]

  let latestPlan: PlanData | null = null

  for (const msg of allMessages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.blocks) {
      if (block.type === 'tool_use' && block.toolName === 'ExitPlanMode') {
        try {
          const parsed = JSON.parse(block.input)

          const planText = typeof parsed.plan === 'string'
            ? parsed.plan
            : parsed.plan != null
              ? JSON.stringify(parsed.plan, null, 2)
              : null

          const allowedPrompts = Array.isArray(parsed.allowedPrompts)
            ? parsed.allowedPrompts
            : undefined

          latestPlan = {
            planText,
            allowedPrompts,
            status: block.status,
          }
        } catch {
          // Ignore parse errors (e.g. streaming partial JSON)
        }
      }
    }
  }

  return latestPlan
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

export function PlanSheet({ open, onOpenChange, conversation }: PlanSheetProps) {
  const plan = useMemo(() => extractLatestPlan(conversation), [conversation])

  const isComplete = plan?.status === 'completed' || plan?.status === 'error'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="flex flex-col w-[32rem] !max-w-[32rem] p-0 overflow-hidden">
        <SheetHeader className="p-6 pb-2">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-full bg-blue-500/15">
                <IconMap className="size-3.5 text-blue-400" />
              </div>
              Plan
              {plan && !isComplete && (
                <IconLoader2 className="size-3 animate-spin text-blue-400/60" />
              )}
              {plan && isComplete && plan.status !== 'error' && (
                <IconCheck className="size-3.5 text-blue-400/60" />
              )}
            </SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="size-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              aria-label="Close"
            >
              <IconX className="size-4" />
            </button>
          </div>
          <SheetDescription>
            {!plan
              ? 'No plan yet'
              : isComplete
                ? 'Plan ready for implementation'
                : 'Plan is being prepared...'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0 px-6">
          {!plan || !plan.planText ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {plan
                ? 'Preparing plan...'
                : 'A plan will appear here when the agent creates one.'}
            </div>
          ) : (
            <div className="flex flex-col gap-4 pt-2 pb-6">
              {/* Plan content */}
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80 text-[13.5px] leading-[1.7]">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {plan.planText}
                </ReactMarkdown>
              </div>

              {/* Allowed actions */}
              {plan.allowedPrompts && plan.allowedPrompts.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <IconShieldCheck className="size-3.5 text-blue-400/60" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                      Allowed Actions
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.allowedPrompts.map((p, i) => (
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
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
