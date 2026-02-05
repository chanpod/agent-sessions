import { useSyncExternalStore, useEffect, useRef } from 'react'
import { useTerminalStore } from '../stores/terminal-store'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import { useToastStore } from '../stores/toast-store'
import { useProjectStore } from '../stores/project-store'
import { IconLoader2, IconCheck, IconQuestionMark } from '@tabler/icons-react'

const IDLE_THRESHOLD_MS = 5000
const MINOR_ACTIVITY_THRESHOLD_MS = 5000 // Yellow goes to grey after 5s
const NEW_TERMINAL_GRACE_PERIOD_MS = 10000 // Don't notify for 10s after terminal creation

type AgentStatus = 'responding' | 'thinking' | 'done' | 'needs-attention' | 'idle' | 'exited'

interface ActivityIndicatorProps {
  sessionId: string
  className?: string
  onActivityChange?: (isActive: boolean, sessionId: string, projectId: string) => void
}

// Custom hook that forces re-render every second for time-based UI
function useCurrentTime(intervalMs: number = 1000) {
  return useSyncExternalStore(
    (callback) => {
      const id = setInterval(callback, intervalMs)
      return () => clearInterval(id)
    },
    () => Math.floor(Date.now() / intervalMs)
  )
}

export function ActivityIndicator({ sessionId, className = '', onActivityChange }: ActivityIndicatorProps) {
  // Subscribe to time ticks to re-evaluate activity status
  useCurrentTime(1000)

  // Get session data directly from store
  const session = useTerminalStore((state) =>
    state.sessions.find((s) => s.id === sessionId)
  )

  // Get agent stream state for this terminal (if it's an agent terminal).
  // For multi-turn conversations, new process IDs are created per turn.
  // We check ALL process IDs in the conversation so the sidebar spinner
  // reflects activity from any turn, not just the initial process.
  const agentState = useAgentStreamStore((state) => {
    // Check if this session has a conversation with multiple process IDs
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

    // Fallback: return the initial terminal state
    return state.terminals.get(sessionId)
  })

  const addToast = useToastStore((state) => state.addToast)
  const projects = useProjectStore((state) => state.projects)
  const activeSessionId = useTerminalStore((state) => state.activeSessionId)
  const setProjectNotification = useProjectStore((state) => state.setProjectNotification)
  const previousDisplayStateRef = useRef<'green' | 'yellow' | 'grey' | null>(null)

  // Calculate current display state based on activity (do this before early returns)
  const now = Date.now()
  const timeSinceLastActivity = session ? now - session.lastActivityTime : 0
  const timeSinceSubstantialActivity = session ? now - session.lastSubstantialActivityTime : 0

  let displayState: 'green' | 'yellow' | 'grey' = 'grey'

  if (session && session.status !== 'exited') {
    if (timeSinceSubstantialActivity < IDLE_THRESHOLD_MS) {
      displayState = 'green'
    } else if (timeSinceLastActivity < MINOR_ACTIVITY_THRESHOLD_MS && session.lastActivityLevel === 'minor') {
      displayState = 'yellow'
    } else {
      displayState = 'grey'
    }
  }

  // Determine agent-specific status for agent terminals
  const isAgentTerminal = session?.terminalType === 'agent'
  let agentStatus: AgentStatus = 'idle'

  if (session?.status === 'exited') {
    agentStatus = 'exited'
  } else if (isAgentTerminal && agentState) {
    // Safety net: detect tool execution that's pending even if isActive was reset
    const lastMsg = agentState.messages[agentState.messages.length - 1]
    const isToolExecutionPending = !agentState.processExited && lastMsg?.stopReason === 'tool_use'

    if (agentState.currentMessage || agentState.isWaitingForResponse) {
      // Actively streaming content or waiting for first response
      agentStatus = 'responding'
    } else if (agentState.isActive || isToolExecutionPending) {
      // isActive but no currentMessage = between tool calls (executing tools)
      agentStatus = 'thinking'
    } else if (agentState.error) {
      agentStatus = 'needs-attention'
    } else if (agentState.messages.length > 0) {
      agentStatus = 'done'
    } else {
      agentStatus = 'idle'
    }
  } else if (isAgentTerminal) {
    agentStatus = 'idle'
  }

  // Detect green -> grey transition (ignoring yellow)
  useEffect(() => {
    if (!session) return

    if (previousDisplayStateRef.current === 'green' && displayState === 'grey') {
      const terminalAge = now - session.createdAt
      const isInGracePeriod = terminalAge < NEW_TERMINAL_GRACE_PERIOD_MS
      const isTerminalActive = sessionId === activeSessionId

      if (!isInGracePeriod && !isTerminalActive) {
        const project = projects.find(p => p.id === session.projectId)
        if (project) {
          addToast(`Terminal "${session.title}" in project "${project.name}" is now idle`, 'info', 5000)
          setProjectNotification(session.projectId, {
            type: 'activity',
            count: 1,
            updatedAt: Date.now(),
          })
          if (onActivityChange) {
            onActivityChange(false, sessionId, session.projectId)
          }
        }
      }
    }
    previousDisplayStateRef.current = displayState
  }, [displayState, sessionId, session?.projectId, session?.title, session?.createdAt, now, projects, addToast, onActivityChange, activeSessionId, setProjectNotification, session])

  if (!session) return null

  // Agent terminals get icon-based status indicators
  if (isAgentTerminal) {
    return <AgentStatusIcon status={agentStatus} className={className} />
  }

  // Non-agent terminals keep the original dot indicator
  if (session.status === 'exited') {
    return (
      <span
        className={`w-2 h-2 rounded-full bg-zinc-500 ${className}`}
        title="Exited"
      />
    )
  }

  const colorClass = displayState === 'green' ? 'bg-green-500' : displayState === 'yellow' ? 'bg-yellow-500' : 'bg-zinc-400'
  const title = displayState === 'green' ? 'Active' : displayState === 'yellow' ? 'Minor Activity' : 'Idle'

  return (
    <span
      className={`w-2 h-2 rounded-full ${colorClass} ${className}`}
      title={title}
    />
  )
}

function AgentStatusIcon({ status }: { status: AgentStatus; className?: string }) {
  switch (status) {
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
          className="w-2 h-2 rounded-full bg-zinc-500 shrink-0"
          title="Exited"
        />
      )
    case 'idle':
    default:
      return (
        <span
          className="w-2 h-2 rounded-full bg-zinc-400 shrink-0"
          title="Idle"
        />
      )
  }
}
