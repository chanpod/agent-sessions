import { useState, useCallback, useMemo } from 'react'
import { IconCopy, IconCheck } from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
  const components = useMemo(() => ({
    pre({ children }: React.ComponentProps<'pre'>) {
      return <>{children}</>
    },
    code({ className: codeClassName, children, ...props }: React.ComponentProps<'code'>) {
      const match = /language-(\w+)/.exec(codeClassName || '')
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
  }), [])

  return (
    <div
      className={cn(
        'agent-markdown',
        'prose prose-sm dark:prose-invert max-w-none',
        'text-foreground/90 leading-relaxed',
        'text-[13.5px] leading-[1.7]',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {block.content}
      </ReactMarkdown>
      {block.isStreaming && <StreamingCursor />}
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
        'bg-[#0d1117] dark:bg-[#0d1117]',
        'ring-1 ring-white/[0.06]',
        className
      )}
    >
      {/* Header with language badge and copy button */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          {block.language && (
            <span className="text-[11px] font-medium text-zinc-500">
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
              'font-mono text-[13px] leading-relaxed',
              'text-zinc-200'
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
        'ml-0.5 inline-block h-[18px] w-[2px]',
        'bg-primary/70',
        'animate-pulse',
        'align-text-bottom'
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

// =============================================================================
// MarkdownCodeBlock - Reusable code block with copy button for markdown renderers
// =============================================================================

interface MarkdownCodeBlockProps {
  language?: string
  codeText: string
  children: React.ReactNode
}

/**
 * Code block wrapper with language badge and copy button.
 * Used by markdown renderers (TextContent, PlanCard, PlanSheet) to render
 * fenced code blocks with a consistent look and copy functionality.
 */
export function MarkdownCodeBlock({ language, codeText, children }: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeText.replace(/\n$/, ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }, [codeText])

  return (
    <div className="group relative overflow-hidden rounded-lg bg-[#0d1117] ring-1 ring-white/[0.06] my-2">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 bg-white/[0.02]">
        <span className="text-[11px] font-medium text-zinc-500">{language ?? ''}</span>
        <CopyButton copied={copied} onClick={handleCopy} />
      </div>
      <div className="overflow-x-auto p-3">
        <pre className="m-0">
          {children}
        </pre>
      </div>
    </div>
  )
}

export { TextContent, CodeContent }
