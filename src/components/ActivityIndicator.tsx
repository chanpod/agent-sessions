import { useSyncExternalStore, useEffect, useRef } from 'react'
import { useTerminalStore, type ActivityLevel } from '../stores/terminal-store'
import { useToastStore } from '../stores/toast-store'
import { useProjectStore } from '../stores/project-store'

const IDLE_THRESHOLD_MS = 5000
const MINOR_ACTIVITY_THRESHOLD_MS = 5000 // Yellow goes to grey after 5s
const NEW_TERMINAL_GRACE_PERIOD_MS = 10000 // Don't notify for 10s after terminal creation

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

  const addToast = useToastStore((state) => state.addToast)
  const projects = useProjectStore((state) => state.projects)
  const activeProjectId = useProjectStore((state) => state.activeProjectId)
  const activeSessionId = useTerminalStore((state) => state.activeSessionId)
  const triggerProjectFlash = useProjectStore((state) => state.triggerProjectFlash)
  const previousDisplayStateRef = useRef<'green' | 'yellow' | 'grey' | null>(null)

  // Calculate current display state based on activity (do this before early returns)
  const now = Date.now()
  const timeSinceLastActivity = session ? now - session.lastActivityTime : 0
  const timeSinceSubstantialActivity = session ? now - session.lastSubstantialActivityTime : 0

  let displayState: 'green' | 'yellow' | 'grey' = 'grey'

  if (session && session.status !== 'exited') {
    // Determine color based on recent activity
    if (timeSinceSubstantialActivity < IDLE_THRESHOLD_MS) {
      // Had substantial activity recently -> green
      displayState = 'green'
    } else if (timeSinceLastActivity < MINOR_ACTIVITY_THRESHOLD_MS && session.lastActivityLevel === 'minor') {
      // Had minor activity recently (no substantial activity) -> yellow
      displayState = 'yellow'
    } else {
      // No recent activity -> grey
      displayState = 'grey'
    }
  }

  // Detect green -> grey transition (ignoring yellow)
  useEffect(() => {
    if (!session) return

    if (previousDisplayStateRef.current === 'green' && displayState === 'grey') {
      // Check if terminal is still in grace period (newly created)
      const terminalAge = now - session.createdAt
      const isInGracePeriod = terminalAge < NEW_TERMINAL_GRACE_PERIOD_MS

      // Check if this terminal is currently being viewed by the user
      const isTerminalActive = sessionId === activeSessionId

      console.log('[Activity] Green->Grey transition:', {
        terminalId: sessionId,
        activeSessionId,
        projectId: session.projectId,
        activeProjectId,
        isTerminalActive,
        isInGracePeriod,
        willNotify: !isInGracePeriod && !isTerminalActive
      })

      if (!isInGracePeriod && !isTerminalActive) {
        // Terminal went from substantial activity (green) to idle (grey)
        // Only notify if the project is NOT currently active (user isn't watching it)
        const project = projects.find(p => p.id === session.projectId)
        if (project) {
          addToast(`Terminal "${session.title}" in project "${project.name}" is now idle`, 'info', 5000)

          // Trigger project flash
          triggerProjectFlash(session.projectId)

          // Call the callback if provided
          if (onActivityChange) {
            onActivityChange(false, sessionId, session.projectId)
          }
        }
      }
    }
    previousDisplayStateRef.current = displayState
  }, [displayState, sessionId, session?.projectId, session?.title, session?.createdAt, now, projects, addToast, onActivityChange, activeSessionId, triggerProjectFlash, session])

  if (!session) return null

  // If session has exited, show gray
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
