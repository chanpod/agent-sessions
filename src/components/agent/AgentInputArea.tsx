import { useRef, useCallback, useEffect, KeyboardEvent } from 'react'
import { IconSend, IconPlayerStopFilled, IconBolt } from '@tabler/icons-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAgentStreamStore } from '@/stores/agent-stream-store'

// =============================================================================
// Types
// =============================================================================

interface AgentInputAreaProps {
  processId: string
  onSend: (message: string) => void
  onStop?: () => void
  /** Called when user force-sends while agent is streaming (stop + send) */
  onForceSend?: (message: string) => void
  /** Called when user queues a message while agent is streaming */
  onQueue?: (message: string) => void
  /** Called when user wants to force-send queued messages (stop agent + send queue) */
  onForceQueue?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /** Number of messages currently in the queue */
  queueCount?: number
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
  onForceSend,
  onQueue,
  onForceQueue,
  isStreaming = false,
  disabled = false,
  placeholder = 'Send a message...',
  className,
  autoFocus = false,
  queueCount = 0,
}: AgentInputAreaProps) {
  const input = useAgentStreamStore((s) => s.draftInputs.get(processId) ?? '')
  const setInput = useCallback((text: string) => {
    useAgentStreamStore.getState().setDraftInput(processId, text)
  }, [processId])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus when requested (e.g. new session created)
  useEffect(() => {
    if (autoFocus) {
      // Small delay to ensure the DOM is settled after layout
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    }
  }, [autoFocus])

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto'
    // Set height to scrollHeight, capped at max-height (handled by CSS)
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [input])

  const clearInput = useCallback(() => {
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }, [setInput])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || disabled) return
    if (isStreaming) {
      // While streaming, default Ctrl+Enter queues the message
      if (onQueue) {
        onQueue(input.trim())
        clearInput()
      }
      return
    }
    onSend(input.trim())
    clearInput()
  }, [input, disabled, isStreaming, onSend, onQueue, clearInput])

  const handleForceSend = useCallback(() => {
    if (!input.trim() || disabled || !isStreaming || !onForceSend) return
    onForceSend(input.trim())
    clearInput()
  }, [input, disabled, isStreaming, onForceSend, clearInput])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (isStreaming && e.shiftKey && onForceSend) {
        // Ctrl+Shift+Enter while streaming = force send (stop + send)
        handleForceSend()
      } else {
        // Ctrl+Enter = normal send or queue while streaming
        handleSubmit()
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }

  const hasInput = input.trim().length > 0 && !disabled
  const canSubmit = hasInput && !isStreaming
  const canQueue = hasInput && isStreaming
  const canForceSend = hasInput && isStreaming && !!onForceSend

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Queue indicator */}
      {queueCount > 0 && (
        <div className="flex items-center justify-between px-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground/70">
            <IconBolt className="h-3 w-3" />
            <span>{queueCount} message{queueCount > 1 ? 's' : ''} queued — will send when agent finishes</span>
          </div>
          {onForceQueue && (
            <button
              onClick={onForceQueue}
              className="text-amber-500 hover:text-amber-400 font-medium transition-colors"
            >
              Force send anyway
            </button>
          )}
        </div>
      )}
      <div
        className={cn(
          'relative flex items-end gap-1.5',
          'rounded-xl border border-border/40',
          'bg-card/50 backdrop-blur-md',
          'shadow-lg shadow-black/10',
          'p-2 pl-3',
          'focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20',
          'transition-all duration-200',
        )}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming && !hasInput ? 'Type to queue a message...' : placeholder}
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
          <div className="flex items-center gap-1">
            {/* Force send: stop agent + send message immediately */}
            {canForceSend && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleForceSend}
                className={cn(
                  'h-8 w-8 shrink-0',
                  'rounded-lg',
                  'transition-all duration-200',
                  'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:text-amber-400'
                )}
                title="Force send — stop agent and send now (Ctrl+Shift+Enter)"
                aria-label="Force send message"
              >
                <IconBolt className="h-4 w-4" />
              </Button>
            )}
            {/* Queue: send after agent finishes */}
            {canQueue && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleSubmit}
                className={cn(
                  'h-8 w-8 shrink-0',
                  'rounded-lg',
                  'transition-all duration-200',
                  'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary'
                )}
                title="Queue message — send after agent finishes (Ctrl+Enter)"
                aria-label="Queue message"
              >
                <IconSend className="h-4 w-4" />
              </Button>
            )}
            {/* Stop button always visible while streaming */}
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
          </div>
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
    </div>
  )
}
