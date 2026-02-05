import { useTerminalStore } from '../stores/terminal-store'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import { useProjectStore } from '../stores/project-store'
import type { TerminalAgentState } from '../types/stream-json'

export type AgentStatus = 'responding' | 'thinking' | 'done' | 'needs-attention' | 'idle' | 'exited'

export interface ProjectAgentSummary {
  responding: number
  thinking: number
  done: number
  needsAttention: number
  idle: number
  exited: number
  total: number
  /** The highest-priority status across all agents in this project */
  topStatus: AgentStatus | null
}

function deriveAgentStatus(
  agentState: TerminalAgentState | undefined,
  isExited: boolean
): AgentStatus {
  if (isExited) return 'exited'
  if (!agentState) return 'idle'

  // Safety net: detect tool execution pending even if isActive was cleared
  const lastMsg = agentState.messages[agentState.messages.length - 1]
  const isToolExecutionPending = !agentState.processExited && lastMsg?.stopReason === 'tool_use'

  if (agentState.currentMessage || agentState.isWaitingForResponse) return 'responding'
  if (agentState.isActive || isToolExecutionPending) return 'thinking'
  if (agentState.error) return 'needs-attention'
  if (agentState.messages.length > 0) return 'done'
  return 'idle'
}

function getTopStatus(summary: Omit<ProjectAgentSummary, 'topStatus'>): AgentStatus | null {
  if (summary.total === 0) return null
  if (summary.needsAttention > 0) return 'needs-attention'
  if (summary.responding > 0) return 'responding'
  if (summary.thinking > 0) return 'thinking'
  if (summary.done > 0) return 'done'
  if (summary.idle > 0) return 'idle'
  return 'exited'
}

/**
 * Get aggregated agent status summary for a single project.
 * Uses Zustand selectors so it only re-renders when relevant state changes.
 */
export function useProjectAgentStatus(projectId: string): ProjectAgentSummary {
  const sessions = useTerminalStore((state) =>
    state.sessions.filter((s) => s.projectId === projectId && s.terminalType === 'agent')
  )

  const terminals = useAgentStreamStore((state) => state.terminals)
  const conversations = useAgentStreamStore((state) => state.conversations)

  const summary: Omit<ProjectAgentSummary, 'topStatus'> = {
    responding: 0,
    thinking: 0,
    done: 0,
    needsAttention: 0,
    idle: 0,
    exited: 0,
    total: sessions.length,
  }

  for (const session of sessions) {
    // For multi-turn conversations, check all process IDs
    const conv = conversations.get(session.id)
    const pids = conv?.processIds ?? [session.id]

    // Find the most relevant agent state (prefer active ones)
    let bestState: TerminalAgentState | undefined
    for (const pid of pids) {
      const ts = terminals.get(pid)
      if (ts && (ts.isActive || ts.isWaitingForResponse)) {
        bestState = ts
        break
      }
    }
    if (!bestState) {
      // Fallback: most recent terminal state with messages
      for (let i = pids.length - 1; i >= 0; i--) {
        const pid = pids[i]
        if (!pid) continue
        const ts = terminals.get(pid)
        if (ts && (ts.messages.length > 0 || ts.currentMessage)) {
          bestState = ts
          break
        }
      }
    }
    if (!bestState) {
      bestState = terminals.get(session.id)
    }

    const status = deriveAgentStatus(bestState, session.status === 'exited')
    summary[status === 'needs-attention' ? 'needsAttention' : status]++
  }

  return { ...summary, topStatus: getTopStatus(summary) }
}

/**
 * Get aggregated agent status for ALL projects at once.
 * Useful for the ProjectSwitcher to show badges on all projects.
 */
export function useAllProjectAgentStatuses(): Record<string, ProjectAgentSummary> {
  const projects = useProjectStore((state) => state.projects)
  const allSessions = useTerminalStore((state) => state.sessions)
  const terminals = useAgentStreamStore((state) => state.terminals)
  const conversations = useAgentStreamStore((state) => state.conversations)

  const result: Record<string, ProjectAgentSummary> = {}

  for (const project of projects) {
    const agentSessions = allSessions.filter(
      (s) => s.projectId === project.id && s.terminalType === 'agent'
    )

    const summary: Omit<ProjectAgentSummary, 'topStatus'> = {
      responding: 0,
      thinking: 0,
      done: 0,
      needsAttention: 0,
      idle: 0,
      exited: 0,
      total: agentSessions.length,
    }

    for (const session of agentSessions) {
      const conv = conversations.get(session.id)
      const pids = conv?.processIds ?? [session.id]

      let bestState: TerminalAgentState | undefined
      for (const pid of pids) {
        const ts = terminals.get(pid)
        if (ts && (ts.isActive || ts.isWaitingForResponse)) {
          bestState = ts
          break
        }
      }
      if (!bestState) {
        for (let i = pids.length - 1; i >= 0; i--) {
          const pid = pids[i]
          if (!pid) continue
          const ts = terminals.get(pid)
          if (ts && (ts.messages.length > 0 || ts.currentMessage)) {
            bestState = ts
            break
          }
        }
      }
      if (!bestState) {
        bestState = terminals.get(session.id)
      }

      const status = deriveAgentStatus(bestState, session.status === 'exited')
      summary[status === 'needs-attention' ? 'needsAttention' : status]++
    }

    result[project.id] = { ...summary, topStatus: getTopStatus(summary) }
  }

  return result
}
