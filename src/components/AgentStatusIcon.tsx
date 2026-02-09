/**
 * AgentStatusIcon - Shows the current status of an agent terminal
 * (spinner for responding/thinking, checkmark for done, etc.)
 *
 * Extracted from the old ActivityIndicator component. This is the agent-only
 * status indicator, not related to the old terminal PTY activity tracking.
 */

import { useTerminalStore } from '../stores/terminal-store'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import { IconLoader2 } from '@tabler/icons-react'
import type { TerminalAgentState } from '../types/stream-json'

type AgentStatus = 'responding' | 'thinking' | 'done' | 'needs-attention' | 'idle' | 'exited'

/**
 * Derive a status string from a TerminalAgentState.
 * Shared between AgentStatusIcon and useProjectAgentStatus.
 */
export function deriveAgentStatus(
  agentState: TerminalAgentState | undefined,
  isExited: boolean
): AgentStatus {
  if (isExited) return 'exited'
  if (!agentState) return 'idle'

  const lastMsg = agentState.messages[agentState.messages.length - 1]
  const isToolExecutionPending = !agentState.processExited && lastMsg?.stopReason === 'tool_use'

  if (agentState.currentMessage || agentState.isWaitingForResponse) return 'responding'
  if (agentState.isActive || isToolExecutionPending) return 'thinking'
  if (agentState.error) return 'needs-attention'
  if (agentState.messages.length > 0) return 'done'
  return 'idle'
}

interface AgentStatusIconProps {
  sessionId: string
  className?: string
}

export function AgentStatusIcon({ sessionId }: AgentStatusIconProps) {
  const isExited = useTerminalStore((state) =>
    state.sessions.find((s) => s.id === sessionId)?.status === 'exited'
  )

  // Derive status string INSIDE the selector so Zustand can compare primitive
  // strings instead of object references. During streaming, the TerminalAgentState
  // object changes on every delta (new currentMessage.blocks), but the derived
  // status stays 'responding' — so this selector returns the same string and
  // Zustand skips the re-render entirely.
  const agentStatus = useAgentStreamStore((state): AgentStatus => {
    const conv = state.conversations.get(sessionId)
    const pids = conv?.processIds ?? [sessionId]

    // Find the most relevant agent state (prefer active ones)
    let bestState: TerminalAgentState | undefined
    for (const pid of pids) {
      const ts = state.terminals.get(pid)
      if (ts && (ts.isActive || ts.isWaitingForResponse)) {
        bestState = ts
        break
      }
    }
    if (!bestState) {
      for (let i = pids.length - 1; i >= 0; i--) {
        const pid = pids[i]
        if (!pid) continue
        const ts = state.terminals.get(pid)
        if (ts && (ts.messages.length > 0 || ts.currentMessage)) {
          bestState = ts
          break
        }
      }
    }
    if (!bestState) {
      bestState = state.terminals.get(sessionId)
    }

    return deriveAgentStatus(bestState, isExited ?? false)
  })

  // Spinner for active states, colored dots for static states
  // Sized to work as an overlay on the agent icon
  switch (agentStatus) {
    case 'responding':
      return (
        <IconLoader2
          size={14}
          stroke={2.5}
          className="animate-spin text-blue-400 shrink-0 drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]"
          title="Agent is responding..."
        />
      )
    case 'thinking':
      return (
        <IconLoader2
          size={14}
          stroke={2.5}
          className="animate-spin text-amber-400 shrink-0 drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]"
          title="Agent is thinking..."
        />
      )
    case 'done':
      return (
        <span className="relative flex shrink-0" title="Agent completed">
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background" />
        </span>
      )
    case 'needs-attention':
      return (
        <span className="relative flex shrink-0" title="Needs attention">
          <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-yellow-400 opacity-50" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400 ring-2 ring-background" />
        </span>
      )
    case 'exited':
      return (
        <span className="relative flex shrink-0" title="Exited">
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-zinc-500 ring-2 ring-background" />
        </span>
      )
    case 'idle':
    default:
      return (
        <span className="relative flex shrink-0" title="Idle">
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-zinc-500 ring-2 ring-background" />
        </span>
      )
  }
}
