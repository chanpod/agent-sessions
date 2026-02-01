import { cn } from '../lib/utils'
import type { ServiceStatus } from '../stores/service-store'

interface ServiceStatusIndicatorProps {
  status: ServiceStatus
  size?: 'sm' | 'md'
  showLabel?: boolean
  className?: string
}

const statusConfig: Record<ServiceStatus, { color: string; bgColor: string; label: string; pulse?: boolean }> = {
  stopped: { color: 'text-zinc-500', bgColor: 'bg-zinc-500', label: 'Stopped' },
  starting: { color: 'text-yellow-500', bgColor: 'bg-yellow-500', label: 'Starting', pulse: true },
  running: { color: 'text-green-500', bgColor: 'bg-green-500', label: 'Running' },
  stopping: { color: 'text-yellow-500', bgColor: 'bg-yellow-500', label: 'Stopping', pulse: true },
  restarting: { color: 'text-blue-500', bgColor: 'bg-blue-500', label: 'Restarting', pulse: true },
  error: { color: 'text-red-500', bgColor: 'bg-red-500', label: 'Error' },
  unknown: { color: 'text-zinc-600', bgColor: 'bg-zinc-600', label: 'Unknown' },
}

export function ServiceStatusIndicator({
  status,
  size = 'sm',
  showLabel = false,
  className,
}: ServiceStatusIndicatorProps) {
  const config = statusConfig[status] || statusConfig.unknown

  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'rounded-full',
          dotSize,
          config.bgColor,
          config.pulse && 'animate-pulse'
        )}
      />
      {showLabel && (
        <span className={cn('text-xs', config.color)}>
          {config.label}
        </span>
      )}
    </div>
  )
}
