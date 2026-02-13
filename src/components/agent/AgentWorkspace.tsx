import { useEffect, useCallback, useState, useMemo, useRef, memo } from 'react'
import { Pencil, PencilOff } from 'lucide-react'
import { IconBug, IconAlertTriangle } from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import { useAgentStreamStore } from '@/stores/agent-stream-store'
import { useToastStore } from '@/stores/toast-store'
import { useTerminalStore, type SavedTerminalConfig } from '@/stores/terminal-store'
import { AgentMessageView, type AgentMessageViewHandle } from './AgentMessageView'
import { AgentInputArea } from './AgentInputArea'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { DebugEventSheet } from './DebugEventLog'
import { ThinkingIndicator } from './ThinkingIndicator'
import { BashRulesProvider } from './BashRulesContext'
import { cn, formatModelDisplayName } from '@/lib/utils'
import type {
  AgentConversation,
  AgentMessage as UIAgentMessage,
  ContentBlock as UIContentBlock,
} from '@/types/agent-ui'
import type {
  AgentMessage as StreamAgentMessage,
  ContentBlock as StreamContentBlock,
} from '@/types/stream-json'

// =============================================================================
// Response Timer
// =============================================================================

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

/**
 * Live response timer that shows elapsed time since the user sent their message.
 * Ticks every second while the agent is active, freezes when the turn ends.
 */
const ResponseTimer = memo(function ResponseTimer({
  startedAt,
  endedAt,
  isActive,
}: {
  startedAt: number
  endedAt?: number
  isActive: boolean
}) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!isActive || endedAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [isActive, endedAt])

  const elapsed = (endedAt ?? (isActive ? now : startedAt)) - startedAt
  if (elapsed < 1000) return null

  return (
    <span
      className={cn(
        'text-[11px] tabular-nums px-2 py-1',
        endedAt ? 'text-muted-foreground/70' : 'text-muted-foreground/50'
      )}
      title={endedAt ? `Response completed in ${formatDuration(elapsed)}` : 'Elapsed time'}
    >
      {formatDuration(elapsed)}
    </span>
  )
})

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
  // System messages (compaction, etc.) get role: 'system'; everything else is 'assistant'
  const isSystem = message.blocks.length > 0 && message.blocks[0]?.type === 'system'

  // Map blocks, also synthesizing tool_result blocks for tool_use blocks that
  // have result data. The store keeps the result text on the tool_use ContentBlock
  // itself (toolResult / toolResultIsError), but the UI pipeline expects separate
  // ToolResultBlock objects so that AgentMessageView can pair them via toolResultMap.
  const uiBlocks: UIContentBlock[] = []
  for (let idx = 0; idx < message.blocks.length; idx++) {
    const block = message.blocks[idx]!
    uiBlocks.push(mapContentBlock(block, message.id, idx))

    if (block.type === 'tool_use' && block.toolId && block.toolResult != null) {
      uiBlocks.push({
        id: generateBlockId(message.id, idx) + '_result',
        timestamp: Date.now(),
        type: 'tool_result',
        toolId: block.toolId,
        result: block.toolResult,
        isError: block.toolResultIsError,
      })
    }
  }

  return {
    id: message.id,
    agentType,
    role: isSystem ? 'system' : 'assistant',
    blocks: uiBlocks,
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

  // Flush any buffered background delta events when this session becomes visible.
  // While the session was in the background, deltas were deferred to avoid
  // unnecessary store updates. Now that the user is looking at it, apply them.
  useEffect(() => {
    useAgentStreamStore.getState().flushBackgroundDeltas(initialProcessId)
  }, [initialProcessId])

  // The edit tools whose allowlist status the toggle controls
  const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit']

  // Initialize edits toggle from the permission allowlist
  useEffect(() => {
    if (!window.electron?.permission?.getAllowlistConfig) return
    window.electron.permission.getAllowlistConfig(cwd).then((config) => {
      // Edits are "on" if Edit and Write are both in the allowlist
      const hasEdit = config.tools.includes('Edit')
      const hasWrite = config.tools.includes('Write')
      setEditsEnabled(hasEdit && hasWrite)
    })
  }, [cwd])

  const handleToggleEdits = useCallback(async () => {
    if (!window.electron?.permission) return
    const newEnabled = !editsEnabled
    setEditsEnabled(newEnabled)
    for (const tool of EDIT_TOOLS) {
      if (newEnabled) {
        await window.electron.permission.addAllowedTool(cwd, tool)
      } else {
        await window.electron.permission.removeAllowedTool(cwd, tool)
      }
    }
  }, [editsEnabled, cwd])

  // Get the configured model from the terminal store (set at launch time)
  const configuredModel = useTerminalStore(
    (s) => s.savedConfigs.find((c: SavedTerminalConfig) => c.id === initialProcessId)?.model ?? null
  )

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

  // Subscribe to latest context usage for this session (updated on every message start/end)
  const contextUsage = useAgentStreamStore(
    (store) => sessionId ? store.latestContextUsage.get(sessionId) ?? null : null
  )

  // Subscribe to turn timing for the response timer
  const turnTiming = useAgentStreamStore(
    useShallow((store) => store.turnTimings.get(initialProcessId) ?? null)
  )

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
    const firstMessage = conversation.userMessages[0]!.content
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
      // Get the current session title so multi-turn spawns reuse the same log file
      const currentTitle = useTerminalStore.getState().sessions.find(s => s.id === initialProcessId)?.title

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
            ...(projectId ? { projectId } : {}),
            ...(currentTitle ? { sessionTitle: currentTitle } : {}),
          })
          if (result.success && result.process) {
            store.addConversationProcessId(initialProcessId, result.process.id)
            store.markWaitingForResponse(result.process.id)
          } else {
            console.error('[AgentWorkspace] Codex spawn failed:', result)
            setIsProcessing(false)
            useToastStore.getState().addToast(
              'Failed to start agent process. Check that the CLI tool is installed.',
              'error',
              8000
            )
          }
          return
        }

        // For multi-turn: spawn new process with --resume if we have a session
        // The first message uses the existing process, follow-ups spawn new ones
        if (sessionId) {
          // Clear errors from previous processes so stale exit code 256 errors
          // don't permanently poison the conversation status
          const conv = store.conversations.get(initialProcessId)
          if (conv) {
            for (const pid of conv.processIds) {
              store.clearTerminalError(pid)
            }
          }

          console.log(`[AgentWorkspace] Multi-turn: spawning new process with --resume ${sessionId}`)
          const result = await window.electron.agent.spawn({
            agentType,
            cwd,
            resumeSessionId: sessionId,
            ...(projectId ? { projectId } : {}),
            ...(currentTitle ? { sessionTitle: currentTitle } : {}),
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
              setIsProcessing(false)
              useToastStore.getState().addToast(
                `Failed to send message: ${sendResult.error ?? 'Unknown error'}`,
                'error',
                8000
              )
            }
          } else {
            console.error('[AgentWorkspace] Resume spawn failed:', result)
            setIsProcessing(false)
            useToastStore.getState().addToast(
              'Failed to resume agent session. Try sending again or start a new session.',
              'error',
              8000
            )
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
            setIsProcessing(false)
            useToastStore.getState().addToast(
              `Failed to send message: ${sendResult.error ?? 'Unknown error'}`,
              'error',
              8000
            )
          }
        }
      } catch (err) {
        console.error('[AgentWorkspace] handleSend failed:', err)
        setIsProcessing(false)
      }
    },
    [initialProcessId, agentType, cwd, sessionId, configuredModel]
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
      const currentTitle = useTerminalStore.getState().sessions.find(s => s.id === initialProcessId)?.title

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
            ...(projectId ? { projectId } : {}),
            ...(currentTitle ? { sessionTitle: currentTitle } : {}),
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
            useToastStore.getState().addToast(
              'Failed to resume agent session. Try sending again or start a new session.',
              'error',
              8000
            )
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
    [activeProcessIds, initialProcessId, agentType, cwd, sessionId]
  )

  // =====================================================================
  // Optimized store selectors
  //
  // During streaming the TerminalAgentState object changes on every text
  // delta (~50-100/sec). The old approach pulled the entire object array
  // via useShallow, which always detected a change because the objects
  // are new references. The conversation useMemo then re-mapped every
  // completed message + sorted + deduped on every delta — O(n) wasted
  // work that snowballs as the conversation grows.
  //
  // The fix: separate *completed* messages (stable — only changes when
  // messages.length increases) from the *currentMessage* (changes on
  // every delta, but only needs to map one message).
  // =====================================================================

  // Completed messages from all processes — changes only when a message
  // finishes (message-end event pushes to messages[]). We compute a
  // stable fingerprint so Zustand skips re-renders during delta events.
  //
  // The fingerprint encodes: number of processes, each process's message
  // count, and the last message's blocks reference (for tool result updates).
  // When the fingerprint changes, we pull fresh message arrays.
  const completedMessageFingerprint = useAgentStreamStore((store) => {
    const conv = store.conversations.get(initialProcessId)
    const pids = conv?.processIds ?? [initialProcessId]
    let fp = ''
    for (const pid of pids) {
      const state = store.terminals.get(pid)
      if (state) {
        const lastBlocks = state.messages.length > 0
          ? state.messages[state.messages.length - 1]!.blocks.length
          : 0
        fp += `${state.messages.length}:${lastBlocks},`
      }
    }
    return fp
  })

  // Actually pull the message arrays — only re-runs when fingerprint changes
  const completedMessageArrays = useMemo(() => {
    // Read directly from store to get current arrays
    const store = useAgentStreamStore.getState()
    const conv = store.conversations.get(initialProcessId)
    const pids = conv?.processIds ?? [initialProcessId]
    const arrays: StreamAgentMessage[][] = []
    for (const pid of pids) {
      const state = store.terminals.get(pid)
      if (state) arrays.push(state.messages)
    }
    return arrays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedMessageFingerprint, initialProcessId])

  // The currently streaming message — changes on every delta but we only
  // map ONE message, not all of them. Returns null when idle.
  const currentStreamMessage = useAgentStreamStore((store) => {
    const conv = store.conversations.get(initialProcessId)
    const pids = conv?.processIds ?? [initialProcessId]
    // Most recent process with a currentMessage wins
    for (let i = pids.length - 1; i >= 0; i--) {
      const state = store.terminals.get(pids[i]!)
      if (state?.currentMessage) return state.currentMessage
    }
    return null
  })

  // Compute anyActive directly from the store to avoid stale closure issues.
  const anyActive = useAgentStreamStore((store) => {
    const conv = store.conversations.get(initialProcessId)
    const pids = conv?.processIds ?? [initialProcessId]

    for (const pid of pids) {
      const state = store.terminals.get(pid)
      if (!state) continue

      // Primary signals: actively streaming or waiting for response
      if (state.isActive || state.isWaitingForResponse) return true

      // Safety net: process still running and last message indicated tool execution.
      if (!state.processExited) {
        const lastMsg = state.messages[state.messages.length - 1]
        if (lastMsg?.stopReason === 'tool_use') return true
      }
    }
    return false
  })

  // Get error state from ONLY the most recent process in the conversation.
  const processError = useAgentStreamStore((store) => {
    const conv = store.conversations.get(initialProcessId)
    const pids = conv?.processIds ?? [initialProcessId]
    const latestPid = pids[pids.length - 1]!
    const state = store.terminals.get(latestPid)
    return state?.error ?? null
  })

  // Clear isProcessing when agent starts responding (anyActive becomes true)
  useEffect(() => {
    if (anyActive && isProcessing) {
      setIsProcessing(false)
    }
  }, [anyActive, isProcessing])

  // Clear isProcessing when an error is detected (process died before responding)
  useEffect(() => {
    if (processError && isProcessing) {
      setIsProcessing(false)
    }
  }, [processError, isProcessing])

  // Safety net: clear isProcessing after timeout to prevent permanent hangs
  useEffect(() => {
    if (!isProcessing) return
    const timeout = setTimeout(() => {
      console.warn('[AgentWorkspace] isProcessing timeout - clearing stale processing state')
      setIsProcessing(false)
      useToastStore.getState().addToast(
        'Agent took too long to respond. You can try sending your message again.',
        'warning',
        10000
      )
    }, 30_000)
    return () => clearTimeout(timeout)
  }, [isProcessing])

  // =====================================================================
  // Conversation assembly — split into stable + streaming parts
  // =====================================================================

  // Map completed messages — only re-runs when completedMessageArrays changes
  // (i.e. a new message finishes), NOT on every delta.
  const mappedCompletedMessages = useMemo(() => {
    const assistantMessages: UIAgentMessage[] = []
    for (const msgs of completedMessageArrays) {
      for (const msg of msgs) {
        assistantMessages.push(mapMessage(msg, agentType))
      }
    }
    // Deduplicate by message ID (same message can appear across multiple process states)
    const seenIds = new Set<string>()
    return assistantMessages.filter((msg) => {
      if (seenIds.has(msg.id)) return false
      seenIds.add(msg.id)
      return true
    })
  }, [completedMessageArrays, agentType])

  // Map the streaming message — re-runs on every delta but only maps ONE message
  const mappedCurrentMessage = useMemo(() => {
    if (!currentStreamMessage) return null
    return mapMessage(currentStreamMessage, agentType)
  }, [currentStreamMessage, agentType])

  // Assemble final conversation object
  const conversation = useMemo(() => {
    // Merge user messages with completed assistant messages, sorted by timestamp
    const allMessages = [...userMessages, ...mappedCompletedMessages].sort(
      (a, b) => a.timestamp - b.timestamp
    )

    let status: AgentConversation['status'] = 'idle'
    if (isProcessing || anyActive) {
      status = 'streaming'
    } else if (processError) {
      status = 'error'
    } else if (allMessages.length > 0) {
      status = 'completed'
    }

    return {
      terminalId: initialProcessId,
      agentType,
      messages: allMessages,
      currentMessage: mappedCurrentMessage,
      status,
    }
  }, [initialProcessId, agentType, mappedCompletedMessages, mappedCurrentMessage, userMessages, isProcessing, anyActive, processError])

  // Derive the latest model name from the most recent assistant message.
  // Uses a store selector that returns a stable string (model doesn't
  // change mid-session), so this won't trigger re-renders during deltas.
  const latestModel = useAgentStreamStore((store) => {
    const conv = store.conversations.get(initialProcessId)
    const pids = conv?.processIds ?? [initialProcessId]
    for (let i = pids.length - 1; i >= 0; i--) {
      const state = store.terminals.get(pids[i]!)
      if (!state) continue
      if (state.currentMessage?.model) return state.currentMessage.model
      for (let j = state.messages.length - 1; j >= 0; j--) {
        if (state.messages[j]?.model) return state.messages[j]!.model
      }
    }
    return null
  })

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

  // Safety net: if the agent is idle with queued messages, the transition-based
  // dequeue above may have missed the edge (e.g. quick process exit, race condition).
  // Poll on a short delay to catch stuck queues.
  useEffect(() => {
    if (anyActive || isProcessing || queueCount === 0) return
    const timeout = setTimeout(() => {
      const store = useAgentStreamStore.getState()
      const nextMessage = store.dequeueMessage(initialProcessId)
      if (nextMessage) {
        console.log('[AgentWorkspace] Safety net: dequeuing stuck message')
        handleSend(nextMessage)
      }
    }, 500)
    return () => clearTimeout(timeout)
  }, [anyActive, isProcessing, queueCount, initialProcessId, handleSend])

  // Force-send all queued messages: stop the agent, then send each queued message
  const handleForceQueue = useCallback(async () => {
    if (!window.electron?.agent) return
    // Stop all active processes first
    for (const pid of activeProcessIds) {
      await window.electron.agent.kill(pid)
      useAgentStreamStore.getState().resetTerminalActivity(pid)
    }
    // Dequeue the next message and send it (remaining will chain via auto-dequeue)
    const store = useAgentStreamStore.getState()
    const nextMessage = store.dequeueMessage(initialProcessId)
    if (nextMessage) {
      await new Promise((r) => setTimeout(r, 100))
      handleSend(nextMessage)
    }
  }, [activeProcessIds, initialProcessId, handleSend])

  return (
    <BashRulesProvider projectPath={cwd}>
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
      </div>

      {/* Thinking indicator — positioned on the outer relative wrapper so it
          bleeds behind the input bar, not clipped by the scroll container */}
      <ThinkingIndicator visible={showThinkingIndicator} />

      {/* Debug Events Sheet */}
      <DebugEventSheet
        open={debugSheetOpen}
        onOpenChange={setDebugSheetOpen}
        processIds={activeProcessIds}
      />

      {/* Error banner - shown when agent process died unexpectedly */}
      {processError && (
        <div className="px-4 py-2">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <IconAlertTriangle className="size-4 shrink-0" />
              <span className="flex-1">{processError}</span>
              <button
                onClick={() => {
                  const store = useAgentStreamStore.getState()
                  const conv = store.conversations.get(initialProcessId)
                  const pids = conv?.processIds ?? [initialProcessId]
                  for (const pid of pids) {
                    store.clearTerminalError(pid)
                  }
                }}
                className="text-xs underline hover:no-underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Area - Floating at bottom */}
      <div className="px-4 pb-4 pt-2">
        <div className="mx-auto max-w-3xl">
          {/* Controls row - Edits toggle (left) + Model label (right) */}
          <div className="flex items-center justify-between px-1 pb-1.5">
            {/* Edits toggle - Claude only */}
            {agentType === 'claude' ? (
              <button
                onClick={handleToggleEdits}
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
            {/* Context usage + Response timer + Model label */}
            <div className="flex items-center gap-2">
              {contextUsage && (latestModel || configuredModel) && (
                <ContextUsageIndicator
                  model={(latestModel || configuredModel)!}
                  usage={contextUsage}
                  showTokens={true}
                />
              )}
              {turnTiming && (
                <ResponseTimer
                  startedAt={turnTiming.startedAt}
                  endedAt={turnTiming.endedAt}
                  isActive={isStreaming}
                />
              )}
              {modelDisplayName && (
                <span className="text-[11px] font-medium text-muted-foreground/70 px-2 py-1">
                  {modelDisplayName}
                </span>
              )}
            </div>
          </div>
          <AgentInputArea
            processId={initialProcessId}
            onSend={handleSend}
            onStop={handleStop}
            onForceSend={handleForceSend}
            onQueue={handleQueue}
            onForceQueue={handleForceQueue}
            isStreaming={isStreaming}
            placeholder={placeholder}
            autoFocus
            queueCount={queueCount}
          />
        </div>
      </div>
    </div>
    </BashRulesProvider>
  )
}
