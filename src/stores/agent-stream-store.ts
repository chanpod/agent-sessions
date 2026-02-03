import { create } from 'zustand'
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

interface AgentStreamStore {
  // State: Map of terminalId -> agent state
  terminals: Map<string, TerminalAgentState>

  // Actions
  processEvent(terminalId: string, event: AgentStreamEvent): void
  getTerminalState(terminalId: string): TerminalAgentState | undefined
  isMessageComplete(terminalId: string): boolean
  clearTerminal(terminalId: string): void

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

export const useAgentStreamStore = create<AgentStreamStore>((set, get) => ({
  terminals: new Map(),

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

        case 'agent-tool-end': {
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
          console.log('[AgentStreamStore] agent-message-end received, currentMessage:', !!terminalState.currentMessage)
          if (!terminalState.currentMessage) {
            // No message to complete - this can happen with duplicate events from
            // Claude CLI emitting both print mode (assistant) and streaming mode (message_stop) events.
            // Still ensure isActive is false to handle any edge cases.
            console.log('[AgentStreamStore] No currentMessage to complete (duplicate event?), ensuring isActive=false')
            newState = {
              ...terminalState,
              isActive: false,
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
            isActive: false,
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
      return { terminals }
    })
  },

  subscribeToEvents: () => {
    if (listenerSetup) return () => {}
    listenerSetup = true

    // Subscribe to detector events via IPC
    if (window.electron?.detector?.onEvent) {
      console.log('[AgentStreamStore] Subscribing to detector events')
      unsubscribe = window.electron.detector.onEvent((event) => {
        console.log('[AgentStreamStore] Received detector event:', event.type, event.terminalId)
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

    // Subscribe to process exit - finalize current message if process exits during streaming
    const unsubExit = window.electron.agent.onProcessExit((id, code) => {
      const terminalState = get().terminals.get(id)
      if (terminalState?.currentMessage) {
        // Finalize the current message if process exits during streaming
        set((state) => {
          const termState = state.terminals.get(id)
          if (!termState?.currentMessage) return state

          const finalMessage: AgentMessage = {
            ...termState.currentMessage,
            status: 'completed',
            completedAt: Date.now(),
            stopReason: code === 0 ? 'end_turn' : undefined,
          }

          const terminals = new Map(state.terminals)
          terminals.set(id, {
            ...termState,
            messages: [...termState.messages, finalMessage],
            currentMessage: null,
            isActive: false,
          })

          return { terminals }
        })
      }
    })

    // Subscribe to errors from agent processes
    const unsubError = window.electron.agent.onError((id, error) => {
      set((state) => {
        const termState = state.terminals.get(id)
        const terminals = new Map(state.terminals)
        terminals.set(id, {
          ...(termState || { currentMessage: null, messages: [], isActive: false }),
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
}))

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
