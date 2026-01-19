import { useSyncExternalStore, useEffect, useRef } from 'react'
import { useTerminalStore } from '../stores/terminal-store'
import { useToastStore } from '../stores/toast-store'
import { useProjectStore } from '../stores/project-store'

const IDLE_THRESHOLD_MS = 5000

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
  const triggerProjectFlash = useProjectStore((state) => state.triggerProjectFlash)
  const previousActivityRef = useRef<boolean | null>(null)

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

  // Calculate activity status on each render
  const lastActivity = session.lastActivityTime ?? 0
  const elapsed = Date.now() - lastActivity
  const isActive = elapsed < IDLE_THRESHOLD_MS

  // Detect activity state change (active -> idle transition)
  useEffect(() => {
    if (previousActivityRef.current !== null && previousActivityRef.current && !isActive) {
      // Terminal went from active to idle
      const project = projects.find(p => p.id === session.projectId)
      if (project) {
        addToast(`Terminal "${session.title}" in project "${project.name}" is now idle`, 'info', 5000)

        // Trigger project flash if this project is not currently active
        if (session.projectId !== activeProjectId) {
          triggerProjectFlash(session.projectId)
        }

        // Call the callback if provided
        if (onActivityChange) {
          onActivityChange(false, sessionId, session.projectId)
        }
      }
    }
    previousActivityRef.current = isActive
  }, [isActive, sessionId, session.projectId, session.title, projects, addToast, onActivityChange, activeProjectId, triggerProjectFlash])

  return (
    <span
      className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-zinc-400'} ${className}`}
      title={isActive ? 'Active' : 'Idle'}
    />
  )
}
