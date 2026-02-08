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
  AgentMessageEndData,
  AgentErrorData,
  DebugEventEntry,
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

  // Runtime-only: draft input text per session (survives component unmount, not app restart)
  draftInputs: Map<string, string>

  // Runtime-only: queued messages per conversation (initialProcessId -> messages)
  // When the agent finishes, queued messages are sent automatically
  queuedMessages: Map<string, string[]>

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

  // Draft input management (survives session switching)
  setDraftInput(sessionKey: string, text: string): void
  getDraftInput(sessionKey: string): string
  clearDraftInput(sessionKey: string): void

  // Message queue management
  enqueueMessage(initialProcessId: string, message: string): void
  dequeueMessage(initialProcessId: string): string | undefined
  peekQueue(initialProcessId: string): string[]
  clearQueue(initialProcessId: string): void

  // IPC subscription
  subscribeToEvents(): () => void // returns unsubscribe function (for PTY-based detector events)
  subscribeToAgentProcessEvents(): () => void // returns unsubscribe function (for child process agent events)
}

// Global listener setup - only set up once
let listenerSetup = false
let unsubscribe: (() => void) | null = null

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
 */
function detectEarlyDeathError(
  termState: TerminalAgentState,
  exitCode: number | null
): string | undefined {
  const wasWaiting = termState.isWaitingForResponse

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
const DEBUG_EVENT_CAP = 200

/** Delta event types that fire very frequently during streaming - skip debug logging for these */
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
      return `stopReason=${d.stopReason}`
    case 'agent-tool-start':
      return `tool=${d.name} id=${d.toolId}`
    case 'agent-block-end':
    case 'agent-tool-end':
      return `blockIndex=${d.blockIndex}`
    case 'agent-error':
      return `${d.errorType}: ${d.message}`
    case 'agent-process-exit':
      return `exitCode=${d.exitCode}`
    case 'agent-session-init':
      return `sessionId=${d.sessionId}`
    case 'agent-text-delta':
      return `blockIndex=${d.blockIndex} len=${(d.text as string)?.length ?? 0}`
    case 'agent-thinking-delta':
      return `blockIndex=${d.blockIndex} len=${(d.text as string)?.length ?? 0}`
    case 'agent-tool-input-delta':
      return `blockIndex=${d.blockIndex}`
    default:
      return JSON.stringify(d).substring(0, 80)
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
): DebugEventEntry[] {
  const entry: DebugEventEntry = {
    index: debugEventCounter++,
    type,
    timestamp: Date.now(),
    summary: summarizeEvent(type, data),
    isActiveAfter,
    processExitedAfter,
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
): TerminalAgentState {
  let newState: TerminalAgentState

  switch (event.type) {
    case 'agent-message-start': {
      const data = event.data as AgentMessageStartData

      if (data.messageId && terminalState.messages.some((m) => m.id === data.messageId)) {
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

      newState = {
        ...terminalState,
        currentMessage: null,
        messages: [...terminalState.messages, completedMessage],
        isActive: stillActive,
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

  // Skip debug event tracking for high-frequency delta events to reduce overhead
  if (!DELTA_EVENT_TYPES.has(event.type)) {
    newState = {
      ...newState,
      debugEvents: appendDebugEvent(
        newState.debugEvents,
        event.type,
        event.data,
        newState.isActive,
        newState.processExited,
      ),
    }
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
 * Emit notifications when agents finish or need attention in non-active projects.
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

  const activeProjectId = useProjectStore.getState().activeProjectId
  if (session.projectId === activeProjectId) return // Don't notify for active project

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
      draftInputs: new Map(),
      queuedMessages: new Map(),

      processEvent: (terminalId: string, event: AgentStreamEvent) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          const terminalState = getOrCreateTerminalState(terminals, terminalId)
          const newState = applyAgentEvent(terminalState, event)
          terminals.set(terminalId, newState)
          return { terminals }
        })

        // Persist session to DB after message completes so it survives app restart
        if (event.type === 'agent-message-end') {
          get().persistSession(terminalId)

          const endData = event.data as { stopReason?: string }
          const termStateAfter = get().terminals.get(terminalId)
          if (endData.stopReason === 'end_turn' && termStateAfter?.isWaitingForQuestion) {
            emitAgentNotification(terminalId, 'needs-attention')
          } else if (endData.stopReason === 'end_turn') {
            emitAgentNotification(terminalId, 'done')
            set((state) => {
              const notifiedTerminals = new Set(state.notifiedTerminals)
              notifiedTerminals.add(terminalId)
              return { notifiedTerminals }
            })
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
          return { conversations }
        })
      },

      getConversation: (initialProcessId: string) => {
        return get().conversations.get(initialProcessId) ?? { processIds: [initialProcessId], userMessages: [] }
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

          return { terminals, terminalToSession, sessionToInitialProcess, conversations }
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

        const sessionData: PersistedSessionData = {
          sessionId,
          agentType: agentType || existingSession?.agentType || 'unknown',
          messages: aggregatedMessages,
          userMessages,
          lastActiveAt: Date.now(),
          cwd: cwd || existingSession?.cwd || '',
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

      setDraftInput: (sessionKey: string, text: string) => {
        set((state) => {
          const draftInputs = new Map(state.draftInputs)
          if (text) {
            draftInputs.set(sessionKey, text)
          } else {
            draftInputs.delete(sessionKey)
          }
          return { draftInputs }
        })
      },

      getDraftInput: (sessionKey: string) => {
        return get().draftInputs.get(sessionKey) ?? ''
      },

      clearDraftInput: (sessionKey: string) => {
        set((state) => {
          const draftInputs = new Map(state.draftInputs)
          draftInputs.delete(sessionKey)
          return { draftInputs }
        })
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
            // Collect agent events to process in a single set() call
            const agentEvents: Array<{ terminalId: string; event: AgentStreamEvent }> = []
            // Collect terminal IDs that need post-set() work (persist, notify)
            const messageEndTerminals: Array<{ terminalId: string; stopReason?: string }> = []
            const processExitTerminals: Array<{ terminalId: string; exitCode: number | null }> = []

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
                processExitTerminals.push({
                  terminalId: event.terminalId,
                  exitCode: (event.data as { exitCode?: number })?.exitCode ?? null,
                })
                continue
              }

              // Collect agent-* events for batch state update
              if (event.type.startsWith('agent-')) {
                const agentEvent = { type: event.type, data: event.data } as AgentStreamEvent
                agentEvents.push({ terminalId: event.terminalId, event: agentEvent })
                if (event.type === 'agent-message-end') {
                  messageEndTerminals.push({
                    terminalId: event.terminalId,
                    stopReason: (event.data as { stopReason?: string })?.stopReason,
                  })
                }
              }
            }

            // Process ALL agent events in a SINGLE set() call.
            // This is the critical optimization: instead of N set() calls (one per event),
            // we clone the terminals Map once, apply all mutations, then return.
            if (agentEvents.length > 0 || processExitTerminals.length > 0) {
              set((state) => {
                const terminals = new Map(state.terminals)

                // Apply agent events
                for (const { terminalId, event } of agentEvents) {
                  const terminalState = getOrCreateTerminalState(terminals, terminalId)
                  terminals.set(terminalId, applyAgentEvent(terminalState, event))
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
                        processExited: true,
                        exitCode,
                      }
                    : {
                        ...termState,
                        isActive: false,
                        isWaitingForResponse: false,
                        processExited: true,
                        exitCode,
                      }
                  terminals.set(terminalId, {
                    ...baseState,
                    error: errorMsg ?? baseState.error,
                    debugEvents: appendDebugEvent(baseState.debugEvents, 'agent-process-exit', { exitCode }, false, true),
                  })
                }

                return { terminals }
              })
            }

            // Post-processing: persist sessions and emit notifications (outside set())
            for (const { terminalId, stopReason } of messageEndTerminals) {
              get().persistSession(terminalId)
              const termStateAfter = get().terminals.get(terminalId)
              if (stopReason === 'end_turn' && termStateAfter?.isWaitingForQuestion) {
                emitAgentNotification(terminalId, 'needs-attention')
              } else if (stopReason === 'end_turn') {
                emitAgentNotification(terminalId, 'done')
                set((state) => {
                  const notifiedTerminals = new Set(state.notifiedTerminals)
                  notifiedTerminals.add(terminalId)
                  return { notifiedTerminals }
                })
              }
            }

            for (const { terminalId } of processExitTerminals) {
              get().persistSession(terminalId)

              // Show error toast if process died unexpectedly
              const termStateAfter = get().terminals.get(terminalId)
              if (termStateAfter?.error) {
                useToastStore.getState().addToast(termStateAfter.error, 'error', 8000)
              }

              if (!get().notifiedTerminals.has(terminalId)) {
                emitAgentNotification(terminalId, 'done')
              }
              set((state) => {
                const notifiedTerminals = new Set(state.notifiedTerminals)
                notifiedTerminals.delete(terminalId)
                return { notifiedTerminals }
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
                      processExited: true,
                      exitCode,
                    }
                  : {
                      ...termState,
                      isActive: false,
                      isWaitingForResponse: false,
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
          state.draftInputs = new Map()
          state.queuedMessages = new Map()
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
