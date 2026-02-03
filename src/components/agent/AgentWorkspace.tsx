import { useEffect, useCallback, useState, useMemo } from 'react'

import { useAgentStream } from '@/hooks/useAgentStream'
import { AgentMessageView } from './AgentMessageView'
import { AgentInputArea } from './AgentInputArea'
import { cn } from '@/lib/utils'
import type {
  AgentConversation,
  AgentMessage as UIAgentMessage,
  ContentBlock as UIContentBlock,
} from '@/types/agent-ui'
import type {
  TerminalAgentState,
  AgentMessage as StreamAgentMessage,
  ContentBlock as StreamContentBlock,
} from '@/types/stream-json'

// =============================================================================
// Types
// =============================================================================

interface AgentWorkspaceProps {
  processId: string
  agentType: 'claude' | 'codex' | 'gemini'
  cwd: string
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
        status: block.isComplete ? 'completed' : 'running',
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
  return {
    id: message.id,
    agentType,
    role: 'assistant',
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
  processId: string,
  agentType: string,
  state: TerminalAgentState | undefined
): AgentConversation {
  if (!state) {
    return {
      terminalId: processId,
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
    terminalId: processId,
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
 * AgentWorkspace - A container component that combines AgentMessageView
 * with AgentInputArea for a complete agent chat interface.
 *
 * Features:
 * - Displays conversation messages in a scrollable area
 * - Provides text input for sending messages to the agent
 * - Tracks process lifecycle (isAlive)
 * - Disables input while streaming or when process is dead
 */
export function AgentWorkspace({
  processId,
  agentType,
  cwd: _cwd, // Reserved for future use (e.g., displaying working directory)
  className,
}: AgentWorkspaceProps) {
  const { state, isStreaming } = useAgentStream(processId)
  const [isAlive, setIsAlive] = useState(true)

  // Subscribe to process exit
  useEffect(() => {
    if (!window.electron?.agent?.onProcessExit) return

    const unsubscribe = window.electron.agent.onProcessExit((id, _code) => {
      if (id === processId) {
        setIsAlive(false)
      }
    })
    return unsubscribe
  }, [processId])

  // Handle sending messages
  const handleSend = useCallback(
    async (message: string) => {
      if (!window.electron?.agent?.sendMessage) return

      await window.electron.agent.sendMessage(processId, {
        type: 'user_message',
        content: message,
      })
    },
    [processId]
  )

  // Convert stream state to AgentConversation format
  const conversation = useMemo(
    () => mapToConversation(processId, agentType, state),
    [processId, agentType, state]
  )

  // Determine placeholder text
  const placeholder = isStreaming
    ? 'Agent is responding...'
    : `Send a message to ${agentType}...`

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Message View - Flex grow, scrollable */}
      <div className="flex-1 overflow-hidden">
        <AgentMessageView
          conversation={conversation}
          autoScroll={true}
        />
      </div>

      {/* Input Area - Fixed at bottom */}
      <div className="border-t border-border p-4">
        <AgentInputArea
          processId={processId}
          onSend={handleSend}
          disabled={!isAlive || isStreaming}
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}
