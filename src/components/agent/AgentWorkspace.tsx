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
  // isProcessing: true between user sending message and agent starting to respond
  // This provides immediate feedback while waiting for the agent to start
  const [isProcessing, setIsProcessing] = useState(false)

  // Conversation state lives in the store so it survives unmount/remount (session switching).
  // Use separate selectors to avoid creating new objects on every render.
  const storeProcessIds = useAgentStreamStore(
    useShallow((store) => store.conversations.get(initialProcessId)?.processIds ?? null)
  )
  const storeUserMessages = useAgentStreamStore(
    useShallow((store) => store.conversations.get(initialProcessId)?.userMessages ?? null)
  )

  const activeProcessIds = useMemo(
    () => new Set(storeProcessIds ?? [initialProcessId]),
    [storeProcessIds, initialProcessId]
  )

  // Map stored user messages to UI format
  const userMessages = useMemo<UIAgentMessage[]>(() =>
    (storeUserMessages ?? []).map((msg) => ({
      id: msg.id,
      agentType: msg.agentType,
      role: 'user' as const,
      blocks: [{
        id: `${msg.id}_block_0`,
        type: 'text' as const,
        content: msg.content,
        timestamp: msg.timestamp,
      }],
      status: 'completed' as const,
      timestamp: msg.timestamp,
    })),
    [storeUserMessages]
  )

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

      const store = useAgentStreamStore.getState()

      // Add user message to the store (persists across session switching)
      store.addConversationUserMessage(initialProcessId, {
        id: `user_${Date.now()}`,
        content: message,
        timestamp: Date.now(),
        agentType,
      })
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
          // Track the new process ID in the store
          store.addConversationProcessId(initialProcessId, result.process.id)
          // Mark waiting immediately so sidebar spinner starts
          store.markWaitingForResponse(result.process.id)
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
        store.markWaitingForResponse(initialProcessId)
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

  // Check if any process is actively streaming or waiting to respond (from store state).
  // This survives component unmount/remount, unlike the local isProcessing state.
  const anyActive = useMemo(() => {
    return allProcessStates.some((state) => state.isActive || state.isWaitingForResponse)
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
