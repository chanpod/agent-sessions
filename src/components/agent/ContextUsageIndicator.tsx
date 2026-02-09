import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { getContextLimit } from '@/config/model-limits'
import type { TokenUsage } from '@/types/stream-json'

// =============================================================================
// Types
// =============================================================================

interface ContextUsageIndicatorProps {
  model: string
  usage: TokenUsage
  className?: string
  /** Show the token count numbers */
  showTokens?: boolean
}

type UsageLevel = 'low' | 'medium' | 'high' | 'critical'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate the usage level based on percentage
 */
function getUsageLevel(percentage: number): UsageLevel {
  if (percentage >= 90) return 'critical'
  if (percentage >= 75) return 'high'
  if (percentage >= 50) return 'medium'
  return 'low'
}

/**
 * Get the color classes for a usage level
 */
function getUsageColors(level: UsageLevel): { bar: string; text: string } {
  switch (level) {
    case 'critical':
      return { bar: 'bg-red-500', text: 'text-red-500' }
    case 'high':
      return { bar: 'bg-orange-500', text: 'text-orange-500' }
    case 'medium':
      return { bar: 'bg-yellow-500', text: 'text-yellow-500' }
    case 'low':
    default:
      return { bar: 'bg-green-500', text: 'text-green-500' }
  }
}

/**
 * Format token count for display (e.g., 1234 -> "1.2k", 12345 -> "12k")
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

// =============================================================================
// Component
// =============================================================================

/**
 * ContextUsageIndicator - Shows context window usage as a progress bar
 *
 * Displays the percentage of context window used based on input + output tokens.
 * Color-coded by usage level:
 * - Green: <50%
 * - Yellow: 50-75%
 * - Orange: 75-90%
 * - Red: >90%
 */
export function ContextUsageIndicator({
  model,
  usage,
  className,
  showTokens = true,
}: ContextUsageIndicatorProps) {
  const { percentage, totalTokens, contextLimit, colors } = useMemo(() => {
    const limit = getContextLimit(model)
    const total = usage.inputTokens + usage.outputTokens
    const pct = Math.min((total / limit) * 100, 100)
    const lvl = getUsageLevel(pct)

    return {
      percentage: pct,
      totalTokens: total,
      contextLimit: limit,
      level: lvl,
      colors: getUsageColors(lvl),
    }
  }, [model, usage])

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Progress bar container */}
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        {/* Progress fill */}
        <div
          className={cn('h-full transition-all duration-300', colors.bar)}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Percentage text */}
      <span className={cn('text-xs font-medium tabular-nums', colors.text)}>
        {percentage.toFixed(0)}%
      </span>

      {/* Token count (optional) */}
      {showTokens && (
        <span className="text-xs text-muted-foreground">
          ({formatTokenCount(totalTokens)}/{formatTokenCount(contextLimit)})
        </span>
      )}
    </div>
  )
}
