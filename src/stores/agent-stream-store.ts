import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { electronStorage } from '../lib/electron-storage'
import { useTerminalStore } from './terminal-store'
import { usePermissionStore } from './permission-store'
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

  // Actions
  processEvent(terminalId: string, event: AgentStreamEvent): void
  getTerminalState(terminalId: string): TerminalAgentState | undefined
  isMessageComplete(terminalId: string): boolean
  clearTerminal(terminalId: string): void
  markWaitingForResponse(terminalId: string): void
  resetTerminalActivity(terminalId: string): void

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
    processExited: false,
  }
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

      processEvent: (terminalId: string, event: AgentStreamEvent) => {
        set((state) => {
          const terminals = new Map(state.terminals)
          const terminalState = getOrCreateTerminalState(terminals, terminalId)

          let newState: TerminalAgentState

          switch (event.type) {
            case 'agent-message-start': {
              const data = event.data as AgentMessageStartData
              console.log('[AgentStreamStore] agent-message-start:', data.messageId, 'terminalId:', terminalId)
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
              console.log('[AgentStreamStore] agent-text-delta:', data.text?.substring(0, 50), 'terminalId:', terminalId)
              if (!terminalState.currentMessage) {
                console.warn('[AgentStreamStore] No currentMessage for text delta! terminalId:', terminalId)
                newState = terminalState
                break
              }

              const { blocks } = terminalState.currentMessage
              const blockIndex = data.blockIndex

              // If block doesn't exist at this index, create it
              let newBlocks: ContentBlock[]
              if (blockIndex >= blocks.length) {
                // Create new text block
                newBlocks = [
                  ...blocks,
                  {
                    type: 'text',
                    content: data.text,
                  },
                ]
              } else {
                // Append to existing block
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
                // Create new thinking block
                newBlocks = [
                  ...blocks,
                  {
                    type: 'thinking',
                    content: data.text,
                  },
                ]
              } else {
                // Append to existing block
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

              // Deduplicate: skip if a block with this toolId already exists
              const existingBlock = terminalState.currentMessage.blocks.find(
                (b) => b.type === 'tool_use' && b.toolId === data.toolId
              )
              if (existingBlock) {
                newState = terminalState
                break
              }

              // Create new tool_use block
              const newBlock: ContentBlock = {
                type: 'tool_use',
                content: '', // Tool input JSON will be accumulated in toolInput
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
                // Block doesn't exist, ignore
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

            // agent-tool-end comes from the AgentProcessManager path;
            // agent-block-end comes from the PTY/detector path (content_block_stop).
            // Both carry { blockIndex } and mean the same thing: mark the block complete.
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
              console.log('[AgentStreamStore] agent-message-end received, currentMessage:', !!terminalState.currentMessage, 'stopReason:', data.stopReason)

              // isActive stays true during tool_use (agent will continue after tool execution).
              // On end_turn the agent is done responding for this turn.
              const stillActive = data.stopReason === 'tool_use'

              if (!terminalState.currentMessage) {
                // No message to complete - duplicate event. Respect stopReason for isActive.
                newState = {
                  ...terminalState,
                  isActive: stillActive,
                }
                break
              }

              // Mark all blocks as complete
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
                // Mark current message as error
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
              // Unknown event type, no state change
              newState = terminalState
          }

          terminals.set(terminalId, newState)
          return { terminals }
        })

        // Persist session to DB after message completes so it survives app restart
        if (event.type === 'agent-message-end') {
          get().persistSession(terminalId)
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

      subscribeToEvents: () => {
        if (listenerSetup) return () => {}
        listenerSetup = true

        // Subscribe to detector events via IPC
        if (window.electron?.detector?.onEvent) {
          console.log('[AgentStreamStore] Subscribing to detector events')
          unsubscribe = window.electron.detector.onEvent((event) => {
            console.log('[AgentStreamStore] Received detector event:', event.type, event.terminalId)

            // Handle session init event — capture and persist the session_id
            if (event.type === 'agent-session-init' && event.data?.sessionId) {
              const sessionId = event.data.sessionId as string
              console.log('[AgentStreamStore] Captured session_id from detector:', sessionId, 'for terminal:', event.terminalId)
              get().setTerminalSession(event.terminalId, sessionId)
              useTerminalStore.getState().updateConfigSessionId(event.terminalId, sessionId)
              return
            }

            // Handle Codex approval requests — route to the permission store
            // so PermissionModal can show the approval dialog.
            if (event.type === 'codex-approval-request' && event.data) {
              const sessionId = get().terminalToSession.get(event.terminalId) ?? event.terminalId
              const data = event.data as {
                jsonRpcId: number
                method: string
                toolName: string
                toolInput: Record<string, unknown>
              }
              // Use a composite ID that encodes terminalId + jsonRpcId so the
              // response handler can route the reply back to the right PTY.
              const permissionId = `codex:${event.terminalId}:${data.jsonRpcId}`
              usePermissionStore.getState().addRequest({
                id: permissionId,
                sessionId,
                toolName: data.toolName,
                toolInput: data.toolInput,
                receivedAt: event.timestamp,
              })
              console.log('[AgentStreamStore] Codex approval request queued:', permissionId, data.toolName)
              return
            }

            // Handle process exit — clear activity flags and persist session.
            // This is the authoritative "done" signal for PTY-based agents.
            if (event.type === 'agent-process-exit') {
              console.log('[AgentStreamStore] Process exit for terminal:', event.terminalId)
              set((state) => {
                const termState = state.terminals.get(event.terminalId)
                if (!termState) return state

                const terminals = new Map(state.terminals)
                if (termState.currentMessage) {
                  // Finalize any in-progress message
                  terminals.set(event.terminalId, {
                    ...termState,
                    messages: [...termState.messages, { ...termState.currentMessage, status: 'completed' as const, completedAt: Date.now() }],
                    currentMessage: null,
                    isActive: false,
                    isWaitingForResponse: false,
                    processExited: true,
                  })
                } else {
                  terminals.set(event.terminalId, {
                    ...termState,
                    isActive: false,
                    isWaitingForResponse: false,
                    processExited: true,
                  })
                }
                return { terminals }
              })
              get().persistSession(event.terminalId)
              return
            }

            // Filter for agent-* events and convert to AgentStreamEvent
            if (event.type.startsWith('agent-')) {
              console.log('[AgentStreamStore] Processing agent event:', event.type)
              const agentEvent = {
                type: event.type,
                data: event.data,
              } as AgentStreamEvent
              get().processEvent(event.terminalId, agentEvent)
            }
          })
        } else {
          // IPC not available (e.g., in development or tests)
          console.warn('[AgentStreamStore] window.electron.detector.onEvent not available')
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
          set((state) => {
            const termState = state.terminals.get(id)
            if (!termState) return state

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
              })
            } else {
              // No streaming message, but still clear activity flags
              terminals.set(id, {
                ...termState,
                isActive: false,
                isWaitingForResponse: false,
                processExited: true,
              })
            }

            return { terminals }
          })

          // Persist session to DB on process exit so conversation history survives app restart
          get().persistSession(id)
        })

        // Subscribe to errors from agent processes
        const unsubError = window.electron.agent.onError((id, error) => {
          set((state) => {
            const termState = state.terminals.get(id)
            const terminals = new Map(state.terminals)
            terminals.set(id, {
              ...(termState || { currentMessage: null, messages: [], isActive: false, isWaitingForResponse: false, processExited: false }),
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
if (typeof window !== 'undefined' && window.electron?.detector?.onEvent) {
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
