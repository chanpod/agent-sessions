import { useSyncExternalStore } from 'react'
import { useTerminalStore } from '../stores/terminal-store'

const IDLE_THRESHOLD_MS = 5000

interface ActivityIndicatorProps {
  sessionId: string
  className?: string
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

export function ActivityIndicator({ sessionId, className = '' }: ActivityIndicatorProps) {
  // Subscribe to time ticks to re-evaluate activity status
  useCurrentTime(1000)

  // Get session data directly from store
  const session = useTerminalStore((state) =>
    state.sessions.find((s) => s.id === sessionId)
  )

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

  return (
    <span
      className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-red-500'} ${className}`}
      title={isActive ? 'Active' : 'Idle'}
    />
  )
}
