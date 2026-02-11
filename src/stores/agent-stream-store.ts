import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'
import { useTerminalStore } from './terminal-store'
import { usePermissionStore } from './permission-store'
import { useNotificationStore } from './notification-store'
import { useToastStore } from './toast-store'
import { useProjectStore } from './project-store'
import type {
  AgentMessage,
  ContentBlock,
  TerminalAgentState,
  AgentStreamEvent,
  AgentMessageStartData,
  AgentTextDeltaData,
  AgentThinkingDeltaData,
  AgentToolStartData,
  AgentToolInputDeltaData,
  AgentToolEndData,
  AgentToolResultData,
  AgentMessageEndData,
  AgentSessionResultData,
  AgentErrorData,
  AgentSystemEventData,
  DebugEventEntry,
  TokenUsage,
} from '../types/stream-json'

/**
 * Persisted session data - stored by sessionId
 */
export interface PersistedSessionData {
  sessionId: string
  agentType: string
  messages: AgentMessage[]  // completed messages only
  userMessages: Array<{ id: string; content: string; timestamp: number; agentType: string }>
  lastActiveAt: number
  cwd: string
  /** Latest context window usage snapshot (input_tokens = full context, not accumulated) */
  latestContextUsage?: TokenUsage
  /** Total cost in USD for this session (from result events) */
  totalCostUsd?: number
}


/**
 * Per-conversation state that survives component unmount/remount (e.g. session switching).
 * Keyed by the initial process ID (the first processId assigned to a conversation).
 */
export interface ConversationState {
  processIds: string[]
  userMessages: Array<{ id: string; content: string; timestamp: number; agentType: string }>
}

interface AgentStreamStore {
  // State: Map of terminalId -> agent state (runtime)
  terminals: Map<string, TerminalAgentState>

  // Per-conversation state: initialProcessId -> ConversationState (runtime, survives session switching)
  conversations: Map<string, ConversationState>

  // Persisted sessions: Record of sessionId -> session data
  sessions: Record<string, PersistedSessionData>

  // Runtime mapping: terminalId -> sessionId
  terminalToSession: Map<string, string>

  // Runtime mapping: sessionId -> initialProcessId (first process wins)
  sessionToInitialProcess: Map<string, string>

  // Rehydration state - tracks whether async storage rehydration has completed
  hasRehydrated: boolean

  // Runtime-only: tracks sessions that already had title generation triggered
  titleGeneratedSessions: Set<string>

  // Runtime-only: tracks terminals that have already been notified (prevents duplicate notifications)
  notifiedTerminals: Set<string>

  // Runtime-only: queued messages per conversation (initialProcessId -> messages)
  // When the agent finishes, queued messages are sent automatically
  queuedMessages: Map<string, string[]>

  // Runtime: latest context window usage per session (sessionId -> TokenUsage)
  // Updated on every message_start (input_tokens = full context) and message_end (final output_tokens)
  latestContextUsage: Map<string, TokenUsage>

  // Runtime: accumulated session cost per session (sessionId -> cost in USD)
  sessionCosts: Map<string, number>

  // Runtime: turn timing per conversation (initialProcessId -> timestamps)
  // turnStartedAt is set when the user sends a message, turnEndedAt when agent finishes (end_turn)
  turnTimings: Map<string, { startedAt: number; endedAt?: number }>

  // Actions
  processEvent(terminalId: string, event: AgentStreamEvent): void
  getTerminalState(terminalId: string): TerminalAgentState | undefined
  isMessageComplete(terminalId: string): boolean
  clearTerminal(terminalId: string): void
  markWaitingForResponse(terminalId: string): void
  clearWaitingForQuestion(terminalId: string): void
  resetTerminalActivity(terminalId: string): void
  clearTerminalError(terminalId: string): void

  // Conversation state actions (survive component unmount/remount)
  addConversationProcessId(initialProcessId: string, newProcessId: string): void
  addConversationUserMessage(initialProcessId: string, message: { id: string; content: string; timestamp: number; agentType: string }): void
  getConversation(initialProcessId: string): ConversationState

  // Session management actions
  setTerminalSession(terminalId: string, sessionId: string): void
  getSessionId(terminalId: string): string | undefined
  restoreSessionToTerminal(terminalId: string, sessionId: string): void
  persistSession(terminalId: string, agentType?: string, cwd?: string): void
  deletePersistedSession: (sessionId: string) => void

  // Title generation tracking (runtime only)
  markTitleGenerated(sessionId: string): void
  hasTitleBeenGenerated(sessionId: string): boolean

  // Message queue management
  enqueueMessage(initialProcessId: string, message: string): void
  dequeueMessage(initialProcessId: string): string | undefined
  peekQueue(initialProcessId: string): string[]
  clearQueue(initialProcessId: string): void

  // Context usage
  getLatestContextUsage(sessionId: string): TokenUsage | undefined
  getSessionCost(sessionId: string): number | undefined

  // Turn timing
  getTurnTiming(initialProcessId: string): { startedAt: number; endedAt?: number } | undefined

  // Flush buffered delta events for a terminal (call when user switches to a session)
  flushBackgroundDeltas(terminalId: string): void

  // IPC subscription
  subscribeToEvents(): () => void // returns unsubscribe function (for PTY-based detector events)
  subscribeToAgentProcessEvents(): () => void // returns unsubscribe function (for child process agent events)
}

// Global listener setup - only set up once
let listenerSetup = false
let unsubscribe: (() => void) | null = null

/**
 * Background delta buffer.
 *
 * When multiple agent sessions are streaming simultaneously, delta events
 * (text-delta, thinking-delta, tool-input-delta) for non-active sessions
 * are buffered here instead of being applied to the store immediately.
 * This avoids cloning the terminals Map and triggering subscriber
 * re-evaluation for sessions the user can't even see.
 *
 * Structural events (message-start, message-end, tool-start, etc.) always
 * process immediately — they change status flags that the sidebar needs.
 * When a structural event arrives for a buffered terminal, its pending
 * deltas are flushed first so state stays consistent.
 *
 * The buffer is flushed for a terminal when:
 * 1. The user switches to that session (via flushBackgroundDeltas)
 * 2. A structural event arrives for that terminal
 * 3. The process exits
 */
const backgroundDeltaBuffer = new Map<string, AgentStreamEvent[]>()

/** Event types that are high-frequency deltas and safe to defer */
const DEFERRABLE_DELTA_TYPES = new Set([
  'agent-text-delta',
  'agent-thinking-delta',
  'agent-tool-input-delta',
])

/**
 * Helper to create a new terminal state with immutable updates
 */
function getOrCreateTerminalState(
  terminals: Map<string, TerminalAgentState>,
  terminalId: string
): TerminalAgentState {
  const existing = terminals.get(terminalId)
  if (existing) return existing
  return {
    currentMessage: null,
    messages: [],
    isActive: false,
    isWaitingForResponse: false,
    isWaitingForQuestion: false,
    processExited: false,
  }
}

/**
 * Detect early process death and return an error message if applicable.
 * "Early death" = process exited while we were still waiting for a response,
 * or process exited with non-zero code before producing any messages.
 *
 * Exit code 256 on Windows is a common non-fatal exit from `bash -c "cat | claude ..."`:
 * when Claude CLI exits, `cat` gets a broken pipe and bash reports 256 (0x100).
 * We only treat it as an error if the agent never produced any output.
 */
function detectEarlyDeathError(
  termState: TerminalAgentState,
  exitCode: number | null
): string | undefined {
  const wasWaiting = termState.isWaitingForResponse
  const hasMessages = termState.messages.length > 0 || termState.currentMessage !== null

  // Exit code 256 on Windows is typically a benign pipe/signal death of the
  // bash wrapper after Claude CLI finishes. If we already got messages, ignore it.
  if (exitCode === 256 && hasMessages) {
    return undefined
  }

  if (wasWaiting && exitCode !== null && exitCode !== 0) {
    return `Agent process exited with code ${exitCode} before responding. The session may be invalid — try sending again or start a new session.`
  }
  if (wasWaiting) {
    return 'Agent process exited unexpectedly before responding. Try sending your message again.'
  }
  if (exitCode !== null && exitCode !== 0 && !termState.currentMessage && termState.messages.length === 0) {
    return `Agent process exited with code ${exitCode}.`
  }
  return undefined
}

/**
 * Helper to update a specific content block immutably
 */
function updateBlock(
  blocks: ContentBlock[],
  blockIndex: number,
  updater: (block: ContentBlock) => ContentBlock
): ContentBlock[] {
  return blocks.map((block, idx) => (idx === blockIndex ? updater(block) : block))
}

/** Max debug events kept per terminal to avoid memory bloat */
const DEBUG_EVENT_CAP = 1000

/** Delta event types that fire very frequently during streaming */
const DELTA_EVENT_TYPES = new Set(['agent-text-delta', 'agent-thinking-delta', 'agent-tool-input-delta'])

/** Monotonic counter for debug event ordering */
let debugEventCounter = 0

/**
 * Create a short summary string from event data for the debug panel.
 * Intentionally terse — just the key fields that help diagnose loading-state bugs.
 */
function summarizeEvent(type: string, data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  switch (type) {
    case 'agent-message-start':
      return `msgId=${d.messageId} model=${d.model}`
    case 'agent-message-end':
      return `stopReason=${d.stopReason} usage={in:${(d.usage as Record<string, unknown>)?.inputTokens ?? '?'},out:${(d.usage as Record<string, unknown>)?.outputTokens ?? '?'}}`
    case 'agent-tool-start':
      return `tool=${d.name} id=${d.toolId} blk=${d.blockIndex}`
    case 'agent-block-end':
    case 'agent-tool-end':
      return `blockIndex=${d.blockIndex}`
    case 'agent-tool-result':
      return `toolId=${d.toolId} isError=${d.isError} len=${(d.result as string)?.length ?? 0}`
    case 'agent-error':
      return `${d.errorType}: ${d.message}`
    case 'agent-process-exit':
      return `exitCode=${d.exitCode}`
    case 'agent-session-init':
      return `sessionId=${d.sessionId}`
    case 'agent-session-result':
      return `subtype=${d.subtype} cost=$${d.totalCostUsd ?? '?'} duration=${d.durationMs ?? '?'}ms`
    case 'agent-system-event':
      return `subtype=${d.subtype}`
    case 'agent-text-delta':
      return `blk=${d.blockIndex} +${(d.text as string)?.length ?? 0}ch`
    case 'agent-thinking-delta':
      return `blk=${d.blockIndex} +${(d.text as string)?.length ?? 0}ch`
    case 'agent-tool-input-delta':
      return `blk=${d.blockIndex} +${(d.partialJson as string)?.length ?? 0}ch`
    default:
      return JSON.stringify(d).substring(0, 120)
  }
}

/**
 * Append a debug event entry to the terminal state's debug log.
 * Returns a new array (immutable). Caps at DEBUG_EVENT_CAP entries.
 */
function appendDebugEvent(
  existing: DebugEventEntry[] | undefined,
  type: string,
  data: unknown,
  isActiveAfter: boolean,
  processExitedAfter: boolean,
  terminalId?: string,
  termState?: TerminalAgentState,
): DebugEventEntry[] {
  // For delta events, store a lightweight data snapshot (no full text/json)
  const isDelta = DELTA_EVENT_TYPES.has(type)
  let rawData: unknown
  if (isDelta) {
    // Keep structure info but skip the actual content to avoid memory bloat
    const d = data as Record<string, unknown>
    rawData = { blockIndex: d.blockIndex, chunkLength: ((d.text ?? d.partialJson ?? d.thinking) as string)?.length ?? 0 }
  } else {
    rawData = data
  }

  const entry: DebugEventEntry = {
    index: debugEventCounter++,
    type,
    timestamp: Date.now(),
    summary: summarizeEvent(type, data),
    isActiveAfter,
    processExitedAfter,
    terminalId,
    rawData,
    stateSnapshot: termState ? {
      isWaitingForResponse: termState.isWaitingForResponse,
      isWaitingForQuestion: termState.isWaitingForQuestion,
      currentMessageId: termState.currentMessage?.id ?? null,
      messageCount: termState.messages.length,
      currentBlockCount: termState.currentMessage?.blocks.length ?? 0,
    } : undefined,
  }
  const prev = existing ?? []
  const next = [...prev, entry]
  return next.length > DEBUG_EVENT_CAP ? next.slice(-DEBUG_EVENT_CAP) : next
}

/**
 * Pure function: apply a single agent event to a terminal state, returning the new state.
 * Extracted from processEvent so it can be called in tight loops (batch processing)
 * without triggering Zustand set() per event.
 */
function applyAgentEvent(
  terminalState: TerminalAgentState,
  event: AgentStreamEvent,
  terminalId?: string,
): TerminalAgentState {
  let newState: TerminalAgentState

  switch (event.type) {
    case 'agent-message-start': {
      const data = event.data as AgentMessageStartData

      // Dedup: skip if this message ID is already completed OR currently streaming.
      // The CLI emits both streaming events (message_start → content_block_* → message_stop)
      // and a complete print-mode 'assistant' event for the same message. Without checking
      // currentMessage, the duplicate message-start overwrites the in-progress streaming
      // message with an empty one, destroying all accumulated content.
      if (data.messageId && (
        terminalState.messages.some((m) => m.id === data.messageId) ||
        terminalState.currentMessage?.id === data.messageId
      )) {
        newState = terminalState
        break
      }

      const newMessage: AgentMessage = {
        id: data.messageId,
        model: data.model,
        blocks: [],
        status: 'streaming',
        startedAt: Date.now(),
      }
      newState = {
        ...terminalState,
        currentMessage: newMessage,
        isActive: true,
        isWaitingForResponse: false,
        error: undefined,
      }
      break
    }

    case 'agent-text-delta': {
      const data = event.data as AgentTextDeltaData
      if (!terminalState.currentMessage) {
        newState = terminalState
        break
      }

      const { blocks } = terminalState.currentMessage
      const blockIndex = data.blockIndex

      let newBlocks: ContentBlock[]
      if (blockIndex >= blocks.length) {
        newBlocks = [
          ...blocks,
          { type: 'text', content: data.text },
        ]
      } else {
        newBlocks = updateBlock(blocks, blockIndex, (block) => ({
          ...block,
          content: block.content + data.text,
        }))
      }

      newState = {
        ...terminalState,
        currentMessage: {
          ...terminalState.currentMessage,
          blocks: newBlocks,
        },
      }
      break
    }

    case 'agent-thinking-delta': {
      const data = event.data as AgentThinkingDeltaData
      if (!terminalState.currentMessage) {
        newState = terminalState
        break
      }

      const { blocks } = terminalState.currentMessage
      const blockIndex = data.blockIndex

      let newBlocks: ContentBlock[]
      if (blockIndex >= blocks.length) {
        newBlocks = [
          ...blocks,
          { type: 'thinking', content: data.text },
        ]
      } else {
        newBlocks = updateBlock(blocks, blockIndex, (block) => ({
          ...block,
          content: block.content + data.text,
        }))
      }

      newState = {
        ...terminalState,
        currentMessage: {
          ...terminalState.currentMessage,
          blocks: newBlocks,
        },
      }
      break
    }

    case 'agent-tool-start': {
      const data = event.data as AgentToolStartData
      if (!terminalState.currentMessage) {
        newState = terminalState
        break
      }

      const existingBlock = terminalState.currentMessage.blocks.find(
        (b) => b.type === 'tool_use' && b.toolId === data.toolId
      )
      if (existingBlock) {
        newState = terminalState
        break
      }

      const newBlock: ContentBlock = {
        type: 'tool_use',
        content: '',
        toolId: data.toolId,
        toolName: data.name,
        toolInput: '',
      }

      newState = {
        ...terminalState,
        currentMessage: {
          ...terminalState.currentMessage,
          blocks: [...terminalState.currentMessage.blocks, newBlock],
        },
        ...(data.name === 'AskUserQuestion' ? { isWaitingForQuestion: true } : {}),
      }
      break
    }

    case 'agent-tool-input-delta': {
      const data = event.data as AgentToolInputDeltaData
      if (!terminalState.currentMessage) {
        newState = terminalState
        break
      }

      const { blocks } = terminalState.currentMessage
      const blockIndex = data.blockIndex

      if (blockIndex >= blocks.length) {
        newState = terminalState
        break
      }

      newState = {
        ...terminalState,
        currentMessage: {
          ...terminalState.currentMessage,
          blocks: updateBlock(blocks, blockIndex, (block) => ({
            ...block,
            toolInput: (block.toolInput || '') + data.partialJson,
          })),
        },
      }
      break
    }

    case 'agent-tool-end':
    case 'agent-block-end': {
      const data = event.data as AgentToolEndData
      if (!terminalState.currentMessage) {
        newState = terminalState
        break
      }

      const { blocks } = terminalState.currentMessage
      const blockIndex = data.blockIndex

      if (blockIndex >= blocks.length) {
        newState = terminalState
        break
      }

      // Debug: log ExitPlanMode input when block completes
      const completingBlock = blocks[blockIndex]
      if (completingBlock?.toolName === 'ExitPlanMode') {
        console.log('[PlanDebug] ExitPlanMode block completed, toolInput:', completingBlock.toolInput?.substring(0, 500))
      }

      newState = {
        ...terminalState,
        currentMessage: {
          ...terminalState.currentMessage,
          blocks: updateBlock(blocks, blockIndex, (block) => ({
            ...block,
            isComplete: true,
          })),
        },
      }
      break
    }

    case 'agent-tool-result': {
      const data = event.data as AgentToolResultData

      // Debug: log tool results for plan-related tools
      // Find the matching tool_use to check if it's ExitPlanMode
      const matchingToolBlock = [
        ...(terminalState.currentMessage?.blocks ?? []),
        ...terminalState.messages.flatMap(m => m.blocks),
      ].find(b => b.type === 'tool_use' && b.toolId === data.toolId)
      if (matchingToolBlock?.toolName === 'ExitPlanMode') {
        console.log('[PlanDebug] ExitPlanMode tool result:', {
          isError: data.isError,
          resultLength: data.result?.length,
          resultPreview: data.result?.substring(0, 500),
        })
      }

      // Find the tool_use block with matching toolId across completed messages and currentMessage.
      // Tool results arrive in user messages AFTER the assistant message completes,
      // so the tool_use block will typically be in the completed messages array.
      newState = terminalState

      // Check completed messages (most recent first — tool result matches the latest use)
      for (let mi = terminalState.messages.length - 1; mi >= 0; mi--) {
        const msg = terminalState.messages[mi]!
        const blockIdx = msg.blocks.findIndex(
          (b) => b.type === 'tool_use' && b.toolId === data.toolId
        )
        if (blockIdx !== -1) {
          const newMessages = [...terminalState.messages]
          const newMsg = { ...msg, blocks: [...msg.blocks] }
          newMsg.blocks[blockIdx] = {
            ...newMsg.blocks[blockIdx]!,
            toolResultIsError: data.isError,
            toolResult: data.result,
          }
          newMessages[mi] = newMsg
          newState = { ...terminalState, messages: newMessages }
          break
        }
      }

      // Also check currentMessage if not found in completed messages
      if (newState === terminalState && terminalState.currentMessage) {
        const blockIdx = terminalState.currentMessage.blocks.findIndex(
          (b) => b.type === 'tool_use' && b.toolId === data.toolId
        )
        if (blockIdx !== -1) {
          const newBlocks = [...terminalState.currentMessage.blocks]
          newBlocks[blockIdx] = {
            ...newBlocks[blockIdx]!,
            toolResultIsError: data.isError,
            toolResult: data.result,
          }
          newState = {
            ...terminalState,
            currentMessage: { ...terminalState.currentMessage, blocks: newBlocks },
          }
        }
      }

      // Clear isWaitingForQuestion if an AskUserQuestion tool result arrives with an error.
      // This happens when the permission hook denies the tool — the question card won't be
      // interactive, so the flag would stay stuck forever since handleAnswerQuestion never fires.
      if (data.isError && newState.isWaitingForQuestion && matchingToolBlock?.toolName === 'AskUserQuestion') {
        newState = { ...newState, isWaitingForQuestion: false }
      }
      break
    }

    case 'agent-message-end': {
      const data = event.data as AgentMessageEndData

      const stillActive = data.stopReason === 'tool_use'
        ? true
        : data.stopReason === 'end_turn'
          ? false
          : terminalState.isActive

      if (!terminalState.currentMessage) {
        newState = {
          ...terminalState,
          isActive: stillActive,
        }
        break
      }

      const completedBlocks = terminalState.currentMessage.blocks.map((block) => ({
        ...block,
        isComplete: true,
      }))

      const completedMessage: AgentMessage = {
        ...terminalState.currentMessage,
        blocks: completedBlocks,
        status: 'completed',
        stopReason: data.stopReason,
        usage: data.usage,
        completedAt: Date.now(),
      }

      // If the agent ends the turn (end_turn), clear isWaitingForQuestion.
      // This handles the case where AskUserQuestion was attempted but failed/errored,
      // and the agent gave up and ended its turn without successfully asking.
      const clearQuestion = !stillActive && terminalState.isWaitingForQuestion
        ? { isWaitingForQuestion: false as const }
        : {}

      newState = {
        ...terminalState,
        currentMessage: null,
        messages: [...terminalState.messages, completedMessage],
        isActive: stillActive,
        ...clearQuestion,
      }
      break
    }

    case 'agent-system-event': {
      const data = event.data as AgentSystemEventData
      // Create a synthetic system message to display in the conversation
      const systemMessage: AgentMessage = {
        id: `system-${Date.now()}-${data.subtype}`,
        model: '',
        blocks: [{
          type: 'system',
          content: data.subtype,
        }],
        status: 'completed',
        startedAt: Date.now(),
        completedAt: Date.now(),
      }
      newState = {
        ...terminalState,
        messages: [...terminalState.messages, systemMessage],
      }
      break
    }

    case 'agent-error': {
      const data = event.data as AgentErrorData
      if (terminalState.currentMessage) {
        const errorMessage: AgentMessage = {
          ...terminalState.currentMessage,
          status: 'error',
          completedAt: Date.now(),
        }
        newState = {
          ...terminalState,
          currentMessage: null,
          messages: [...terminalState.messages, errorMessage],
          isActive: false,
          error: `${data.errorType}: ${data.message}`,
        }
      } else {
        newState = {
          ...terminalState,
          isActive: false,
          error: `${data.errorType}: ${data.message}`,
        }
      }
      break
    }

    default:
      newState = terminalState
  }

  // Always track debug events (including deltas) — delta entries are lightweight
  newState = {
    ...newState,
    debugEvents: appendDebugEvent(
      newState.debugEvents,
      event.type,
      event.data,
      newState.isActive,
      newState.processExited,
      terminalId,
      newState,
    ),
  }

  return newState
}

// Promise resolver for waiting on rehydration
let rehydrationResolver: (() => void) | null = null
const rehydrationPromise = new Promise<void>((resolve) => {
  rehydrationResolver = resolve
})

/**
 * Wait for the store to complete async rehydration from storage.
 * Returns immediately if already rehydrated.
 */
export function waitForRehydration(): Promise<void> {
  if (useAgentStreamStore.getState().hasRehydrated) {
    return Promise.resolve()
  }
  return rehydrationPromise
}

/**
 * Emit notifications when agents finish or need attention, unless the user
 * is currently viewing that exact session.
 * Uses getState() pattern to avoid circular dependencies.
 */
function emitAgentNotification(terminalId: string, type: 'done' | 'needs-attention') {
  // Resolve terminalId to the original session's terminal ID.
  // Multi-turn conversations spawn new PTY processes with new IDs,
  // but only the initial process ID exists in terminal-store.sessions.
  const agentStore = useAgentStreamStore.getState()
  const sessionId = agentStore.terminalToSession.get(terminalId)
  const originalTerminalId = sessionId
    ? agentStore.sessionToInitialProcess.get(sessionId) ?? terminalId
    : terminalId

  const session = useTerminalStore.getState().sessions.find((s) => s.id === originalTerminalId)
  if (!session?.projectId) return

  // Only skip notification if the user is actively viewing this specific session
  const activeProjectId = useProjectStore.getState().activeProjectId
  const activeAgentSessionId = useTerminalStore.getState().activeAgentSessionId
  if (session.projectId === activeProjectId && originalTerminalId === activeAgentSessionId) return

  const project = useProjectStore.getState().projects.find((p) => p.id === session.projectId)
  if (!project) return

  const sessionTitle = session.title ?? 'Agent session'

  useNotificationStore.getState().addNotification({
    projectId: project.id,
    projectName: project.name,
    terminalId: originalTerminalId,
    sessionTitle,
    type,
    message: type === 'done'
      ? `${sessionTitle} finished`
      : `${sessionTitle} needs attention`,
  })

  useToastStore.getState().addToast(
    `[${project.name}] ${sessionTitle} ${type === 'done' ? 'finished' : 'needs attention'}`,
    type === 'done' ? 'success' : 'warning',
    8000,
    () => {
      useProjectStore.getState().setActiveProject(project.id)
      useTerminalStore.getState().setActiveAgentSession(originalTerminalId)
      // Dismiss only notifications for this specific session
      useNotificationStore.getState().dismissByTerminalId(originalTerminalId)
    }
  )
}

export const useAgentStreamStore = create<AgentStreamStore>()(
  persist(
    (set, get) => ({
      terminals: new Map(),
      conversations: new Map(),
      sessions: {},
      terminalToSession: new Map(),
      sessionToInitialProcess: new Map(),
      hasRehydrated: false,
      titleGeneratedSessions: new Set(),
      notifiedTerminals: new Set(),
      queuedMessages: new Map(),
      latestContextUsage: new Map(),
      sessionCosts: new Map(),
      turnTimings: new Map(),

      processEvent: (terminalId: string, event: AgentStreamEvent) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          const terminalState = getOrCreateTerminalState(terminals, terminalId)
          const newState = applyAgentEvent(terminalState, event, terminalId)
          terminals.set(terminalId, newState)

          // Update latestContextUsage on message start/end
          // input_tokens from the API = full context window, so latest value is the true usage
          if (event.type === 'agent-message-start' || event.type === 'agent-message-end') {
            const eventData = event.data as { usage?: TokenUsage }
            if (eventData.usage) {
              const sessionId = state.terminalToSession.get(terminalId)
              if (sessionId) {
                const latestContextUsage = new Map(state.latestContextUsage)
                latestContextUsage.set(sessionId, eventData.usage)
                return { terminals, latestContextUsage }
              }
            }
          }

          // Handle session result events (cost tracking)
          if (event.type === 'agent-session-result') {
            const resultData = event.data as AgentSessionResultData
            if (resultData.totalCostUsd != null) {
              const sessionId = state.terminalToSession.get(terminalId)
              if (sessionId) {
                const sessionCosts = new Map(state.sessionCosts)
                const existing = sessionCosts.get(sessionId) ?? 0
                sessionCosts.set(sessionId, existing + resultData.totalCostUsd)
                return { terminals, sessionCosts }
              }
            }
          }

          return { terminals }
        })

        // Persist session to DB after message completes so it survives app restart
        if (event.type === 'agent-message-end') {
          get().persistSession(terminalId)

          const endData = event.data as { stopReason?: string }
          const termStateAfter = get().terminals.get(terminalId)

          if (endData.stopReason === 'end_turn') {
            // Collect patches and apply in a single set()
            const sessionId = get().terminalToSession.get(terminalId)
            const ipid = sessionId ? get().sessionToInitialProcess.get(sessionId) : undefined

            if (termStateAfter?.isWaitingForQuestion) {
              emitAgentNotification(terminalId, 'needs-attention')
            } else {
              emitAgentNotification(terminalId, 'done')
            }

            if (ipid || (!termStateAfter?.isWaitingForQuestion)) {
              set((state) => {
                const patch: Partial<typeof state> = {}
                if (ipid) {
                  const timing = state.turnTimings.get(ipid)
                  if (timing) {
                    const turnTimings = new Map(state.turnTimings)
                    turnTimings.set(ipid, { ...timing, endedAt: Date.now() })
                    patch.turnTimings = turnTimings
                  }
                }
                if (!termStateAfter?.isWaitingForQuestion) {
                  const notifiedTerminals = new Set(state.notifiedTerminals)
                  notifiedTerminals.add(terminalId)
                  patch.notifiedTerminals = notifiedTerminals
                }
                return patch
              })
            }
          }
        }
      },

      getTerminalState: (terminalId: string) => {
        return get().terminals.get(terminalId)
      },

      isMessageComplete: (terminalId: string) => {
        const state = get().terminals.get(terminalId)
        if (!state) return true // No state means no active message
        return state.currentMessage === null
      },

      clearTerminal: (terminalId: string) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          terminals.delete(terminalId)
          // Also clear the terminal-to-session mapping
          const terminalToSession = new Map(state.terminalToSession)
          terminalToSession.delete(terminalId)
          return { terminals, terminalToSession }
        })
      },

      markWaitingForResponse: (terminalId: string) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          const terminalState = getOrCreateTerminalState(terminals, terminalId)
          terminals.set(terminalId, {
            ...terminalState,
            isWaitingForResponse: true,
          })
          return { terminals }
        })
      },

      clearWaitingForQuestion: (terminalId: string) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          const terminalState = terminals.get(terminalId)
          if (!terminalState) return state
          terminals.set(terminalId, {
            ...terminalState,
            isWaitingForQuestion: false,
          })
          return { terminals }
        })
      },

      resetTerminalActivity: (terminalId: string) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          const terminalState = terminals.get(terminalId)
          if (!terminalState) return state
          // If there's a current streaming message, finalize it into messages
          const messages = terminalState.currentMessage
            ? [...terminalState.messages, { ...terminalState.currentMessage, status: 'completed' as const }]
            : terminalState.messages
          terminals.set(terminalId, {
            ...terminalState,
            currentMessage: null,
            messages,
            isActive: false,
            isWaitingForResponse: false,
            processExited: true,
          })
          return { terminals }
        })
        // Persist so messages survive app restart after stop
        get().persistSession(terminalId)
      },

      clearTerminalError: (terminalId: string) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          const terminalState = terminals.get(terminalId)
          if (!terminalState || !terminalState.error) return state
          terminals.set(terminalId, {
            ...terminalState,
            error: undefined,
          })
          return { terminals }
        })
      },

      // Conversation state actions (survive component unmount/remount)
      addConversationProcessId: (initialProcessId: string, newProcessId: string) => {
        set((state) => {
          const conversations = new Map(state.conversations)
          const existing = conversations.get(initialProcessId) ?? { processIds: [initialProcessId], userMessages: [] }
          if (!existing.processIds.includes(newProcessId)) {
            conversations.set(initialProcessId, {
              ...existing,
              processIds: [...existing.processIds, newProcessId],
            })
          }
          return { conversations }
        })
      },

      addConversationUserMessage: (initialProcessId: string, message: { id: string; content: string; timestamp: number; agentType: string }) => {
        set((state) => {
          const conversations = new Map(state.conversations)
          const existing = conversations.get(initialProcessId) ?? { processIds: [initialProcessId], userMessages: [] }
          conversations.set(initialProcessId, {
            ...existing,
            userMessages: [...existing.userMessages, message],
          })
          // Start the turn timer
          const turnTimings = new Map(state.turnTimings)
          turnTimings.set(initialProcessId, { startedAt: message.timestamp })
          return { conversations, turnTimings }
        })
      },

      getConversation: (initialProcessId: string) => {
        return get().conversations.get(initialProcessId) ?? { processIds: [initialProcessId], userMessages: [] }
      },

      getTurnTiming: (initialProcessId: string) => {
        return get().turnTimings.get(initialProcessId)
      },

      flushBackgroundDeltas: (terminalId: string) => {
        // Also flush for all process IDs in this conversation
        const conv = get().conversations.get(terminalId)
        const pids = conv?.processIds ?? [terminalId]
        const allEvents: Array<{ terminalId: string; event: AgentStreamEvent }> = []
        for (const pid of pids) {
          const buffered = backgroundDeltaBuffer.get(pid)
          if (buffered && buffered.length > 0) {
            for (const event of buffered) {
              allEvents.push({ terminalId: pid, event })
            }
            backgroundDeltaBuffer.delete(pid)
          }
        }
        if (allEvents.length === 0) return

        set((state) => {
          const terminals = new Map(state.terminals)
          for (const { terminalId: tid, event } of allEvents) {
            const terminalState = getOrCreateTerminalState(terminals, tid)
            terminals.set(tid, applyAgentEvent(terminalState, event, tid))
          }
          return { terminals }
        })
      },

      // Session management actions
      setTerminalSession: (terminalId: string, sessionId: string) => {
        set((state) => {
          const terminalToSession = new Map(state.terminalToSession)
          terminalToSession.set(terminalId, sessionId)

          // Track which initialProcessId is associated with this session (first process wins)
          const sessionToInitialProcess = new Map(state.sessionToInitialProcess)
          if (!sessionToInitialProcess.has(sessionId)) {
            sessionToInitialProcess.set(sessionId, terminalId)
          }

          return { terminalToSession, sessionToInitialProcess }
        })
      },

      getSessionId: (terminalId: string) => {
        return get().terminalToSession.get(terminalId)
      },

      restoreSessionToTerminal: (terminalId: string, sessionId: string) => {
        const state = get()
        const sessionData = state.sessions[sessionId]
        if (!sessionData) {
          console.warn('[AgentStreamStore] No session data found for sessionId:', sessionId)
          return
        }

        // Backward compat: default userMessages for older sessions
        const userMessages = sessionData.userMessages ?? []

        set((state) => {
          // Link terminal to session
          const terminalToSession = new Map(state.terminalToSession)
          terminalToSession.set(terminalId, sessionId)

          // Track session -> initialProcess mapping
          const sessionToInitialProcess = new Map(state.sessionToInitialProcess)
          if (!sessionToInitialProcess.has(sessionId)) {
            sessionToInitialProcess.set(sessionId, terminalId)
          }

          // Hydrate runtime state from persisted data
          const terminals = new Map(state.terminals)
          terminals.set(terminalId, {
            currentMessage: null,
            messages: sessionData.messages,
            isActive: false,
            isWaitingForResponse: false,
            isWaitingForQuestion: false,
            processExited: true,
          })

          // Restore user messages into conversations Map
          const conversations = new Map(state.conversations)
          if (userMessages.length > 0) {
            const initialProcessId = sessionToInitialProcess.get(sessionId) ?? terminalId
            const existing = conversations.get(initialProcessId)
            conversations.set(initialProcessId, {
              processIds: existing?.processIds ?? [initialProcessId],
              userMessages: [...(existing?.userMessages ?? []), ...userMessages],
            })
          }

          // Hydrate latestContextUsage from persisted data
          const latestContextUsage = new Map(state.latestContextUsage)
          if (sessionData.latestContextUsage) {
            latestContextUsage.set(sessionId, sessionData.latestContextUsage)
          }

          // Hydrate session costs from persisted data
          const sessionCosts = new Map(state.sessionCosts)
          if (sessionData.totalCostUsd != null) {
            sessionCosts.set(sessionId, sessionData.totalCostUsd)
          }

          return { terminals, terminalToSession, sessionToInitialProcess, conversations, latestContextUsage, sessionCosts }
        })

        console.log('[AgentStreamStore] Restored session to terminal:', {
          terminalId,
          sessionId,
          messageCount: sessionData.messages.length,
          userMessageCount: userMessages.length,
        })
      },

      persistSession: (terminalId: string, agentType?: string, cwd?: string) => {
        const state = get()
        const sessionId = state.terminalToSession.get(terminalId)
        if (!sessionId) {
          console.warn('[AgentStreamStore] No sessionId for terminal, cannot persist:', terminalId)
          return
        }

        // Look up all process IDs for this conversation
        const initialProcessId = state.sessionToInitialProcess.get(sessionId)
        const conversation = initialProcessId ? state.conversations.get(initialProcessId) : undefined
        const allProcessIds = conversation?.processIds ?? [terminalId]

        // Start with previously persisted messages as a fallback baseline.
        // This handles processes whose terminal state has already been cleared.
        const existingSession = state.sessions[sessionId]
        const messageMap = new Map<string, AgentMessage>()
        if (existingSession?.messages) {
          for (const msg of existingSession.messages) {
            messageMap.set(msg.id, msg)
          }
        }

        // Layer on runtime terminal messages from ALL processes in the conversation.
        // Runtime messages override persisted ones (they may have updated status).
        for (const pid of allProcessIds) {
          const termState = state.terminals.get(pid)
          if (!termState) continue
          for (const msg of termState.messages) {
            if (msg.status === 'completed') {
              messageMap.set(msg.id, msg)
            }
          }
        }

        // Sort by startedAt to maintain chronological order
        const aggregatedMessages = Array.from(messageMap.values()).sort(
          (a, b) => a.startedAt - b.startedAt
        )

        const userMessages = conversation?.userMessages ?? []

        const contextUsage = state.latestContextUsage.get(sessionId)
        const cost = state.sessionCosts.get(sessionId)

        const sessionData: PersistedSessionData = {
          sessionId,
          agentType: agentType || existingSession?.agentType || 'unknown',
          messages: aggregatedMessages,
          userMessages,
          lastActiveAt: Date.now(),
          cwd: cwd || existingSession?.cwd || '',
          latestContextUsage: contextUsage || existingSession?.latestContextUsage,
          totalCostUsd: cost ?? existingSession?.totalCostUsd,
        }

        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: sessionData,
          },
        }))

        console.log('[AgentStreamStore] Persisted session:', {
          sessionId,
          messageCount: aggregatedMessages.length,
          userMessageCount: userMessages.length,
          processCount: allProcessIds.length,
          agentType: sessionData.agentType,
        })
      },

      deletePersistedSession: (sessionId: string) => {
        set((state) => {
          const { [sessionId]: _, ...remaining } = state.sessions
          return { sessions: remaining }
        })
        console.log('[AgentStreamStore] Permanently deleted persisted session:', sessionId)
      },

      markTitleGenerated: (sessionId: string) => {
        set((state) => {
          const titleGeneratedSessions = new Set(state.titleGeneratedSessions)
          titleGeneratedSessions.add(sessionId)
          return { titleGeneratedSessions }
        })
      },

      hasTitleBeenGenerated: (sessionId: string) => {
        return get().titleGeneratedSessions.has(sessionId)
      },

      enqueueMessage: (initialProcessId: string, message: string) => {
        set((state) => {
          const queuedMessages = new Map(state.queuedMessages)
          const existing = queuedMessages.get(initialProcessId) ?? []
          queuedMessages.set(initialProcessId, [...existing, message])
          return { queuedMessages }
        })
      },

      dequeueMessage: (initialProcessId: string) => {
        const queue = get().queuedMessages.get(initialProcessId)
        if (!queue || queue.length === 0) return undefined
        const [first, ...rest] = queue
        set((state) => {
          const queuedMessages = new Map(state.queuedMessages)
          if (rest.length > 0) {
            queuedMessages.set(initialProcessId, rest)
          } else {
            queuedMessages.delete(initialProcessId)
          }
          return { queuedMessages }
        })
        return first
      },

      peekQueue: (initialProcessId: string) => {
        return get().queuedMessages.get(initialProcessId) ?? []
      },

      clearQueue: (initialProcessId: string) => {
        set((state) => {
          const queuedMessages = new Map(state.queuedMessages)
          queuedMessages.delete(initialProcessId)
          return { queuedMessages }
        })
      },

      getLatestContextUsage: (sessionId: string) => {
        return get().latestContextUsage.get(sessionId)
      },

      getSessionCost: (sessionId: string) => {
        return get().sessionCosts.get(sessionId)
      },

      subscribeToEvents: () => {
        if (listenerSetup) return () => {}
        listenerSetup = true

        // Prefer batched event channel (50ms batches from main process).
        // Falls back to individual events if batch channel isn't available.
        const hasBatch = !!window.electron?.detector?.onEventBatch
        const hasIndividual = !!window.electron?.detector?.onEvent

        if (hasBatch) {
          console.log('[AgentStreamStore] Subscribing to batched detector events')
          unsubscribe = window.electron!.detector.onEventBatch((events) => {
            // Determine which terminal IDs belong to the active (visible) session.
            // Delta events for other terminals are buffered instead of applied,
            // saving ~90% of set() overhead when many agents stream simultaneously.
            const activeAgentSessionId = useTerminalStore.getState().activeAgentSessionId
            const activeConv = activeAgentSessionId
              ? get().conversations.get(activeAgentSessionId)
              : null
            const activePids = new Set(activeConv?.processIds ?? (activeAgentSessionId ? [activeAgentSessionId] : []))

            // Collect agent events to process in a single set() call
            const agentEvents: Array<{ terminalId: string; event: AgentStreamEvent }> = []
            // Collect terminal IDs that need post-set() work (persist, notify)
            const messageEndTerminals: Array<{ terminalId: string; stopReason?: string }> = []
            const processExitTerminals: Array<{ terminalId: string; exitCode: number | null }> = []
            // Track which background terminals received a structural event
            // (their buffered deltas need flushing before the structural event)
            const terminalsToFlush = new Set<string>()

            for (const event of events) {
              // Handle session init
              if (event.type === 'agent-session-init' && event.data?.sessionId) {
                const sessionId = event.data.sessionId as string
                get().setTerminalSession(event.terminalId, sessionId)
                useTerminalStore.getState().updateConfigSessionId(event.terminalId, sessionId)
                continue
              }

              // Handle Codex approval requests
              if (event.type === 'codex-approval-request' && event.data) {
                const sessionId = get().terminalToSession.get(event.terminalId) ?? event.terminalId
                const data = event.data as {
                  jsonRpcId: number
                  method: string
                  toolName: string
                  toolInput: Record<string, unknown>
                }
                const permissionId = `codex:${event.terminalId}:${data.jsonRpcId}`
                usePermissionStore.getState().addRequest({
                  id: permissionId,
                  sessionId,
                  toolName: data.toolName,
                  toolInput: data.toolInput,
                  receivedAt: event.timestamp,
                })
                continue
              }

              // Handle process exit — collect for batch processing
              if (event.type === 'agent-process-exit') {
                // Flush any buffered deltas before processing the exit
                if (backgroundDeltaBuffer.has(event.terminalId)) {
                  terminalsToFlush.add(event.terminalId)
                }
                processExitTerminals.push({
                  terminalId: event.terminalId,
                  exitCode: (event.data as { exitCode?: number })?.exitCode ?? null,
                })
                continue
              }

              // Collect agent-* events for batch state update
              if (event.type.startsWith('agent-')) {
                const agentEvent = { type: event.type, data: event.data } as AgentStreamEvent

                // For background terminals, buffer delta events instead of
                // processing them. This is the main optimization: 10 agents
                // streaming means ~1000 deltas/sec, but only the active
                // session's ~100 deltas/sec hit the store.
                if (DEFERRABLE_DELTA_TYPES.has(event.type) && !activePids.has(event.terminalId)) {
                  let buffer = backgroundDeltaBuffer.get(event.terminalId)
                  if (!buffer) {
                    buffer = []
                    backgroundDeltaBuffer.set(event.terminalId, buffer)
                  }
                  buffer.push(agentEvent)
                  continue
                }

                // Structural event for a background terminal — flush its
                // buffered deltas first so the state is consistent
                if (backgroundDeltaBuffer.has(event.terminalId)) {
                  terminalsToFlush.add(event.terminalId)
                }

                agentEvents.push({ terminalId: event.terminalId, event: agentEvent })
                if (event.type === 'agent-message-end') {
                  messageEndTerminals.push({
                    terminalId: event.terminalId,
                    stopReason: (event.data as { stopReason?: string })?.stopReason,
                  })
                }
              }
            }

            // Flush buffered deltas for terminals that have structural events
            for (const tid of terminalsToFlush) {
              const buffered = backgroundDeltaBuffer.get(tid)
              if (buffered && buffered.length > 0) {
                for (const event of buffered) {
                  agentEvents.unshift({ terminalId: tid, event })
                }
                backgroundDeltaBuffer.delete(tid)
              }
            }

            // Process ALL agent events in a SINGLE set() call.
            // This is the critical optimization: instead of N set() calls (one per event),
            // we clone the terminals Map once, apply all mutations, then return.
            if (agentEvents.length > 0 || processExitTerminals.length > 0) {
              set((state) => {
                const terminals = new Map(state.terminals)
                let latestContextUsage: Map<string, TokenUsage> | undefined
                let sessionCosts: Map<string, number> | undefined

                // Apply agent events
                for (const { terminalId, event } of agentEvents) {
                  const terminalState = getOrCreateTerminalState(terminals, terminalId)
                  terminals.set(terminalId, applyAgentEvent(terminalState, event, terminalId))

                  // Track context usage from message start/end events
                  if (event.type === 'agent-message-start' || event.type === 'agent-message-end') {
                    const eventData = event.data as { usage?: TokenUsage }
                    if (eventData.usage) {
                      const sid = state.terminalToSession.get(terminalId)
                      if (sid) {
                        if (!latestContextUsage) latestContextUsage = new Map(state.latestContextUsage)
                        latestContextUsage.set(sid, eventData.usage)
                      }
                    }
                  }

                  // Track session costs from result events
                  if (event.type === 'agent-session-result') {
                    const resultData = event.data as AgentSessionResultData
                    if (resultData.totalCostUsd != null) {
                      const sid = state.terminalToSession.get(terminalId)
                      if (sid) {
                        if (!sessionCosts) sessionCosts = new Map(state.sessionCosts)
                        const existing = sessionCosts.get(sid) ?? 0
                        sessionCosts.set(sid, existing + resultData.totalCostUsd)
                      }
                    }
                  }
                }

                // Apply process exit events
                for (const { terminalId, exitCode } of processExitTerminals) {
                  const termState = terminals.get(terminalId)
                  if (!termState) continue

                  const errorMsg = detectEarlyDeathError(termState, exitCode)

                  const baseState = termState.currentMessage
                    ? {
                        ...termState,
                        messages: [...termState.messages, { ...termState.currentMessage, status: 'completed' as const, completedAt: Date.now() }],
                        currentMessage: null,
                        isActive: false,
                        isWaitingForResponse: false,
                        isWaitingForQuestion: false,
                        processExited: true,
                        exitCode,
                      }
                    : {
                        ...termState,
                        isActive: false,
                        isWaitingForResponse: false,
                        isWaitingForQuestion: false,
                        processExited: true,
                        exitCode,
                      }
                  terminals.set(terminalId, {
                    ...baseState,
                    error: errorMsg ?? baseState.error,
                    debugEvents: appendDebugEvent(baseState.debugEvents, 'agent-process-exit', { exitCode }, false, true),
                  })
                }

                return {
                  terminals,
                  ...(latestContextUsage ? { latestContextUsage } : {}),
                  ...(sessionCosts ? { sessionCosts } : {}),
                }
              })
            }

            // Post-processing: emit notifications and batch all remaining state
            // mutations into a SINGLE set() call. Previously this was 1-3
            // separate set() calls (turnTimings, notifiedTerminals add/delete)
            // — each triggering a full subscriber re-evaluation cycle.

            // Defer persistSession calls to next microtask so they don't
            // pile onto the synchronous batch handler. Persist triggers its
            // own set() (updating the sessions Record), which causes all
            // subscribers to re-evaluate. Deferring lets the main batch
            // render cycle complete first, keeping the UI responsive.
            if (messageEndTerminals.length > 0 || processExitTerminals.length > 0) {
              queueMicrotask(() => {
                for (const { terminalId } of messageEndTerminals) {
                  get().persistSession(terminalId)
                }
                for (const { terminalId } of processExitTerminals) {
                  get().persistSession(terminalId)
                }
              })
            }

            // Error toasts (cheap, no set())
            for (const { terminalId } of processExitTerminals) {
              const termStateAfter = get().terminals.get(terminalId)
              if (termStateAfter?.error) {
                useToastStore.getState().addToast(termStateAfter.error, 'error', 8000)
              }
            }

            // Collect all state patches, then apply in one set()
            const turnTimingUpdates: Array<{ ipid: string; endedAt: number }> = []
            const notifiedToAdd: string[] = []
            const notifiedToDelete: string[] = []

            for (const { terminalId, stopReason } of messageEndTerminals) {
              const termStateAfter = get().terminals.get(terminalId)
              if (stopReason === 'end_turn') {
                const sessionId = get().terminalToSession.get(terminalId)
                const ipid = sessionId ? get().sessionToInitialProcess.get(sessionId) : undefined
                if (ipid) {
                  turnTimingUpdates.push({ ipid, endedAt: Date.now() })
                }
                if (termStateAfter?.isWaitingForQuestion) {
                  emitAgentNotification(terminalId, 'needs-attention')
                } else {
                  emitAgentNotification(terminalId, 'done')
                  notifiedToAdd.push(terminalId)
                }
              }
            }

            for (const { terminalId } of processExitTerminals) {
              if (!get().notifiedTerminals.has(terminalId)) {
                emitAgentNotification(terminalId, 'done')
              }
              notifiedToDelete.push(terminalId)
            }

            // Single set() for all post-batch state mutations
            if (turnTimingUpdates.length > 0 || notifiedToAdd.length > 0 || notifiedToDelete.length > 0) {
              set((state) => {
                const patch: Partial<typeof state> = {}

                if (turnTimingUpdates.length > 0) {
                  const turnTimings = new Map(state.turnTimings)
                  for (const { ipid, endedAt } of turnTimingUpdates) {
                    const timing = turnTimings.get(ipid)
                    if (timing) {
                      turnTimings.set(ipid, { ...timing, endedAt })
                    }
                  }
                  patch.turnTimings = turnTimings
                }

                if (notifiedToAdd.length > 0 || notifiedToDelete.length > 0) {
                  const notifiedTerminals = new Set(state.notifiedTerminals)
                  for (const id of notifiedToAdd) notifiedTerminals.add(id)
                  for (const id of notifiedToDelete) notifiedTerminals.delete(id)
                  patch.notifiedTerminals = notifiedTerminals
                }

                return patch
              })
            }
          })
        } else if (hasIndividual) {
          // Fallback: individual event processing (pre-batch main process)
          console.log('[AgentStreamStore] Subscribing to individual detector events (no batch support)')
          unsubscribe = window.electron!.detector.onEvent((event) => {
            if (event.type === 'agent-session-init' && event.data?.sessionId) {
              const sessionId = event.data.sessionId as string
              get().setTerminalSession(event.terminalId, sessionId)
              useTerminalStore.getState().updateConfigSessionId(event.terminalId, sessionId)
              return
            }

            if (event.type === 'codex-approval-request' && event.data) {
              const sessionId = get().terminalToSession.get(event.terminalId) ?? event.terminalId
              const data = event.data as {
                jsonRpcId: number
                method: string
                toolName: string
                toolInput: Record<string, unknown>
              }
              const permissionId = `codex:${event.terminalId}:${data.jsonRpcId}`
              usePermissionStore.getState().addRequest({
                id: permissionId,
                sessionId,
                toolName: data.toolName,
                toolInput: data.toolInput,
                receivedAt: event.timestamp,
              })
              return
            }

            if (event.type === 'agent-process-exit') {
              const exitCode = (event.data as { exitCode?: number })?.exitCode ?? null

              set((state) => {
                const termState = state.terminals.get(event.terminalId)
                if (!termState) return state

                const errorMsg = detectEarlyDeathError(termState, exitCode)

                const terminals = new Map(state.terminals)
                const baseState = termState.currentMessage
                  ? {
                      ...termState,
                      messages: [...termState.messages, { ...termState.currentMessage, status: 'completed' as const, completedAt: Date.now() }],
                      currentMessage: null,
                      isActive: false,
                      isWaitingForResponse: false,
                      isWaitingForQuestion: false,
                      processExited: true,
                      exitCode,
                    }
                  : {
                      ...termState,
                      isActive: false,
                      isWaitingForResponse: false,
                      isWaitingForQuestion: false,
                      processExited: true,
                      exitCode,
                    }
                terminals.set(event.terminalId, {
                  ...baseState,
                  error: errorMsg ?? baseState.error,
                  debugEvents: appendDebugEvent(baseState.debugEvents, event.type, { exitCode }, false, true),
                })
                return { terminals }
              })
              get().persistSession(event.terminalId)

              // Show error toast if process died unexpectedly
              const termStateAfter = get().terminals.get(event.terminalId)
              if (termStateAfter?.error) {
                useToastStore.getState().addToast(termStateAfter.error, 'error', 8000)
              }

              if (!get().notifiedTerminals.has(event.terminalId)) {
                emitAgentNotification(event.terminalId, 'done')
              }
              set((state) => {
                const notifiedTerminals = new Set(state.notifiedTerminals)
                notifiedTerminals.delete(event.terminalId)
                return { notifiedTerminals }
              })
              return
            }

            if (event.type.startsWith('agent-')) {
              const agentEvent = { type: event.type, data: event.data } as AgentStreamEvent
              get().processEvent(event.terminalId, agentEvent)
            }
          })
        } else {
          console.warn('[AgentStreamStore] window.electron.detector not available')
        }

        return () => {
          if (unsubscribe) {
            unsubscribe()
            unsubscribe = null
            listenerSetup = false
          }
        }
      },

      subscribeToAgentProcessEvents: () => {
        if (!window.electron?.agent) {
          console.warn('[AgentStreamStore] window.electron.agent not available')
          return () => {}
        }

        // Subscribe to stream events from agent processes
        const unsubStream = window.electron.agent.onStreamEvent((id, event) => {
          // The event from the agent process should already be typed correctly
          get().processEvent(id, event as AgentStreamEvent)
        })

        // Subscribe to process exit - finalize current message and clear isActive
        const unsubExit = window.electron.agent.onProcessExit((id, code) => {
          const exitCode = code ?? null

          set((state) => {
            const termState = state.terminals.get(id)
            if (!termState) return state

            const errorMsg = detectEarlyDeathError(termState, exitCode)
            const terminals = new Map(state.terminals)

            if (termState.currentMessage) {
              // Finalize the current message if process exits during streaming
              const finalMessage: AgentMessage = {
                ...termState.currentMessage,
                status: 'completed',
                completedAt: Date.now(),
                stopReason: code === 0 ? 'end_turn' : undefined,
              }
              terminals.set(id, {
                ...termState,
                messages: [...termState.messages, finalMessage],
                currentMessage: null,
                isActive: false,
                isWaitingForResponse: false,
                processExited: true,
                exitCode,
                error: errorMsg ?? termState.error,
              })
            } else {
              // No streaming message, but still clear activity flags
              terminals.set(id, {
                ...termState,
                isActive: false,
                isWaitingForResponse: false,
                processExited: true,
                exitCode,
                error: errorMsg ?? termState.error,
              })
            }

            return { terminals }
          })

          // Persist session to DB on process exit so conversation history survives app restart
          get().persistSession(id)

          // Show error toast if process died unexpectedly
          const termStateAfter = get().terminals.get(id)
          if (termStateAfter?.error) {
            useToastStore.getState().addToast(termStateAfter.error, 'error', 8000)
          }

          // Only notify on process exit if we didn't already notify on end_turn
          if (!get().notifiedTerminals.has(id)) {
            emitAgentNotification(id, 'done')
          }
          // Clean up the tracking set
          set((state) => {
            const notifiedTerminals = new Set(state.notifiedTerminals)
            notifiedTerminals.delete(id)
            return { notifiedTerminals }
          })
        })

        // Subscribe to errors from agent processes
        const unsubError = window.electron.agent.onError((id, error) => {
          set((state) => {
            const termState = state.terminals.get(id)
            const terminals = new Map(state.terminals)
            terminals.set(id, {
              ...(termState || { currentMessage: null, messages: [], isActive: false, isWaitingForResponse: false, isWaitingForQuestion: false, processExited: false }),
              error,
            })
            return { terminals }
          })
        })

        return () => {
          unsubStream()
          unsubExit()
          unsubError()
        }
      },
    }),
    {
      name: 'agent-stream-store',
      storage: createJSONStorage(() => electronStorage),
      // Only persist sessions record, not runtime Maps or streaming state
      partialize: (state) => ({
        sessions: state.sessions,
      }),
      // Reinitialize runtime Maps after rehydration
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Ensure runtime Maps are initialized (they won't be persisted)
          state.terminals = new Map()
          state.terminalToSession = new Map()
          state.sessionToInitialProcess = new Map()
          state.titleGeneratedSessions = new Set()
          state.notifiedTerminals = new Set()
          state.queuedMessages = new Map()
          state.latestContextUsage = new Map()
          state.sessionCosts = new Map()
          state.turnTimings = new Map()
          state.hasRehydrated = true
          console.log('[AgentStreamStore] Rehydrated with', Object.keys(state.sessions).length, 'sessions')
          // Resolve the rehydration promise so waitForRehydration() callers can proceed
          if (rehydrationResolver) {
            rehydrationResolver()
          }
        }
      },
    }
  )
)

// Auto-subscribe to detector events when the store is created
// This ensures the listener is set up BEFORE any component mounts,
// preventing race conditions where events fire before subscription
if (typeof window !== 'undefined' && (window.electron?.detector?.onEventBatch || window.electron?.detector?.onEvent)) {
  // Defer subscription to next tick to ensure window.electron is fully initialized
  setTimeout(() => {
    useAgentStreamStore.getState().subscribeToEvents()
  }, 0)
}

// Cleanup function for when the app unmounts
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (unsubscribe) {
      unsubscribe()
    }
  })
}
