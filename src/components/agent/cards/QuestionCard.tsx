import { useState, useCallback } from 'react'
import {
  IconMessageQuestion,
  IconLoader2,
  IconCheck,
  IconChevronDown,
  IconCircleFilled,
  IconSend2,
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
  toolId?: string
  onAnswerQuestion?: (toolId: string, answers: Record<string, string>) => void
}

// Key for the "Other" custom text option
const OTHER_KEY = '__other__'

export function QuestionCard({ input, toolResult, status, toolId, onAnswerQuestion }: QuestionCardProps) {
  const [isOpen, setIsOpen] = useState(true)

  const questions = input.questions as Question[] | undefined
  const isComplete = (status === 'completed' || status === 'error') && !!toolResult
  // Interactive when the tool has rendered its input and no answer has been received yet.
  // The block may be marked 'completed' by content_block_stop before the user answers,
  // so we check for the absence of toolResult rather than relying on status alone.
  const isInteractive = !toolResult && !!onAnswerQuestion && !!toolId

  // Selection state: Record<questionIndex, Set<optionLabel>>
  const [selections, setSelections] = useState<Record<number, Set<string>>>({})
  // "Other" text input state per question
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({})
  // Track whether the answer has been submitted (to disable UI after submit)
  const [submitted, setSubmitted] = useState(false)

  const handleOptionClick = useCallback(
    (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
      if (!isInteractive || submitted) return

      setSelections((prev) => {
        const current = new Set(prev[questionIndex] ?? [])

        if (optionLabel === OTHER_KEY) {
          // Clicking "Other" in single-select clears other selections
          if (!multiSelect) {
            return { ...prev, [questionIndex]: new Set([OTHER_KEY]) }
          }
          // In multi-select, toggle Other
          if (current.has(OTHER_KEY)) {
            current.delete(OTHER_KEY)
          } else {
            current.add(OTHER_KEY)
          }
          return { ...prev, [questionIndex]: current }
        }

        if (multiSelect) {
          // Toggle the option; deselect "Other" text selection is untouched
          if (current.has(optionLabel)) {
            current.delete(optionLabel)
          } else {
            current.add(optionLabel)
          }
          return { ...prev, [questionIndex]: current }
        }

        // Single-select: replace selection entirely
        return { ...prev, [questionIndex]: new Set([optionLabel]) }
      })
    },
    [isInteractive, submitted],
  )

  const handleOtherTextChange = useCallback(
    (questionIndex: number, text: string) => {
      if (!isInteractive || submitted) return
      setOtherTexts((prev) => ({ ...prev, [questionIndex]: text }))
    },
    [isInteractive, submitted],
  )

  const handleSubmit = useCallback(() => {
    if (!questions || !onAnswerQuestion || submitted || !toolId) return

    const answers: Record<string, string> = {}
    for (let qi = 0; qi < questions.length; qi++) {
      const selected = selections[qi]
      if (!selected || selected.size === 0) continue

      const parts: string[] = []
      for (const label of selected) {
        if (label === OTHER_KEY) {
          const otherText = (otherTexts[qi] ?? '').trim()
          if (otherText) parts.push(otherText)
        } else {
          parts.push(label)
        }
      }
      // Use the question text as key so the agent can match it
      const key = questions[qi]!.question
      answers[key] = parts.join(', ')
    }

    setSubmitted(true)
    onAnswerQuestion(toolId, answers)
  }, [questions, selections, otherTexts, onAnswerQuestion, submitted, toolId])

  // Check if any question has a selection (for enabling submit button)
  const hasAnySelection = questions
    ? questions.some((_, qi) => {
        const selected = selections[qi]
        if (!selected || selected.size === 0) return false
        // If only "Other" is selected, require non-empty text
        if (selected.size === 1 && selected.has(OTHER_KEY)) {
          return (otherTexts[qi] ?? '').trim().length > 0
        }
        return true
      })
    : false

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
          {!isComplete && !submitted && (
            <IconLoader2 className="size-3 animate-spin text-purple-400/60" />
          )}
          {(isComplete || submitted) && status !== 'error' && (
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
              {questions.map((q, qi) => {
                const selected = selections[qi] ?? new Set<string>()
                const isMulti = !!q.multiSelect

                return (
                  <div key={qi} className="flex flex-col gap-1.5">
                    <p className="text-sm text-foreground/90">{q.question}</p>

                    {/* Options */}
                    <div className="flex flex-col gap-1">
                      {q.options.map((opt, oi) => {
                        const isSelected = selected.has(opt.label)

                        return (
                          <button
                            key={oi}
                            type="button"
                            disabled={!isInteractive || submitted}
                            onClick={() => handleOptionClick(qi, opt.label, isMulti)}
                            className={cn(
                              'flex items-start gap-2.5 text-left',
                              'rounded-md border px-3 py-2',
                              'transition-all duration-150',
                              isInteractive && !submitted
                                ? 'cursor-pointer hover:border-purple-400/40 hover:bg-purple-500/10'
                                : 'cursor-default',
                              isSelected
                                ? 'border-purple-500/50 bg-purple-500/15 ring-1 ring-purple-500/20'
                                : 'border-purple-500/15 bg-purple-500/5',
                            )}
                          >
                            {/* Selection indicator */}
                            <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                              {isMulti ? (
                                <div
                                  className={cn(
                                    'flex size-3.5 items-center justify-center rounded-sm border transition-colors',
                                    isSelected
                                      ? 'border-purple-400 bg-purple-500'
                                      : 'border-purple-500/30 bg-transparent',
                                  )}
                                >
                                  {isSelected && (
                                    <IconCheck className="size-2.5 text-white" />
                                  )}
                                </div>
                              ) : (
                                <div
                                  className={cn(
                                    'flex size-3.5 items-center justify-center rounded-full border transition-colors',
                                    isSelected
                                      ? 'border-purple-400 bg-purple-500'
                                      : 'border-purple-500/30 bg-transparent',
                                  )}
                                >
                                  {isSelected && (
                                    <IconCircleFilled className="size-1.5 text-white" />
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Label + description */}
                            <div className="flex flex-col gap-0.5">
                              <span
                                className={cn(
                                  'text-xs font-medium',
                                  isSelected
                                    ? 'text-purple-200'
                                    : 'text-foreground/80',
                                )}
                              >
                                {opt.label}
                              </span>
                              {opt.description && (
                                <span className="text-[11px] text-muted-foreground">
                                  {opt.description}
                                </span>
                              )}
                            </div>
                          </button>
                        )
                      })}

                      {/* "Other" option - always available for custom text */}
                      {isInteractive && !submitted && (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => handleOptionClick(qi, OTHER_KEY, isMulti)}
                            className={cn(
                              'flex items-start gap-2.5 text-left',
                              'rounded-md border px-3 py-2',
                              'cursor-pointer transition-all duration-150',
                              'hover:border-purple-400/40 hover:bg-purple-500/10',
                              selected.has(OTHER_KEY)
                                ? 'border-purple-500/50 bg-purple-500/15 ring-1 ring-purple-500/20'
                                : 'border-purple-500/15 bg-purple-500/5',
                            )}
                          >
                            <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                              {isMulti ? (
                                <div
                                  className={cn(
                                    'flex size-3.5 items-center justify-center rounded-sm border transition-colors',
                                    selected.has(OTHER_KEY)
                                      ? 'border-purple-400 bg-purple-500'
                                      : 'border-purple-500/30 bg-transparent',
                                  )}
                                >
                                  {selected.has(OTHER_KEY) && (
                                    <IconCheck className="size-2.5 text-white" />
                                  )}
                                </div>
                              ) : (
                                <div
                                  className={cn(
                                    'flex size-3.5 items-center justify-center rounded-full border transition-colors',
                                    selected.has(OTHER_KEY)
                                      ? 'border-purple-400 bg-purple-500'
                                      : 'border-purple-500/30 bg-transparent',
                                  )}
                                >
                                  {selected.has(OTHER_KEY) && (
                                    <IconCircleFilled className="size-1.5 text-white" />
                                  )}
                                </div>
                              )}
                            </div>
                            <span className="text-xs font-medium text-foreground/80">
                              Other (custom answer)
                            </span>
                          </button>

                          {/* Text input shown when "Other" is selected */}
                          {selected.has(OTHER_KEY) && (
                            <input
                              type="text"
                              value={otherTexts[qi] ?? ''}
                              onChange={(e) =>
                                handleOtherTextChange(qi, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && hasAnySelection) {
                                  handleSubmit()
                                }
                              }}
                              placeholder="Type your answer..."
                              className={cn(
                                'ml-6.5 rounded-md border border-purple-500/30',
                                'bg-purple-500/5 px-3 py-1.5',
                                'text-xs text-foreground/90 placeholder-purple-400/40',
                                'outline-none ring-0 transition-colors',
                                'focus:border-purple-400/50 focus:bg-purple-500/10',
                              )}
                              autoFocus
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Submit button - only when interactive and not yet submitted */}
            {isInteractive && !submitted && (
              <div className="flex justify-end pl-8 pt-1">
                <button
                  type="button"
                  disabled={!hasAnySelection}
                  onClick={handleSubmit}
                  className={cn(
                    'flex items-center gap-1.5',
                    'rounded-md px-3.5 py-1.5',
                    'text-xs font-medium transition-all duration-150',
                    hasAnySelection
                      ? 'bg-purple-500 text-white hover:bg-purple-400 active:bg-purple-600'
                      : 'cursor-not-allowed bg-purple-500/20 text-purple-400/40',
                  )}
                >
                  <IconSend2 className="size-3" />
                  Submit Answer
                </button>
              </div>
            )}

            {/* Submitted confirmation */}
            {submitted && !toolResult && (
              <div className="pl-8">
                <span className="text-xs text-purple-400/60">
                  Answer submitted. Waiting for response...
                </span>
              </div>
            )}

            {/* Answer (shown after completion) */}
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
