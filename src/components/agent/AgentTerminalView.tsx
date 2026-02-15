import { useMemo, useState, useCallback } from 'react'
import { IconTerminal2, IconMessage } from '@tabler/icons-react'

import { Terminal } from '@/components/Terminal'
import { AgentMessageView } from './AgentMessageView'
import { useAgentStreamStore } from '@/stores/agent-stream-store'
import type {
  AgentConversation,
  AgentMessage as UIAgentMessage,
  AgentUIComposer,
  ContentBlock as UIContentBlock,
} from '@/types/agent-ui'
import type {
  TerminalAgentState,
  AgentMessage as StreamAgentMessage,
  ContentBlock as StreamContentBlock,
} from '@/types/stream-json'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// =============================================================================
// Types
// =============================================================================

type ViewMode = 'raw' | 'pretty'

interface AgentTerminalViewProps {
  sessionId: string
  isFocused: boolean
  agentType?: string // 'claude' | 'gemini' | 'codex'
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
  composer?: AgentUIComposer
  className?: string
}

// =============================================================================
// Mapping Functions
// =============================================================================

/**
 * Generate a unique ID for content blocks that don't have one
 */
function generateBlockId(messageId: string, index: number): string {
  return `${messageId}_block_${index}`
}

/**
 * Map a stream ContentBlock to a UI ContentBlock
 */
function mapContentBlock(
  block: StreamContentBlock,
  messageId: string,
  index: number
): UIContentBlock {
  const baseBlock = {
    id: generateBlockId(messageId, index),
    timestamp: Date.now(),
  }

  switch (block.type) {
    case 'text':
      return {
        ...baseBlock,
        type: 'text',
        content: block.content,
        isStreaming: !block.isComplete,
      }

    case 'thinking':
      return {
        ...baseBlock,
        type: 'thinking',
        content: block.content,
        isStreaming: !block.isComplete,
      }

    case 'tool_use':
      return {
        ...baseBlock,
        type: 'tool_use',
        toolId: block.toolId || '',
        toolName: block.toolName || '',
        input: block.toolInput || '{}',
        status: block.toolResultIsError ? 'error' : block.isComplete ? 'completed' : 'running',
      }

    case 'system':
      return {
        ...baseBlock,
        type: 'system',
        subtype: block.content,
      }

    default:
      // Fallback for unknown types - treat as text
      return {
        ...baseBlock,
        type: 'text',
        content: block.content,
      }
  }
}

/**
 * Map a stream AgentMessage to a UI AgentMessage
 */
function mapMessage(
  message: StreamAgentMessage,
  agentType: string
): UIAgentMessage {
  const isSystem = message.blocks.length > 0 && message.blocks[0]?.type === 'system'
  return {
    id: message.id,
    agentType,
    role: isSystem ? 'system' : 'assistant',
    blocks: message.blocks.map((block, idx) =>
      mapContentBlock(block, message.id, idx)
    ),
    status: message.status,
    timestamp: message.startedAt,
    metadata: {
      model: message.model,
      usage: message.usage,
      stopReason: message.stopReason,
    },
  }
}

/**
 * Convert stream store state to AgentConversation format
 */
function mapToConversation(
  terminalId: string,
  agentType: string,
  state: TerminalAgentState | undefined
): AgentConversation {
  if (!state) {
    return {
      terminalId,
      agentType,
      messages: [],
      currentMessage: null,
      status: 'idle',
    }
  }

  const messages = state.messages.map((msg) => mapMessage(msg, agentType))
  const currentMessage = state.currentMessage
    ? mapMessage(state.currentMessage, agentType)
    : null

  let status: AgentConversation['status'] = 'idle'
  if (state.isActive) {
    status = 'streaming'
  } else if (state.error) {
    status = 'error'
  } else if (state.messages.length > 0) {
    status = 'completed'
  }

  return {
    terminalId,
    agentType,
    messages,
    currentMessage,
    status,
  }
}

// =============================================================================
// Component
// =============================================================================

/**
 * AgentTerminalView - A component that wraps Terminal and allows toggling
 * between raw XTerm and pretty React views.
 *
 * Features:
 * - Toggle button to switch between 'raw' (XTerm) and 'pretty' (AgentMessageView) modes
 * - Both views are rendered but one is hidden to preserve XTerm state
 * - Smooth CSS transitions between modes
 * - Floating toggle button in top-right corner
 */
export function AgentTerminalView({
  sessionId,
  isFocused,
  agentType = 'claude',
  viewMode: controlledViewMode,
  onViewModeChange,
  composer,
  className,
}: AgentTerminalViewProps) {
  // Internal state for uncontrolled mode
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('raw')

  // Determine if we're controlled or uncontrolled
  const isControlled = controlledViewMode !== undefined
  const viewMode = isControlled ? controlledViewMode : internalViewMode

  // Subscribe to stream state for this terminal.
  // Use the full state object here since this component does need to update
  // when the conversation changes. The key improvement is that this component
  // is only mounted when the user is actually viewing this terminal in the dock.
  const state = useAgentStreamStore((s) => s.terminals.get(sessionId))
  const isStreaming = state?.currentMessage?.status === 'streaming'

  // Convert stream state to AgentConversation format
  const conversation = useMemo(
    () => mapToConversation(sessionId, agentType, state),
    [sessionId, agentType, state]
  )

  // Handle view mode toggle
  const handleToggle = useCallback(() => {
    const newMode = viewMode === 'raw' ? 'pretty' : 'raw'
    if (isControlled && onViewModeChange) {
      onViewModeChange(newMode)
    } else {
      setInternalViewMode(newMode)
    }
  }, [viewMode, isControlled, onViewModeChange])

  // Check if we have any agent content to display in pretty mode
  const hasAgentContent =
    conversation.messages.length > 0 || conversation.currentMessage !== null

  return (
    <div className={cn('relative h-full w-full', className)}>
      {/* Toggle Button - Floating in top-right corner */}
      <div className="absolute right-2 top-2 z-10">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggle}
          className={cn(
            'h-7 w-7 rounded-md',
            'bg-background/80 backdrop-blur-sm',
            'border border-border/50',
            'hover:bg-accent hover:text-accent-foreground',
            'transition-all duration-200',
            // Pulse when streaming and in raw mode to hint at pretty view
            isStreaming && viewMode === 'raw' && 'animate-pulse'
          )}
          title={viewMode === 'raw' ? 'Switch to pretty view' : 'Switch to raw view'}
        >
          {viewMode === 'raw' ? (
            <IconMessage className="h-4 w-4" />
          ) : (
            <IconTerminal2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Raw Terminal View */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-200',
          viewMode === 'raw'
            ? 'opacity-100 z-0'
            : 'opacity-0 pointer-events-none z-[-1]'
        )}
      >
        <Terminal sessionId={sessionId} isFocused={isFocused && viewMode === 'raw'} />
      </div>

      {/* Pretty View */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-200',
          viewMode === 'pretty'
            ? 'opacity-100 z-0'
            : 'opacity-0 pointer-events-none z-[-1]'
        )}
      >
        {hasAgentContent ? (
          <AgentMessageView
            conversation={conversation}
            composer={composer}
            className="h-full bg-background"
            autoScroll={isStreaming}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <IconMessage className="mx-auto h-8 w-8 opacity-50" />
              <p className="mt-2 text-sm">No agent messages yet</p>
              <p className="text-xs opacity-70">
                Agent output will appear here when available
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
