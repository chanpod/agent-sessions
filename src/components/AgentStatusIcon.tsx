/**
 * AgentStatusIcon - Shows the current status of an agent terminal
 * (spinner for responding/thinking, checkmark for done, etc.)
 *
 * Extracted from the old ActivityIndicator component. This is the agent-only
 * status indicator, not related to the old terminal PTY activity tracking.
 */

import { useTerminalStore } from '../stores/terminal-store'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import { IconLoader2, IconCheck, IconQuestionMark } from '@tabler/icons-react'

type AgentStatus = 'responding' | 'thinking' | 'done' | 'needs-attention' | 'idle' | 'exited'

interface AgentStatusIconProps {
  sessionId: string
  className?: string
}

export function AgentStatusIcon({ sessionId, className = '' }: AgentStatusIconProps) {
  const session = useTerminalStore((state) =>
    state.sessions.find((s) => s.id === sessionId)
  )

  const agentState = useAgentStreamStore((state) => {
    const conv = state.conversations.get(sessionId)
    const pids = conv?.processIds ?? [sessionId]

    // First pass: find any actively responding process
    for (const pid of pids) {
      const ts = state.terminals.get(pid)
      if (ts && (ts.isActive || ts.isWaitingForResponse)) return ts
    }

    // Second pass: return the most recent terminal state that has messages
    for (let i = pids.length - 1; i >= 0; i--) {
      const pid = pids[i]
      if (!pid) continue
      const ts = state.terminals.get(pid)
      if (ts && (ts.messages.length > 0 || ts.currentMessage)) return ts
    }

    return state.terminals.get(sessionId)
  })

  if (!session) return null

  let agentStatus: AgentStatus = 'idle'

  if (session.status === 'exited') {
    agentStatus = 'exited'
  } else if (agentState) {
    const lastMsg = agentState.messages[agentState.messages.length - 1]
    const isToolExecutionPending = !agentState.processExited && lastMsg?.stopReason === 'tool_use'

    if (agentState.currentMessage || agentState.isWaitingForResponse) {
      agentStatus = 'responding'
    } else if (agentState.isActive || isToolExecutionPending) {
      agentStatus = 'thinking'
    } else if (agentState.error) {
      agentStatus = 'needs-attention'
    } else if (agentState.messages.length > 0) {
      agentStatus = 'done'
    } else {
      agentStatus = 'idle'
    }
  }

  switch (agentStatus) {
    case 'responding':
      return (
        <IconLoader2
          size={18}
          stroke={2.5}
          className="animate-spin text-blue-400 shrink-0"
          title="Agent is responding..."
        />
      )
    case 'thinking':
      return (
        <IconLoader2
          size={18}
          stroke={2.5}
          className="animate-spin text-amber-400 shrink-0"
          title="Agent is thinking..."
        />
      )
    case 'done':
      return (
        <IconCheck
          size={18}
          stroke={2.5}
          className="text-emerald-400 shrink-0"
          title="Agent completed"
        />
      )
    case 'needs-attention':
      return (
        <IconQuestionMark
          size={18}
          stroke={2.5}
          className="text-yellow-400 shrink-0"
          title="Needs attention"
        />
      )
    case 'exited':
      return (
        <span
          className={`w-2 h-2 rounded-full bg-zinc-500 shrink-0 ${className}`}
          title="Exited"
        />
      )
    case 'idle':
    default:
      return (
        <span
          className={`w-2 h-2 rounded-full bg-zinc-400 shrink-0 ${className}`}
          title="Idle"
        />
      )
  }
}
