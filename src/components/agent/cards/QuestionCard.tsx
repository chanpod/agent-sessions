import { useState } from 'react'
import {
  IconMessageQuestion,
  IconLoader2,
  IconCheck,
  IconChevronDown,
} from '@tabler/icons-react'

import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface QuestionOption {
  label: string
  description: string
}

interface Question {
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect?: boolean
}

interface QuestionCardProps {
  input: Record<string, unknown>
  toolResult?: { result: string; isError?: boolean }
  status: 'pending' | 'running' | 'completed' | 'error'
}

export function QuestionCard({ input, toolResult, status }: QuestionCardProps) {
  const [isOpen, setIsOpen] = useState(true)

  const questions = input.questions as Question[] | undefined
  const isComplete = status === 'completed' || status === 'error'

  if (!questions || questions.length === 0) return null

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'flex flex-col',
          'rounded-lg border border-purple-500/30',
          'bg-purple-500/5',
        )}
      >
        {/* Header / Trigger */}
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-purple-500/10">
          <div className="flex size-6 items-center justify-center rounded-full bg-purple-500/15">
            <IconMessageQuestion className="size-3.5 text-purple-400" />
          </div>
          <span className="text-sm font-medium text-purple-300">
            {questions[0]?.header || 'Question'}
          </span>
          {!isComplete && (
            <IconLoader2 className="size-3 animate-spin text-purple-400/60" />
          )}
          {isComplete && status !== 'error' && (
            <IconCheck className="size-3.5 text-purple-400/60" />
          )}
          <IconChevronDown
            className={cn(
              'ml-auto size-4 text-purple-400/50 transition-transform',
              isOpen && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>

        {/* Collapsible body */}
        <CollapsibleContent>
          <div className="flex flex-col gap-2 px-4 pb-3">
            {/* Questions */}
            <div className="flex flex-col gap-3 pl-8">
              {questions.map((q, qi) => (
                <div key={qi} className="flex flex-col gap-1.5">
                  <p className="text-sm text-foreground/90">{q.question}</p>

                  {/* Options */}
                  <div className="flex flex-col gap-1">
                    {q.options.map((opt, oi) => (
                      <div
                        key={oi}
                        className={cn(
                          'flex flex-col gap-0.5',
                          'rounded-md border border-purple-500/15',
                          'bg-purple-500/5 px-3 py-2',
                        )}
                      >
                        <span className="text-xs font-medium text-foreground/80">
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span className="text-[11px] text-muted-foreground">
                            {opt.description}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Answer */}
            {toolResult && (
              <div className="pl-8">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                  Answer
                </span>
                <p
                  className={cn(
                    'mt-0.5 text-xs',
                    toolResult.isError
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {toolResult.result}
                </p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
