import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react'
import { IconSend } from '@tabler/icons-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// =============================================================================
// Types
// =============================================================================

interface AgentInputAreaProps {
  processId: string
  onSend: (message: string) => void
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
    if (!input.trim() || disabled) return
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
  }, [input, disabled, onSend])

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

  const canSubmit = input.trim().length > 0 && !disabled

  return (
    <div
      className={cn(
        'relative flex items-end gap-2',
        'rounded-lg border border-border',
        'bg-background/50 backdrop-blur-sm',
        'p-2',
        'focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
        'transition-colors duration-200',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          'flex-1 resize-none',
          'bg-transparent',
          'text-sm text-foreground placeholder:text-muted-foreground',
          'border-0 outline-none focus:ring-0',
          'min-h-[36px] max-h-[200px]',
          'py-2 px-2',
          'scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent',
          disabled && 'cursor-not-allowed'
        )}
        aria-label={`Message input for process ${processId}`}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={cn(
          'h-8 w-8 shrink-0',
          'rounded-md',
          'transition-all duration-200',
          canSubmit
            ? 'text-primary hover:bg-primary/10 hover:text-primary'
            : 'text-muted-foreground'
        )}
        title="Send message (Ctrl+Enter)"
        aria-label="Send message"
      >
        <IconSend className="h-4 w-4" />
      </Button>
    </div>
  )
}
