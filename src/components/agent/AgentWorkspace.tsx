import { useEffect, useCallback, useState, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useAgentStreamStore } from '@/stores/agent-stream-store'
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
  processId: initialProcessId,
  agentType,
  cwd,
  className,
}: AgentWorkspaceProps) {
  // Track all process IDs that belong to this conversation (for multi-turn)
  const [activeProcessIds, setActiveProcessIds] = useState<Set<string>>(new Set([initialProcessId]))
  const [isProcessing, setIsProcessing] = useState(false)
  const [userMessages, setUserMessages] = useState<UIAgentMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Subscribe to process exit - marks processing as done for ANY of our processes
  useEffect(() => {
    if (!window.electron?.agent?.onProcessExit) return

    const unsubscribe = window.electron.agent.onProcessExit((id, _code) => {
      if (activeProcessIds.has(id)) {
        setIsProcessing(false)
      }
    })
    return unsubscribe
  }, [activeProcessIds])

  // Subscribe to raw events to capture session_id for multi-turn
  useEffect(() => {
    if (!window.electron?.agent?.onStreamEvent) return

    const unsubscribe = window.electron.agent.onStreamEvent((id, event) => {
      if (activeProcessIds.has(id)) {
        const rawEvent = event as { type?: string; session_id?: string; data?: { messageId?: string } }
        // Capture session_id from system init event or agent-message-start
        if (rawEvent.session_id && !sessionId) {
          setSessionId(rawEvent.session_id)
          console.log(`[AgentWorkspace] Captured session_id: ${rawEvent.session_id}`)
        }
        // Also check transformed events for session info
        if (rawEvent.data?.messageId && !sessionId) {
          setSessionId(rawEvent.data.messageId)
          console.log(`[AgentWorkspace] Captured session_id from messageId: ${rawEvent.data.messageId}`)
        }
      }
    })
    return unsubscribe
  }, [activeProcessIds, sessionId])

  // Handle sending messages
  const handleSend = useCallback(
    async (message: string) => {
      if (!window.electron?.agent) return

      // Optimistically add user message to UI
      const userMessage: UIAgentMessage = {
        id: `user_${Date.now()}`,
        agentType,
        role: 'user',
        blocks: [
          {
            id: `user_${Date.now()}_block_0`,
            type: 'text',
            content: message,
            timestamp: Date.now(),
          },
        ],
        status: 'completed',
        timestamp: Date.now(),
      }
      setUserMessages((prev) => [...prev, userMessage])
      setIsProcessing(true)

      // For multi-turn: spawn new process with --resume if we have a session
      // The first message uses the existing process, follow-ups spawn new ones
      if (sessionId) {
        console.log(`[AgentWorkspace] Multi-turn: spawning new process with --resume ${sessionId}`)
        const result = await window.electron.agent.spawn({
          agentType,
          cwd,
          resumeSessionId: sessionId,
        })
        if (result.success && result.process) {
          // Track the new process ID
          setActiveProcessIds((prev) => new Set([...prev, result.process!.id]))
          // Send message to the new process
          await window.electron.agent.sendMessage(result.process.id, {
            type: 'user',
            message: {
              role: 'user',
              content: message,
            },
          })
        }
      } else {
        // First message - send to existing process
        await window.electron.agent.sendMessage(initialProcessId, {
          type: 'user',
          message: {
            role: 'user',
            content: message,
          },
        })
      }
    },
    [initialProcessId, agentType, cwd, sessionId]
  )

  // Get state from all active processes in this conversation
  // Use useShallow to prevent infinite re-renders from array creation
  const allProcessStates = useAgentStreamStore(
    useShallow((store) => {
      const states: TerminalAgentState[] = []
      for (const pid of activeProcessIds) {
        const state = store.terminals.get(pid)
        if (state) states.push(state)
      }
      return states
    })
  )

  // Convert stream state to AgentConversation format, merging user messages
  const conversation = useMemo(() => {
    // Merge messages from all process states
    const assistantMessages: UIAgentMessage[] = []
    let currentMessage: UIAgentMessage | null = null
    let anyActive = false

    for (const processState of allProcessStates) {
      // Add completed messages
      for (const msg of processState.messages) {
        assistantMessages.push(mapMessage(msg, agentType))
      }
      // Track current streaming message (from most recent process)
      if (processState.currentMessage) {
        currentMessage = mapMessage(processState.currentMessage, agentType)
      }
      if (processState.isActive) {
        anyActive = true
      }
    }

    // Merge user messages with assistant messages, sorted by timestamp
    const allMessages = [...userMessages, ...assistantMessages].sort(
      (a, b) => a.timestamp - b.timestamp
    )

    // Determine status
    let status: AgentConversation['status'] = 'idle'
    if (isProcessing || anyActive) {
      status = 'streaming'
    } else if (allMessages.length > 0) {
      status = 'completed'
    }

    return {
      terminalId: initialProcessId,
      agentType,
      messages: allMessages,
      currentMessage,
      status,
    }
  }, [initialProcessId, agentType, allProcessStates, userMessages, isProcessing])

  // Determine placeholder text
  const placeholder = conversation.status === 'streaming'
    ? 'Agent is responding...'
    : `Send a message to ${agentType}...`

  // Disable input while processing, but NOT based on process alive state
  // (since processes exit normally after each message in our architecture)
  const inputDisabled = conversation.status === 'streaming'

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
          processId={initialProcessId}
          onSend={handleSend}
          disabled={inputDisabled}
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}
