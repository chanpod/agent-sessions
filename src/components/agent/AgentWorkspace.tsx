import { useEffect, useCallback, useState, useMemo, useRef } from 'react'
import { Pencil, PencilOff } from 'lucide-react'
import { IconSparkles, IconBug } from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import { useAgentStreamStore } from '@/stores/agent-stream-store'
import { useTerminalStore, type SavedTerminalConfig } from '@/stores/terminal-store'
import { AgentMessageView, type AgentMessageViewHandle } from './AgentMessageView'
import { AgentInputArea } from './AgentInputArea'
import { DebugEventSheet } from './DebugEventLog'
import { cn, formatModelDisplayName } from '@/lib/utils'
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
  projectId?: string
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
  projectId,
}: AgentWorkspaceProps) {
  const messageViewRef = useRef<AgentMessageViewHandle>(null)

  // isProcessing: true between user sending message and agent starting to respond
  // This provides immediate feedback while waiting for the agent to start
  const [isProcessing, setIsProcessing] = useState(false)
  const [editsEnabled, setEditsEnabled] = useState(true)
  const [debugSheetOpen, setDebugSheetOpen] = useState(false)

  // Get the configured model from the terminal store (set at launch time)
  const configuredModel = useTerminalStore(
    (s) => s.savedConfigs.find((c: SavedTerminalConfig) => c.id === initialProcessId)?.model ?? null
  )

  // Read-only tools for when edits are disabled
  const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Task', 'TodoRead', 'TodoWrite', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'Skill']
  const allowedTools = editsEnabled ? undefined : READ_ONLY_TOOLS

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

  // Auto-generate title once sessionId is available (after first message gets a response).
  // Runs reactively when sessionId populates, avoiding the race condition of checking
  // inside handleSend before the session init event arrives.
  useEffect(() => {
    if (!sessionId || !window.electron?.agent) return
    const store = useAgentStreamStore.getState()
    if (store.hasTitleBeenGenerated(sessionId)) return
    const conversation = store.getConversation(initialProcessId)
    if (conversation.userMessages.length < 1) return

    store.markTitleGenerated(sessionId)
    const firstMessage = conversation.userMessages[0].content
    window.electron.agent.generateTitle({ userMessages: [firstMessage] }).then((result) => {
      if (result.success && result.title) {
        useTerminalStore.getState().updateSessionTitle(initialProcessId, result.title)
      }
    }).catch((err) => {
      console.warn('[AgentWorkspace] Title generation failed:', err)
    })
  }, [sessionId, initialProcessId])

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

      // Scroll to bottom after user message is rendered
      requestAnimationFrame(() => {
        messageViewRef.current?.scrollToBottom('auto')
      })

      try {
        // Codex uses one-shot `exec` mode — every message (including the first)
        // spawns a new process with the prompt as a CLI argument.
        // Multi-turn uses `codex exec resume SESSION_ID`.
        if (agentType === 'codex') {
          console.log(`[AgentWorkspace] Codex: spawning process with prompt`, sessionId ? `(resuming ${sessionId})` : '(first message)')

          // Kill the idle placeholder process (sleep infinity) before spawning the real one.
          // This avoids node-pty conpty cleanup errors ("AttachConsole failed") that occur
          // when the placeholder is killed later during terminal cleanup on Windows.
          if (!sessionId) {
            await window.electron.agent.kill(initialProcessId).catch(() => {})
          }

          const result = await window.electron.agent.spawn({
            agentType,
            cwd,
            resumeSessionId: sessionId || undefined,
            prompt: message,
            ...(configuredModel ? { model: configuredModel } : {}),
            ...(allowedTools ? { allowedTools } : {}),
            ...(projectId ? { projectId } : {}),
          })
          if (result.success && result.process) {
            store.addConversationProcessId(initialProcessId, result.process.id)
            store.markWaitingForResponse(result.process.id)
          } else {
            console.error('[AgentWorkspace] Codex spawn failed:', result)
            setIsProcessing(false)
          }
          return
        }

        // For multi-turn: spawn new process with --resume if we have a session
        // The first message uses the existing process, follow-ups spawn new ones
        if (sessionId) {
          console.log(`[AgentWorkspace] Multi-turn: spawning new process with --resume ${sessionId}`)
          const result = await window.electron.agent.spawn({
            agentType,
            cwd,
            resumeSessionId: sessionId,
            ...(allowedTools ? { allowedTools } : {}),
            ...(projectId ? { projectId } : {}),
          })
          if (result.success && result.process) {
            // Track the new process ID in the store
            store.addConversationProcessId(initialProcessId, result.process.id)
            // Mark waiting immediately so sidebar spinner starts
            store.markWaitingForResponse(result.process.id)
            // Send message to the new process
            console.log(`[AgentWorkspace] Sending message (${message.length} chars) to process ${result.process.id}`)
            const sendResult = await window.electron.agent.sendMessage(result.process.id, {
              type: 'user',
              message: {
                role: 'user',
                content: message,
              },
            })
            if (sendResult && !sendResult.success) {
              console.error('[AgentWorkspace] sendMessage failed:', sendResult.error)
            }
          } else {
            console.error('[AgentWorkspace] Resume spawn failed:', result)
            setIsProcessing(false)
          }
        } else {
          // First message - mark waiting immediately so sidebar spinner starts
          store.markWaitingForResponse(initialProcessId)
          // Send to existing process
          console.log(`[AgentWorkspace] Sending first message (${message.length} chars) to process ${initialProcessId}`)
          const sendResult = await window.electron.agent.sendMessage(initialProcessId, {
            type: 'user',
            message: {
              role: 'user',
              content: message,
            },
          })
          if (sendResult && !sendResult.success) {
            console.error('[AgentWorkspace] sendMessage failed:', sendResult.error)
          }
        }
      } catch (err) {
        console.error('[AgentWorkspace] handleSend failed:', err)
        setIsProcessing(false)
      }
    },
    [initialProcessId, agentType, cwd, sessionId, configuredModel, allowedTools]
  )

  const handleAnswerQuestion = useCallback(
    async (_toolId: string, answers: Record<string, string>) => {
      if (!window.electron?.agent) return

      // Format the answer as a readable message for the --resume turn
      const answerLines = Object.entries(answers)
        .map(([question, answer]) => `- ${question}: ${answer}`)
        .join('\n')
      const messageText = `Here are my answers to your questions:\n\n${answerLines}`

      const store = useAgentStreamStore.getState()

      // Clear the waiting-for-question flag on all processes in this conversation
      for (const pid of activeProcessIds) {
        store.clearWaitingForQuestion(pid)
      }

      // Add user message to the store (persists across session switching)
      store.addConversationUserMessage(initialProcessId, {
        id: `user_${Date.now()}`,
        content: messageText,
        timestamp: Date.now(),
        agentType,
      })
      setIsProcessing(true)

      // Scroll to bottom after user message is rendered
      requestAnimationFrame(() => {
        messageViewRef.current?.scrollToBottom('auto')
      })

      try {
        if (sessionId) {
          // Spawn a new --resume process with the user's answer, same as handleSend
          const result = await window.electron.agent.spawn({
            agentType,
            cwd,
            resumeSessionId: sessionId,
            ...(allowedTools ? { allowedTools } : {}),
            ...(projectId ? { projectId } : {}),
          })
          if (result.success && result.process) {
            store.addConversationProcessId(initialProcessId, result.process.id)
            store.markWaitingForResponse(result.process.id)
            await window.electron.agent.sendMessage(result.process.id, {
              type: 'user',
              message: {
                role: 'user',
                content: messageText,
              },
            })
          } else {
            console.error('[AgentWorkspace] Resume spawn for question answer failed:', result)
            setIsProcessing(false)
          }
        } else {
          // No session yet (unlikely for AskUserQuestion, but handle gracefully)
          store.markWaitingForResponse(initialProcessId)
          await window.electron.agent.sendMessage(initialProcessId, {
            type: 'user',
            message: {
              role: 'user',
              content: messageText,
            },
          })
        }
      } catch (err) {
        console.error('[AgentWorkspace] handleAnswerQuestion failed:', err)
        setIsProcessing(false)
      }
    },
    [activeProcessIds, initialProcessId, agentType, cwd, sessionId, allowedTools]
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

  // Compute anyActive directly from the store to avoid stale closure issues.
  // The previous approach derived this from allProcessStates, which depended on
  // activeProcessIds captured in a closure. When a new multi-turn process was added,
  // the closure would be stale until the next render, causing a brief "done" flash.
  const anyActive = useAgentStreamStore((store) => {
    const conv = store.conversations.get(initialProcessId)
    const pids = conv?.processIds ?? [initialProcessId]

    for (const pid of pids) {
      const state = store.terminals.get(pid)
      if (!state) continue

      // Primary signals: actively streaming or waiting for response
      if (state.isActive || state.isWaitingForResponse) return true

      // Safety net: process still running and last message indicated tool execution.
      // This handles cases where isActive might be incorrectly cleared during tool use
      // (e.g., nested agent events from sub-agents leaking through the PTY).
      if (!state.processExited) {
        const lastMsg = state.messages[state.messages.length - 1]
        if (lastMsg?.stopReason === 'tool_use') return true
      }
    }
    return false
  })

  // Clear isProcessing when agent starts responding (anyActive becomes true)
  // This transitions from "waiting for agent" to "agent is responding"
  useEffect(() => {
    if (anyActive && isProcessing) {
      setIsProcessing(false)
    }
  }, [anyActive, isProcessing])

  // Safety net: clear isProcessing after timeout to prevent permanent hangs
  useEffect(() => {
    if (!isProcessing) return
    const timeout = setTimeout(() => {
      console.warn('[AgentWorkspace] isProcessing timeout - clearing stale processing state')
      setIsProcessing(false)
    }, 30_000)
    return () => clearTimeout(timeout)
  }, [isProcessing])

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

    // Deduplicate by message ID (same message can appear across multiple process states)
    const seenIds = new Set<string>()
    const dedupedMessages = assistantMessages.filter((msg) => {
      if (seenIds.has(msg.id)) return false
      seenIds.add(msg.id)
      return true
    })

    // Merge user messages with assistant messages, sorted by timestamp
    const allMessages = [...userMessages, ...dedupedMessages].sort(
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

  // Derive the latest model name from the most recent assistant message
  const latestModel = useMemo(() => {
    // Check current streaming message first, iterating from most recent process
    for (let i = allProcessStates.length - 1; i >= 0; i--) {
      const state = allProcessStates[i]!
      if (state.currentMessage?.model) return state.currentMessage.model
      for (let j = state.messages.length - 1; j >= 0; j--) {
        const msg = state.messages[j]
        if (msg?.model) return msg.model
      }
    }
    return null
  }, [allProcessStates])

  // Format full model ID to a short display name (e.g. "claude-opus-4-5-20251101" → "Opus 4.5")
  // Falls back to configured model from terminal store (useful for Codex which doesn't report model in events)
  const modelDisplayName = useMemo(() => {
    const raw = latestModel || configuredModel
    if (!raw) return null
    return formatModelDisplayName(raw)
  }, [latestModel, configuredModel])

  // Determine placeholder text and thinking indicator state
  const isStreaming = conversation.status === 'streaming'
  const showThinkingIndicator = isStreaming && !conversation.currentMessage
  const placeholder = `Send a message to ${agentType}...`

  // Stop handler - kill all active processes and reset UI state
  const handleStop = useCallback(async () => {
    if (!window.electron?.agent) return
    for (const pid of activeProcessIds) {
      await window.electron.agent.kill(pid)
      useAgentStreamStore.getState().resetTerminalActivity(pid)
    }
    setIsProcessing(false)
  }, [activeProcessIds])

  // Queue a message to be sent after the agent finishes
  const handleQueue = useCallback((message: string) => {
    useAgentStreamStore.getState().enqueueMessage(initialProcessId, message)
  }, [initialProcessId])

  // Force send: stop the agent, then send the message
  const handleForceSend = useCallback(async (message: string) => {
    if (!window.electron?.agent) return
    // Stop all active processes first
    for (const pid of activeProcessIds) {
      await window.electron.agent.kill(pid)
      useAgentStreamStore.getState().resetTerminalActivity(pid)
    }
    // Clear any previously queued messages since we're force-sending
    useAgentStreamStore.getState().clearQueue(initialProcessId)
    // Small delay to let process exit events settle
    await new Promise((r) => setTimeout(r, 100))
    // Now send the message through the normal flow
    handleSend(message)
  }, [activeProcessIds, initialProcessId, handleSend])

  // Auto-send queued messages when agent finishes
  const prevAnyActive = useRef(anyActive)
  useEffect(() => {
    // Detect transition from active -> idle (agent just finished)
    if (prevAnyActive.current && !anyActive && !isProcessing) {
      const store = useAgentStreamStore.getState()
      const nextMessage = store.dequeueMessage(initialProcessId)
      if (nextMessage) {
        // Send the next queued message
        handleSend(nextMessage)
      }
    }
    prevAnyActive.current = anyActive
  }, [anyActive, isProcessing, initialProcessId, handleSend])

  // Read queue count reactively for the UI
  const queueCount = useAgentStreamStore(
    (s) => s.queuedMessages.get(initialProcessId)?.length ?? 0
  )

  return (
    <div className={cn('flex flex-col h-full relative', className)}>
      {/* Debug button - top left corner */}
      <button
        onClick={() => setDebugSheetOpen(true)}
        className={cn(
          'absolute top-2 left-2 z-10',
          'flex items-center gap-1.5 rounded-md px-2 py-1',
          'text-xs font-medium text-muted-foreground/40',
          'hover:text-muted-foreground hover:bg-muted/30',
          'transition-colors',
        )}
        title="Debug Events"
      >
        <IconBug className="size-3.5" />
      </button>

      {/* Message View - Flex grow, scrollable */}
      <div className="flex-1 overflow-hidden relative">
        <AgentMessageView
          ref={messageViewRef}
          conversation={conversation}
          autoScroll={true}
          agentType={agentType}
          onAnswerQuestion={handleAnswerQuestion}
        />

        {/* Thinking indicator - absolutely positioned so it doesn't shrink the scroll container */}
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 z-10',
            'bg-gradient-to-t from-background via-background/95 to-transparent',
            'transition-all duration-300 ease-out',
            showThinkingIndicator
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-2 pointer-events-none'
          )}
        >
          <div className="flex items-center gap-2.5 px-4 py-2 max-w-3xl mx-auto">
            <div className="flex size-5 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
              <IconSparkles className="size-3 text-primary" />
            </div>
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Thinking
            </span>
            <div className="flex gap-0.5">
              <span className="size-1 rounded-full bg-primary/60 animate-pulse" />
              <span className="size-1 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="size-1 rounded-full bg-primary/20 animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Debug Events Sheet */}
      <DebugEventSheet
        open={debugSheetOpen}
        onOpenChange={setDebugSheetOpen}
        processIds={activeProcessIds}
      />

      {/* Input Area - Floating at bottom */}
      <div className="px-4 pb-4 pt-2">
        <div className="mx-auto max-w-3xl">
          {/* Controls row - Edits toggle (left) + Model label (right) */}
          <div className="flex items-center justify-between px-1 pb-1.5">
            {/* Edits toggle - Claude only */}
            {agentType === 'claude' ? (
              <button
                onClick={() => setEditsEnabled(!editsEnabled)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all',
                  editsEnabled
                    ? 'text-muted-foreground hover:bg-muted/50'
                    : 'text-amber-400 bg-amber-400/10 hover:bg-amber-400/20'
                )}
                title={editsEnabled ? 'Click to disable file edits (read-only mode)' : 'Click to enable file edits'}
              >
                {editsEnabled ? (
                  <Pencil className="w-3.5 h-3.5" />
                ) : (
                  <PencilOff className="w-3.5 h-3.5" />
                )}
                <span>Edits {editsEnabled ? 'on' : 'off'}</span>
              </button>
            ) : (
              <div />
            )}
            {/* Model label */}
            {modelDisplayName && (
              <span className="text-[11px] font-medium text-muted-foreground/70 px-2 py-1">
                {modelDisplayName}
              </span>
            )}
          </div>
          <AgentInputArea
            processId={initialProcessId}
            onSend={handleSend}
            onStop={handleStop}
            onForceSend={handleForceSend}
            onQueue={handleQueue}
            isStreaming={isStreaming}
            placeholder={placeholder}
            autoFocus={!resumeSessionId}
            queueCount={queueCount}
          />
        </div>
      </div>
    </div>
  )
}
