import { useState, useCallback } from 'react'
import { IconCopy, IconCheck } from '@tabler/icons-react'

import type { TextBlock, CodeBlock } from '@/types/agent-ui'
import { cn } from '@/lib/utils'

interface MessageBlockProps {
  block: TextBlock | CodeBlock
  className?: string
}

/**
 * MessageBlock - Renders text or code content blocks
 *
 * Handles both TextBlock and CodeBlock types with appropriate styling:
 * - Text: prose-like formatting with streaming cursor support
 * - Code: dark background with syntax highlighting, language badge, and copy button
 */
export function MessageBlock({ block, className }: MessageBlockProps) {
  if (block.type === 'text') {
    return <TextContent block={block} className={className} />
  }
  return <CodeContent block={block} className={className} />
}

// =============================================================================
// TextContent Component
// =============================================================================

interface TextContentProps {
  block: TextBlock
  className?: string
}

function TextContent({ block, className }: TextContentProps) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'text-foreground leading-relaxed',
        className
      )}
    >
      {/* Simple text rendering - can be enhanced with markdown later */}
      <div className="whitespace-pre-wrap">
        {block.content}
        {block.isStreaming && <StreamingCursor />}
      </div>
    </div>
  )
}

// =============================================================================
// CodeContent Component
// =============================================================================

interface CodeContentProps {
  block: CodeBlock
  className?: string
}

function CodeContent({ block, className }: CodeContentProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(block.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }, [block.content])

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg',
        'bg-zinc-900 dark:bg-zinc-950',
        'border border-zinc-700/50 dark:border-zinc-800',
        className
      )}
    >
      {/* Header with language badge and copy button */}
      <div className="flex items-center justify-between border-b border-zinc-700/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {block.language && (
            <span className="text-xs font-medium text-zinc-400">
              {block.language}
            </span>
          )}
        </div>
        <CopyButton copied={copied} onClick={handleCopy} />
      </div>

      {/* Code content */}
      <div className="overflow-x-auto p-3">
        <pre className="m-0">
          <code
            className={cn(
              'font-mono text-sm leading-relaxed',
              'text-zinc-100 dark:text-zinc-200'
            )}
          >
            {block.content}
          </code>
        </pre>
      </div>
    </div>
  )
}

// =============================================================================
// Helper Components
// =============================================================================

/**
 * Animated cursor shown when content is streaming
 */
function StreamingCursor() {
  return (
    <span
      className={cn(
        'ml-0.5 inline-block h-4 w-1.5',
        'bg-primary',
        'animate-pulse'
      )}
      aria-hidden="true"
    />
  )
}

interface CopyButtonProps {
  copied: boolean
  onClick: () => void
}

/**
 * Copy button with success state
 */
function CopyButton({ copied, onClick }: CopyButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-1',
        'text-xs font-medium transition-colors',
        'text-zinc-400 hover:text-zinc-200',
        'hover:bg-zinc-800',
        'focus:outline-none focus:ring-1 focus:ring-zinc-600',
        // Show on hover or when copied
        'opacity-0 group-hover:opacity-100',
        copied && 'opacity-100'
      )}
      aria-label={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <>
          <IconCheck className="size-3.5 text-green-400" />
          <span className="text-green-400">Copied</span>
        </>
      ) : (
        <>
          <IconCopy className="size-3.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

export { TextContent, CodeContent }
