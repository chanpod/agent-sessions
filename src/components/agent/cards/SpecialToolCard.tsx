import { IconLoader2 } from '@tabler/icons-react'

import type { ToolUseBlock, ToolResultBlock } from '@/types/agent-ui'
import { ToolCallInline } from '@/components/agent/ToolCallInline'
import { PlanCard } from './PlanCard'
import { QuestionCard } from './QuestionCard'
import { cn } from '@/lib/utils'

interface SpecialToolCardProps {
  toolUse: ToolUseBlock
  toolResult?: ToolResultBlock
  onAnswerQuestion?: (toolId: string, answers: Record<string, string>) => void
}

/**
 * Safely parse JSON, returning null on failure.
 */
export function safeParseJson(input: string): Record<string, unknown> | null {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

/**
 * Loading skeleton shown while tool input JSON is still streaming.
 */
interface SkeletonConfig {
  label: string
  borderClass: string
  bgClass: string
  textClass: string
}

const SKELETON_CONFIG: Record<string, SkeletonConfig> = {
  ExitPlanMode: {
    label: 'Plan',
    borderClass: 'border-blue-500/30',
    bgClass: 'bg-blue-500/5',
    textClass: 'text-blue-400/60',
  },
  AskUserQuestion: {
    label: 'Question',
    borderClass: 'border-purple-500/30',
    bgClass: 'bg-purple-500/5',
    textClass: 'text-purple-400/60',
  },
}

const DEFAULT_SKELETON: SkeletonConfig = SKELETON_CONFIG['ExitPlanMode']!

function SpecialToolSkeleton({ toolName }: { toolName: string }) {
  const c = SKELETON_CONFIG[toolName] ?? DEFAULT_SKELETON

  return (
    <div
      className={cn(
        'flex items-center gap-2',
        'rounded-lg border px-4 py-3',
        c.borderClass,
        c.bgClass,
      )}
    >
      <IconLoader2 className={cn('size-4 animate-spin', c.textClass)} />
      <span className={cn('text-sm', c.textClass)}>{c.label}</span>
    </div>
  )
}

/**
 * Router component that renders the appropriate special tool card
 * based on toolName. Falls back to ToolCallInline on parse failure.
 */
export function SpecialToolCard({ toolUse, toolResult, onAnswerQuestion }: SpecialToolCardProps) {
  const parsed = safeParseJson(toolUse.input)

  // If JSON doesn't parse and tool is still running/pending, show skeleton
  if (!parsed && (toolUse.status === 'running' || toolUse.status === 'pending')) {
    return <SpecialToolSkeleton toolName={toolUse.toolName} />
  }

  // If JSON doesn't parse and tool is done, fall back to inline
  if (!parsed) {
    return <ToolCallInline toolUse={toolUse} toolResult={toolResult} />
  }

  switch (toolUse.toolName) {
    case 'ExitPlanMode':
      return (
        <PlanCard
          input={parsed}
          toolResult={toolResult}
          status={toolUse.status}
        />
      )
    case 'AskUserQuestion':
      return (
        <QuestionCard
          input={parsed}
          toolResult={toolResult}
          status={toolUse.status}
          toolId={toolUse.toolId}
          onAnswerQuestion={onAnswerQuestion}
        />
      )
    default:
      return <ToolCallInline toolUse={toolUse} toolResult={toolResult} />
  }
}
