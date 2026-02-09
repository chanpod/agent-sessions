import { useTerminalStore } from '../stores/terminal-store'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import { useProjectStore } from '../stores/project-store'
import { deriveAgentStatus } from '../components/AgentStatusIcon'
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
 * Find the most relevant TerminalAgentState for a session across all its process IDs.
 */
function findBestState(
  sessionId: string,
  terminals: Map<string, TerminalAgentState>,
  conversations: Map<string, { processIds: string[] }>
): TerminalAgentState | undefined {
  const conv = conversations.get(sessionId)
  const pids = conv?.processIds ?? [sessionId]

  for (const pid of pids) {
    const ts = terminals.get(pid)
    if (ts && (ts.isActive || ts.isWaitingForResponse)) return ts
  }
  for (let i = pids.length - 1; i >= 0; i--) {
    const pid = pids[i]
    if (!pid) continue
    const ts = terminals.get(pid)
    if (ts && (ts.messages.length > 0 || ts.currentMessage)) return ts
  }
  return terminals.get(sessionId)
}

/**
 * Get aggregated agent status summary for a single project.
 *
 * Computes the full summary INSIDE the selector so Zustand can compare the
 * result by value. During streaming, terminal states change on every delta
 * but the derived summary (e.g. "1 responding, 2 done") usually stays the
 * same — so re-renders are skipped.
 */
export function useProjectAgentStatus(projectId: string): ProjectAgentSummary {
  const sessions = useTerminalStore((state) =>
    state.sessions.filter((s) => s.projectId === projectId && s.terminalType === 'agent')
  )

  // Derive the summary inside the selector. Zustand compares the returned
  // string with === so component only re-renders when the actual status counts change.
  const summaryKey = useAgentStreamStore((state) => {
    let responding = 0, thinking = 0, done = 0, needsAttention = 0, idle = 0, exited = 0
    for (const session of sessions) {
      const bestState = findBestState(session.id, state.terminals, state.conversations as Map<string, { processIds: string[] }>)
      const status = deriveAgentStatus(bestState, session.status === 'exited')
      switch (status) {
        case 'responding': responding++; break
        case 'thinking': thinking++; break
        case 'done': done++; break
        case 'needs-attention': needsAttention++; break
        case 'idle': idle++; break
        case 'exited': exited++; break
      }
    }
    return `${responding},${thinking},${done},${needsAttention},${idle},${exited},${sessions.length}`
  })

  // Parse the key back into the summary object (cheap, only runs on actual changes)
  const [responding, thinking, done, needsAttention, idle, exited, total] = summaryKey.split(',').map(Number)
  const summary = { responding: responding!, thinking: thinking!, done: done!, needsAttention: needsAttention!, idle: idle!, exited: exited!, total: total! }
  return { ...summary, topStatus: getTopStatus(summary) }
}

/**
 * Get aggregated agent status for ALL projects at once.
 * Useful for the ProjectSwitcher to show badges on all projects.
 *
 * Like useProjectAgentStatus, derives a string key inside the selector
 * to avoid re-renders when streaming deltas don't change any status.
 */
export function useAllProjectAgentStatuses(): Record<string, ProjectAgentSummary> {
  const projects = useProjectStore((state) => state.projects)
  const allSessions = useTerminalStore((state) => state.sessions)

  // Build a composite key: "projectId:r,t,d,n,i,e,total|projectId:..."
  const compositeKey = useAgentStreamStore((state) => {
    const parts: string[] = []
    for (const project of projects) {
      const agentSessions = allSessions.filter(
        (s) => s.projectId === project.id && s.terminalType === 'agent'
      )
      let responding = 0, thinking = 0, done = 0, needsAttention = 0, idle = 0, exited = 0
      for (const session of agentSessions) {
        const bestState = findBestState(session.id, state.terminals, state.conversations as Map<string, { processIds: string[] }>)
        const status = deriveAgentStatus(bestState, session.status === 'exited')
        switch (status) {
          case 'responding': responding++; break
          case 'thinking': thinking++; break
          case 'done': done++; break
          case 'needs-attention': needsAttention++; break
          case 'idle': idle++; break
          case 'exited': exited++; break
        }
      }
      parts.push(`${project.id}:${responding},${thinking},${done},${needsAttention},${idle},${exited},${agentSessions.length}`)
    }
    return parts.join('|')
  })

  // Parse composite key back into result object (only runs when key changes)
  const result: Record<string, ProjectAgentSummary> = {}
  if (compositeKey) {
    for (const part of compositeKey.split('|')) {
      const [projectId, counts] = part.split(':')
      if (!projectId || !counts) continue
      const [responding, thinking, done, needsAttention, idle, exited, total] = counts.split(',').map(Number)
      const summary = { responding: responding!, thinking: thinking!, done: done!, needsAttention: needsAttention!, idle: idle!, exited: exited!, total: total! }
      result[projectId] = { ...summary, topStatus: getTopStatus(summary) }
    }
  }
  return result
}
