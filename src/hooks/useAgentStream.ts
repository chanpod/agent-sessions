import { useEffect } from 'react'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import type { TerminalAgentState, AgentMessage } from '../types/stream-json'

/**
 * Hook to subscribe to agent stream events and get state for a specific terminal
 */
export function useAgentStream(terminalId: string): {
  state: TerminalAgentState | undefined
  currentMessage: AgentMessage | null
  messages: AgentMessage[]
  isStreaming: boolean
  isComplete: boolean
} {
  const store = useAgentStreamStore()

  // Subscribe to IPC events on mount
  useEffect(() => {
    const unsubscribe = store.subscribeToEvents()
    return unsubscribe
  }, []) // Only once per component mount

  const state = store.getTerminalState(terminalId)

  return {
    state,
    currentMessage: state?.currentMessage ?? null,
    messages: state?.messages ?? [],
    isStreaming: state?.currentMessage?.status === 'streaming',
    isComplete: store.isMessageComplete(terminalId),
  }
}

/**
 * Hook to just check if a terminal's agent is complete
 */
export function useAgentComplete(terminalId: string): boolean {
  return useAgentStreamStore((state) => state.isMessageComplete(terminalId))
}

/**
 * Hook to get current message content as a single string (for simple display)
 */
export function useAgentMessageText(terminalId: string): string {
  const { currentMessage } = useAgentStream(terminalId)
  if (!currentMessage) return ''

  return currentMessage.blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.content)
    .join('')
}
