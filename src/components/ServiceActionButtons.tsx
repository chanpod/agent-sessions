import { Square, RefreshCw, Play, FileText } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ServiceStatus } from '../stores/service-store'

interface ServiceActionButtonsProps {
  status: ServiceStatus
  serviceType: 'pty' | 'docker-compose'
  onStart?: () => void
  onStop?: () => void
  onRestart?: () => void
  onViewLogs?: () => void
  isLoading?: boolean
  className?: string
}

export function ServiceActionButtons({
  status,
  serviceType,
  onStart,
  onStop,
  onRestart,
  onViewLogs,
  isLoading = false,
  className,
}: ServiceActionButtonsProps) {
  const canStart = status === 'stopped' || status === 'error'
  const canStop = status === 'running' || status === 'starting'
  const canRestart = status === 'running'

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {/* Start button - only for stopped services */}
      {canStart && onStart && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onStart()
          }}
          disabled={isLoading}
          className={cn(
            'p-1 rounded transition-colors',
            isLoading
              ? 'text-zinc-600 cursor-not-allowed'
              : 'text-green-400 hover:text-green-300 hover:bg-zinc-700'
          )}
          title="Start service"
        >
          <Play className="w-3 h-3" />
        </button>
      )}

      {/* Stop button - only for running services */}
      {canStop && onStop && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onStop()
          }}
          disabled={isLoading}
          className={cn(
            'p-1 rounded transition-colors',
            isLoading
              ? 'text-zinc-600 cursor-not-allowed'
              : 'text-yellow-400 hover:text-yellow-300 hover:bg-zinc-700'
          )}
          title="Stop service"
        >
          <Square className="w-3 h-3" />
        </button>
      )}

      {/* Restart button - for running services */}
      {canRestart && onRestart && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRestart()
          }}
          disabled={isLoading}
          className={cn(
            'p-1 rounded transition-colors',
            isLoading
              ? 'text-zinc-600 cursor-not-allowed'
              : 'text-blue-400 hover:text-blue-300 hover:bg-zinc-700'
          )}
          title="Restart service"
        >
          <RefreshCw className={cn('w-3 h-3', isLoading && 'animate-spin')} />
        </button>
      )}

      {/* View logs button - only for docker-compose services */}
      {serviceType === 'docker-compose' && onViewLogs && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onViewLogs()
          }}
          disabled={isLoading}
          className={cn(
            'p-1 rounded transition-colors',
            isLoading
              ? 'text-zinc-600 cursor-not-allowed'
              : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-700'
          )}
          title="View logs"
        >
          <FileText className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
