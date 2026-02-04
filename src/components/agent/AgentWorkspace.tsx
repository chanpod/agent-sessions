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
  resumeSessionId?: string
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
  resumeSessionId,
}: AgentWorkspaceProps) {
  // Track all process IDs that belong to this conversation (for multi-turn)
  const [activeProcessIds, setActiveProcessIds] = useState<Set<string>>(new Set([initialProcessId]))
  // isProcessing: true between user sending message and agent starting to respond
  // This provides immediate feedback while waiting for the agent to start
  const [isProcessing, setIsProcessing] = useState(false)
  const [userMessages, setUserMessages] = useState<UIAgentMessage[]>([])
  // Session ID is captured by the agent-stream-store from detector events (agent-session-init).
  // Subscribe to the store's terminalToSession mapping to get it reactively.
  const storeSessionId = useAgentStreamStore(
    (store) => store.terminalToSession.get(initialProcessId) ?? null
  )
  const sessionId = resumeSessionId ?? storeSessionId

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
          // Mark waiting immediately so sidebar spinner starts
          useAgentStreamStore.getState().markWaitingForResponse(result.process.id)
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
        // First message - mark waiting immediately so sidebar spinner starts
        useAgentStreamStore.getState().markWaitingForResponse(initialProcessId)
        // Send to existing process
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

  // Check if any process is actively streaming (from store state)
  const anyActive = useMemo(() => {
    return allProcessStates.some((state) => state.isActive)
  }, [allProcessStates])

  // Clear isProcessing when agent starts responding (anyActive becomes true)
  // This transitions from "waiting for agent" to "agent is responding"
  useEffect(() => {
    if (anyActive && isProcessing) {
      setIsProcessing(false)
    }
  }, [anyActive, isProcessing])

  // Convert stream state to AgentConversation format, merging user messages
  const conversation = useMemo(() => {
    // Merge messages from all process states
    const assistantMessages: UIAgentMessage[] = []
    let currentMessage: UIAgentMessage | null = null

    for (const processState of allProcessStates) {
      // Add completed messages
      for (const msg of processState.messages) {
        assistantMessages.push(mapMessage(msg, agentType))
      }
      // Track current streaming message (from most recent process)
      if (processState.currentMessage) {
        currentMessage = mapMessage(processState.currentMessage, agentType)
      }
    }

    // Merge user messages with assistant messages, sorted by timestamp
    const allMessages = [...userMessages, ...assistantMessages].sort(
      (a, b) => a.timestamp - b.timestamp
    )

    // Determine status:
    // - isProcessing: user sent message, waiting for agent to start
    // - anyActive: agent is actively responding (from store's isActive)
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
  }, [initialProcessId, agentType, allProcessStates, userMessages, isProcessing, anyActive])

  // Determine placeholder text
  const isStreaming = conversation.status === 'streaming'
  const placeholder = isStreaming
    ? 'Agent is responding...'
    : `Send a message to ${agentType}...`

  // Stop handler - kill all active processes and reset UI state
  const handleStop = useCallback(async () => {
    if (!window.electron?.agent) return
    for (const pid of activeProcessIds) {
      await window.electron.agent.kill(pid)
      useAgentStreamStore.getState().resetTerminalActivity(pid)
    }
    setIsProcessing(false)
  }, [activeProcessIds])

  return (
    <div className={cn('flex flex-col h-full relative', className)}>
      {/* Message View - Flex grow, scrollable */}
      <div className="flex-1 overflow-hidden">
        <AgentMessageView
          conversation={conversation}
          autoScroll={true}
          agentType={agentType}
        />
      </div>

      {/* Input Area - Floating at bottom */}
      <div className="px-4 pb-4 pt-2">
        <div className="mx-auto max-w-3xl">
          <AgentInputArea
            processId={initialProcessId}
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
            placeholder={placeholder}
          />
        </div>
      </div>
    </div>
  )
}
