import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react'
import { IconSend, IconPlayerStopFilled } from '@tabler/icons-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// =============================================================================
// Types
// =============================================================================

interface AgentInputAreaProps {
  processId: string
  onSend: (message: string) => void
  onStop?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}

// =============================================================================
// Component
// =============================================================================

/**
 * AgentInputArea - A text input component for sending messages to agent processes.
 *
 * Features:
 * - Auto-resizing textarea
 * - Send button inside the input area (ChatGPT-style)
 * - Keyboard shortcut: Ctrl+Enter or Cmd+Enter to submit
 * - Dark theme compatible
 * - Clears input and refocuses after send
 */
export function AgentInputArea({
  processId,
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  placeholder = 'Send a message...',
  className,
}: AgentInputAreaProps) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto'
    // Set height to scrollHeight, capped at max-height (handled by CSS)
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [input])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || disabled || isStreaming) return
    onSend(input.trim())
    setInput('')
    // Reset textarea height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    // Focus textarea after send
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }, [input, disabled, isStreaming, onSend])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Ctrl+Enter or Cmd+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }

  const canSubmit = input.trim().length > 0 && !disabled && !isStreaming

  return (
    <div
      className={cn(
        'relative flex items-end gap-2',
        'rounded-xl border border-border/40',
        'bg-card/50 backdrop-blur-md',
        'shadow-lg shadow-black/10',
        'p-2 pl-3',
        'focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20',
        'transition-all duration-200',
        className
      )}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className={cn(
          'flex-1 resize-none',
          'bg-transparent',
          'text-sm text-foreground placeholder:text-muted-foreground/60',
          'border-0 outline-none focus:ring-0',
          'min-h-[36px] max-h-[200px]',
          'py-2 px-1',
          'scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent',
        )}
        aria-label={`Message input for process ${processId}`}
      />
      {isStreaming ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onStop}
          className={cn(
            'h-8 w-8 shrink-0',
            'rounded-lg',
            'transition-all duration-200',
            'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive'
          )}
          title="Stop agent"
          aria-label="Stop agent"
        >
          <IconPlayerStopFilled className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant={canSubmit ? 'default' : 'ghost'}
          size="icon"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            'h-8 w-8 shrink-0',
            'rounded-lg',
            'transition-all duration-200',
            canSubmit
              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
              : 'text-muted-foreground/40'
          )}
          title="Send message (Ctrl+Enter)"
          aria-label="Send message"
        >
          <IconSend className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
