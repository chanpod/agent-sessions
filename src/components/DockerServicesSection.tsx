import { useState } from 'react'
import { Container, ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import { useServiceStore, ServiceInfo } from '../stores/service-store'
import { useShallow } from 'zustand/react/shallow'
import { ServiceStatusIndicator } from './ServiceStatusIndicator'
import { ServiceActionButtons } from './ServiceActionButtons'

interface DockerServicesSectionProps {
  projectId: string
  projectPath: string
}

export function DockerServicesSection({ projectId, projectPath: _projectPath }: DockerServicesSectionProps) {
  // _projectPath is reserved for future use (e.g., manual discovery trigger)
  const [isExpanded, setIsExpanded] = useState(true)
  const [loadingServices, setLoadingServices] = useState<Set<string>>(new Set())

  // Use shallow comparison to prevent re-renders when array contents are the same
  const services = useServiceStore(
    useShallow((state) => state.getDockerServices(projectId))
  )
  const dockerAvailable = useServiceStore((state) => state.dockerAvailable)
  const isLoading = useServiceStore((state) => state.loadingProjects.has(projectId))
  const updateServiceStatus = useServiceStore((state) => state.updateServiceStatus)

  // Don't render if Docker is not available or no services found
  if (dockerAvailable === false || services.length === 0) {
    return null
  }

  const handleStart = async (service: ServiceInfo) => {
    if (!window.electron) return

    setLoadingServices((prev) => new Set(prev).add(service.id))
    updateServiceStatus(service.id, 'starting')

    try {
      const result = await window.electron.service.start(service.id)
      if (result.success) {
        // Refresh status after a short delay
        setTimeout(async () => {
          if (!window.electron) return
          const statusResult = await window.electron.service.getStatus(service.id)
          if (statusResult.success) {
            updateServiceStatus(service.id, statusResult.status as any)
          }
        }, 1000)
      } else {
        console.error('Failed to start service:', result.error)
        updateServiceStatus(service.id, 'error')
      }
    } catch (error) {
      console.error('Error starting service:', error)
      updateServiceStatus(service.id, 'error')
    } finally {
      setLoadingServices((prev) => {
        const next = new Set(prev)
        next.delete(service.id)
        return next
      })
    }
  }

  const handleStop = async (service: ServiceInfo) => {
    if (!window.electron) return

    setLoadingServices((prev) => new Set(prev).add(service.id))
    updateServiceStatus(service.id, 'stopping')

    try {
      const result = await window.electron.service.stop(service.id)
      if (result.success) {
        updateServiceStatus(service.id, 'stopped')
      } else {
        console.error('Failed to stop service:', result.error)
        updateServiceStatus(service.id, 'error')
      }
    } catch (error) {
      console.error('Error stopping service:', error)
      updateServiceStatus(service.id, 'error')
    } finally {
      setLoadingServices((prev) => {
        const next = new Set(prev)
        next.delete(service.id)
        return next
      })
    }
  }

  const handleRestart = async (service: ServiceInfo) => {
    if (!window.electron) return

    setLoadingServices((prev) => new Set(prev).add(service.id))
    updateServiceStatus(service.id, 'restarting')

    try {
      const result = await window.electron.service.restart(service.id)
      if (result.success) {
        // Refresh status after a short delay
        setTimeout(async () => {
          if (!window.electron) return
          const statusResult = await window.electron.service.getStatus(service.id)
          if (statusResult.success) {
            updateServiceStatus(service.id, statusResult.status as any)
          }
        }, 1000)
      } else {
        console.error('Failed to restart service:', result.error)
        updateServiceStatus(service.id, 'error')
      }
    } catch (error) {
      console.error('Error restarting service:', error)
      updateServiceStatus(service.id, 'error')
    } finally {
      setLoadingServices((prev) => {
        const next = new Set(prev)
        next.delete(service.id)
        return next
      })
    }
  }

  const handleViewLogs = async (service: ServiceInfo) => {
    if (!window.electron) return

    try {
      const result = await window.electron.docker.getLogs(service.id, 100)
      if (result.success) {
        // For now, log to console - in the future, could show in a modal or terminal
        console.log(`Logs for ${service.name}:`, result.logs)
        // TODO: Show logs in a modal or dedicated panel
      } else {
        console.error('Failed to get logs:', result.error)
      }
    } catch (error) {
      console.error('Error getting logs:', error)
    }
  }

  return (
    <div className="mt-2">
      {/* Section Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
      >
        <ChevronRight
          className={cn(
            'w-3 h-3 transition-transform',
            isExpanded && 'rotate-90'
          )}
        />
        <Container className="w-3.5 h-3.5 text-blue-400" />
        <span className="font-medium">Docker Compose</span>
        <span className="text-zinc-600">({services.length})</span>
        {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-zinc-500" />}
      </button>

      {/* Services List */}
      {isExpanded && (
        <ul className="ml-4 space-y-0.5">
          {services.map((service) => (
            <DockerServiceItem
              key={service.id}
              service={service}
              isLoading={loadingServices.has(service.id)}
              onStart={() => handleStart(service)}
              onStop={() => handleStop(service)}
              onRestart={() => handleRestart(service)}
              onViewLogs={() => handleViewLogs(service)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface DockerServiceItemProps {
  service: ServiceInfo
  isLoading: boolean
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onViewLogs: () => void
}

function DockerServiceItem({
  service,
  isLoading,
  onStart,
  onStop,
  onRestart,
  onViewLogs,
}: DockerServiceItemProps) {
  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors group',
          'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <ServiceStatusIndicator status={service.status} size="sm" />
        <Container className="w-3.5 h-3.5 flex-shrink-0 text-blue-400/70" />
        <span className="truncate flex-1">{service.name}</span>

        {/* Status label */}
        <span className="text-[10px] text-zinc-600">{service.status}</span>

        {/* Action buttons - show on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <ServiceActionButtons
            status={service.status}
            serviceType="docker-compose"
            onStart={onStart}
            onStop={onStop}
            onRestart={onRestart}
            onViewLogs={onViewLogs}
            isLoading={isLoading}
          />
        </div>
      </div>
    </li>
  )
}
