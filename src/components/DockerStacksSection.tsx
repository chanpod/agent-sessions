import { useState, useEffect, useCallback } from 'react'
import { Layers, ChevronRight, RefreshCw, Container, AlertCircle, Play, Square, ArrowDownToLine } from 'lucide-react'
import { cn } from '../lib/utils'
import { ServiceStatusIndicator } from './ServiceStatusIndicator'
import type { ServiceStatus } from '../stores/service-store'

interface DockerStacksSectionProps {
  projectPath: string
}

interface DockerStack {
  name: string
  status: string
  configFiles: string
}

interface DockerContainer {
  name: string
  service: string
  state: string
  status: string
  ports: string
  image: string
}

function parseStackStatus(status: string): { running: number; total: number } {
  // Status looks like "running(3)" or "exited(0)" or "running(2), exited(1)"
  let running = 0
  let total = 0
  const matches = status.matchAll(/(\w+)\((\d+)\)/g)
  for (const match of matches) {
    const countStr = match[2]
    if (!countStr) continue
    const count = parseInt(countStr, 10)
    total += count
    if (match[1] === 'running') {
      running = count
    }
  }
  return { running, total }
}

function containerStateToServiceStatus(state: string): ServiceStatus {
  const s = state.toLowerCase()
  if (s === 'running') return 'running'
  if (s === 'exited' || s === 'dead') return 'stopped'
  if (s === 'restarting') return 'restarting'
  if (s === 'paused' || s === 'created') return 'stopped'
  return 'unknown'
}

function stackStatusSummary(status: string): ServiceStatus {
  const { running, total } = parseStackStatus(status)
  if (total === 0) return 'stopped'
  if (running === total) return 'running'
  if (running > 0) return 'running' // partial
  return 'stopped'
}

export function DockerStacksSection({ projectPath }: DockerStacksSectionProps) {
  const [stacks, setStacks] = useState<DockerStack[]>([])
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set())
  const [containersByStack, setContainersByStack] = useState<Record<string, DockerContainer[]>>({})
  const [loadingContainers, setLoadingContainers] = useState<Set<string>>(new Set())
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStacks = useCallback(async () => {
    if (!window.electron) return

    setIsLoading(true)
    setError(null)

    try {
      // Check Docker availability first
      const availResult = await window.electron.docker.isAvailable(projectPath)
      setDockerAvailable(availResult.available)

      if (!availResult.available) {
        setStacks([])
        return
      }

      const result = await window.electron.docker.listStacks(projectPath)
      if (result.success) {
        setStacks(result.stacks)
      } else {
        setError(result.error || 'Failed to list stacks')
        setStacks([])
      }
    } catch (err) {
      console.error('[DockerStacksSection] Failed to load stacks:', err)
      setError('Failed to communicate with Docker')
      setStacks([])
    } finally {
      setIsLoading(false)
    }
  }, [projectPath])

  // Load stacks on mount
  useEffect(() => {
    loadStacks()
  }, [loadStacks])

  const loadContainers = useCallback(async (stackName: string) => {
    if (!window.electron) return

    setLoadingContainers((prev) => new Set(prev).add(stackName))

    try {
      const result = await window.electron.docker.getStackContainers(stackName, projectPath)
      if (result.success) {
        setContainersByStack((prev) => ({ ...prev, [stackName]: result.containers }))
      } else {
        console.error(`[DockerStacksSection] Failed to get containers for ${stackName}:`, result.error)
        setContainersByStack((prev) => ({ ...prev, [stackName]: [] }))
      }
    } catch (err) {
      console.error(`[DockerStacksSection] Error getting containers for ${stackName}:`, err)
      setContainersByStack((prev) => ({ ...prev, [stackName]: [] }))
    } finally {
      setLoadingContainers((prev) => {
        const next = new Set(prev)
        next.delete(stackName)
        return next
      })
    }
  }, [projectPath])

  const toggleStack = useCallback((stackName: string) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev)
      if (next.has(stackName)) {
        next.delete(stackName)
      } else {
        next.add(stackName)
        // Lazy-load containers on first expand
        if (!containersByStack[stackName]) {
          loadContainers(stackName)
        }
      }
      return next
    })
  }, [containersByStack, loadContainers])

  const runStackAction = useCallback(async (
    stackName: string,
    configFiles: string,
    action: 'up' | 'stop' | 'down' | 'restart'
  ) => {
    if (!window.electron) return

    setLoadingActions((prev) => new Set(prev).add(stackName))

    try {
      const docker = window.electron.docker
      let result: { success: boolean; error?: string }
      switch (action) {
        case 'up':
          result = await docker.upStack(stackName, configFiles, projectPath)
          break
        case 'stop':
          result = await docker.stopStack(stackName, configFiles, projectPath)
          break
        case 'down':
          result = await docker.downStack(stackName, configFiles, projectPath)
          break
        case 'restart':
          result = await docker.restartStack(stackName, configFiles, projectPath)
          break
      }

      if (!result.success) {
        console.error(`[DockerStacksSection] ${action} failed for ${stackName}:`, result.error)
      }

      // Refresh stacks and containers after action
      await loadStacks()
      if (expandedStacks.has(stackName)) {
        loadContainers(stackName)
      }
    } catch (err) {
      console.error(`[DockerStacksSection] Error running ${action} on ${stackName}:`, err)
    } finally {
      setLoadingActions((prev) => {
        const next = new Set(prev)
        next.delete(stackName)
        return next
      })
    }
  }, [projectPath, loadStacks, expandedStacks, loadContainers])

  // Don't render if Docker isn't available (defensive)
  if (dockerAvailable === false) {
    return null
  }

  // Don't render anything until we've checked Docker and found no stacks (and no error)
  if (dockerAvailable === null && !isLoading) {
    return null
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
        <Layers className="w-3.5 h-3.5 text-blue-400" />
        <span className="font-medium">Docker Stacks</span>
        <span className="text-zinc-600">({stacks.length})</span>
        {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-zinc-500" />}
        {/* Refresh button */}
        {!isLoading && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              loadStacks()
            }}
            className="ml-auto p-0.5 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
            title="Refresh stacks"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </button>

      {/* Error state */}
      {error && isExpanded && (
        <div className="ml-6 px-2 py-1 text-[10px] text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Stacks List */}
      {isExpanded && !error && (
        <ul className="ml-4 space-y-0.5">
          {stacks.length === 0 && !isLoading && (
            <li className="px-2 py-1 text-[10px] text-zinc-600">No stacks found</li>
          )}
          {stacks.map((stack) => (
            <StackItem
              key={stack.name}
              stack={stack}
              isExpanded={expandedStacks.has(stack.name)}
              onToggle={() => toggleStack(stack.name)}
              containers={containersByStack[stack.name]}
              isLoadingContainers={loadingContainers.has(stack.name)}
              isLoadingAction={loadingActions.has(stack.name)}
              onRefreshContainers={() => loadContainers(stack.name)}
              onUp={() => runStackAction(stack.name, stack.configFiles, 'up')}
              onStop={() => runStackAction(stack.name, stack.configFiles, 'stop')}
              onDown={() => runStackAction(stack.name, stack.configFiles, 'down')}
              onRestart={() => runStackAction(stack.name, stack.configFiles, 'restart')}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface StackItemProps {
  stack: DockerStack
  isExpanded: boolean
  onToggle: () => void
  containers?: DockerContainer[]
  isLoadingContainers: boolean
  isLoadingAction: boolean
  onRefreshContainers: () => void
  onUp: () => void
  onStop: () => void
  onDown: () => void
  onRestart: () => void
}

function StackItem({
  stack,
  isExpanded,
  onToggle,
  containers,
  isLoadingContainers,
  isLoadingAction,
  onRefreshContainers,
  onUp,
  onStop,
  onDown,
  onRestart,
}: StackItemProps) {
  const { running, total } = parseStackStatus(stack.status)
  const summaryStatus = stackStatusSummary(stack.status)
  const isStopped = summaryStatus === 'stopped'
  const isRunning = summaryStatus === 'running'

  return (
    <li>
      {/* Stack row */}
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors group',
          'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0">
          <ChevronRight
            className={cn(
              'w-3 h-3 flex-shrink-0 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
          <ServiceStatusIndicator status={summaryStatus} size="sm" />
          <Layers className="w-3.5 h-3.5 flex-shrink-0 text-blue-400/70" />
          <span className="truncate flex-1 text-left">{stack.name}</span>
          <span className="text-[10px] text-zinc-600">{running}/{total}</span>
        </button>

        {/* Action buttons — show on hover */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          {isLoadingAction ? (
            <RefreshCw className="w-3 h-3 animate-spin text-zinc-500" />
          ) : (
            <>
              {/* Start (up) — for stopped stacks */}
              {isStopped && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUp() }}
                  className="p-1 rounded text-green-400 hover:text-green-300 hover:bg-zinc-700 transition-colors"
                  title="Start stack (up -d)"
                >
                  <Play className="w-3 h-3" />
                </button>
              )}
              {/* Stop — for running stacks */}
              {isRunning && (
                <button
                  onClick={(e) => { e.stopPropagation(); onStop() }}
                  className="p-1 rounded text-yellow-400 hover:text-yellow-300 hover:bg-zinc-700 transition-colors"
                  title="Stop stack"
                >
                  <Square className="w-3 h-3" />
                </button>
              )}
              {/* Restart — for running stacks */}
              {isRunning && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRestart() }}
                  className="p-1 rounded text-blue-400 hover:text-blue-300 hover:bg-zinc-700 transition-colors"
                  title="Restart stack"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
              {/* Down — always available (tears down containers) */}
              <button
                onClick={(e) => { e.stopPropagation(); onDown() }}
                className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-zinc-700 transition-colors"
                title="Down stack (remove containers)"
              >
                <ArrowDownToLine className="w-3 h-3" />
              </button>
              {/* Refresh containers */}
              {isExpanded && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRefreshContainers() }}
                  className="p-1 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-700 transition-colors"
                  title="Refresh containers"
                >
                  <RefreshCw className={cn('w-3 h-3', isLoadingContainers && 'animate-spin')} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Containers list */}
      {isExpanded && (
        <ul className="ml-6 space-y-0.5">
          {isLoadingContainers && !containers && (
            <li className="px-2 py-1 text-[10px] text-zinc-600 flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Loading containers...
            </li>
          )}
          {containers && containers.length === 0 && (
            <li className="px-2 py-1 text-[10px] text-zinc-600">No containers</li>
          )}
          {containers?.map((container) => (
            <ContainerItem key={container.name} container={container} />
          ))}
        </ul>
      )}
    </li>
  )
}

interface ContainerItemProps {
  container: DockerContainer
}

function ContainerItem({ container }: ContainerItemProps) {
  const serviceStatus = containerStateToServiceStatus(container.state)

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors',
          'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <ServiceStatusIndicator status={serviceStatus} size="sm" />
        <Container className="w-3 h-3 flex-shrink-0 text-zinc-500" />
        <span className="truncate flex-1">{container.service || container.name}</span>
        <span className="text-[10px] text-zinc-600 truncate max-w-[100px]" title={container.status}>
          {container.status}
        </span>
      </div>
    </li>
  )
}
