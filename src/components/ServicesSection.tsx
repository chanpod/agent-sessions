import { useState, useEffect, useCallback, useMemo } from 'react'
import { useServerStore, type ServerInstance } from '@/stores/server-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useViewStore } from '@/stores/view-store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  IconRefresh,
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconX,
  IconTerminal2,
  IconCircleFilled,
} from '@tabler/icons-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScriptInfo {
  name: string
  command: string
}

interface PackageScripts {
  packagePath: string
  packageName?: string
  scripts: ScriptInfo[]
  packageManager?: string
}

interface ServicesSectionProps {
  projectId: string
  projectPath: string
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_THEN_DELETE_DELAY_MS = 500

function statusDotClass(status: ServerInstance['status']): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'text-emerald-400'
    case 'stopped':
      return 'text-zinc-500'
    case 'error':
      return 'text-red-400'
    default:
      return 'text-zinc-500'
  }
}

function statusLabel(status: ServerInstance['status']): string | null {
  switch (status) {
    case 'stopped':
      return '(exited)'
    case 'error':
      return '(error)'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ServiceRow({
  server,
  projectId,
  onStopServer,
  onDeleteServer,
}: {
  server: ServerInstance
  projectId: string
  onStopServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}) {
  const isActive = server.status === 'running' || server.status === 'starting'

  const handleClick = useCallback(() => {
    useViewStore.getState().setTerminalDockOpen(true)
    useTerminalStore.getState().setActiveSession(server.terminalId)
    useViewStore.getState().setProjectTerminalActive(projectId, server.terminalId)
  }, [server.terminalId, projectId])

  const handleViewTerminal = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleClick()
    },
    [handleClick],
  )

  const handleStop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onStopServer(server.id)
    },
    [server.id, onStopServer],
  )

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isActive) {
        onStopServer(server.id)
        setTimeout(() => onDeleteServer(server.id), STOP_THEN_DELETE_DELAY_MS)
      } else {
        onDeleteServer(server.id)
      }
    },
    [server.id, isActive, onStopServer, onDeleteServer],
  )

  const label = statusLabel(server.status)

  return (
    <div
      className="group flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1.5 transition-colors hover:bg-card/80"
      onClick={handleClick}
    >
      {/* Status dot */}
      <IconCircleFilled
        size={8}
        className={`shrink-0 ${statusDotClass(server.status)} ${server.status === 'starting' ? 'animate-pulse' : ''}`}
      />

      {/* Name + optional exit label */}
      <span className="flex-1 truncate text-sm font-medium text-foreground">
        {server.name}
        {label && (
          <span className="ml-1.5 text-[10px] text-muted-foreground">{label}</span>
        )}
      </span>

      {/* Hover-revealed action buttons */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleViewTerminal}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="View terminal"
        >
          <IconTerminal2 size={14} />
        </button>

        {isActive && (
          <button
            onClick={handleStop}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Stop server"
          >
            <IconPlayerStop size={14} />
          </button>
        )}

        <button
          onClick={handleClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="Remove service"
        >
          <IconX size={14} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom Command Form (shown inside the popover)
// ---------------------------------------------------------------------------

function CustomCommandForm({
  onSubmit,
}: {
  onSubmit: (name: string, command: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')

  const handleRun = useCallback(() => {
    const trimmedCommand = command.trim()
    if (!trimmedCommand) return
    const displayName = name.trim() || trimmedCommand.split(' ').slice(0, 2).join(' ')
    onSubmit(displayName, trimmedCommand)
    setName('')
    setCommand('')
    setOpen(false)
  }, [name, command, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleRun()
      }
    },
    [handleRun],
  )

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
      >
        <IconTerminal2 size={14} className="text-muted-foreground" />
        Custom Command
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (optional)"
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        onKeyDown={handleKeyDown}
      />
      <input
        type="text"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="e.g. node server.js"
        className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <button
        onClick={handleRun}
        disabled={!command.trim()}
        className="self-end rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground transition-opacity disabled:opacity-50"
      >
        Run
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Script Picker Popover Content
// ---------------------------------------------------------------------------

function ScriptPickerContent({
  packages,
  projectName,
  onSelect,
}: {
  packages: PackageScripts[]
  projectName: string | undefined
  onSelect: (name: string, command: string) => void
}) {
  const handleScriptSelect = useCallback(
    (script: ScriptInfo, pkg: PackageScripts) => {
      const pm = pkg.packageManager ?? 'npm'
      const command = `${pm} run ${script.name}`
      onSelect(script.name, command)
    },
    [onSelect],
  )

  if (packages.length === 0) {
    return (
      <div className="flex flex-col">
        <div className="px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Run Script
        </div>
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
          No scripts found
        </div>
        <Separator />
        <CustomCommandForm onSubmit={onSelect} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Run Script
      </div>
      <ScrollArea className="max-h-80">
        {packages.map((pkg, idx) => {
          const isRoot = pkg.packagePath === '.'
          const displayName = isRoot
            ? pkg.packageName ?? projectName ?? 'root'
            : pkg.packagePath

          return (
            <div key={pkg.packagePath}>
              {idx > 0 && <Separator />}

              {/* Package header */}
              <div className="flex items-center bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="truncate">{displayName}</span>
                {pkg.packageManager && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {pkg.packageManager}
                  </span>
                )}
              </div>

              {/* Script items */}
              {pkg.scripts.map((script) => (
                <button
                  key={`${pkg.packagePath}:${script.name}`}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                  onClick={() => handleScriptSelect(script, pkg)}
                >
                  <IconPlayerPlay size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{script.name}</span>
                </button>
              ))}
            </div>
          )
        })}
      </ScrollArea>

      <Separator />
      <CustomCommandForm onSubmit={onSelect} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ServicesSection({
  projectId,
  projectPath,
  onStartServer,
  onStopServer,
  onDeleteServer,
}: ServicesSectionProps) {
  const [packages, setPackages] = useState<PackageScripts[]>([])
  const [projectName, setProjectName] = useState<string | undefined>()
  const [scanning, setScanning] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const allServers = useServerStore((s) => s.servers)
  const servers = useMemo(
    () => allServers.filter((s) => s.projectId === projectId),
    [allServers, projectId],
  )

  // -----------------------------------------------------------------------
  // Script fetching
  // -----------------------------------------------------------------------

  const fetchScripts = useCallback(async () => {
    setScanning(true)
    try {
      const result = await window.electron!.project.getScripts(projectPath, projectId)
      if (result.packages && result.packages.length > 0) {
        setPackages(result.packages)
      } else if (result.scripts && result.scripts.length > 0) {
        // Fallback: wrap top-level scripts as a single root package
        setPackages([
          {
            packagePath: '.',
            packageName: result.projectName,
            scripts: result.scripts,
            packageManager: result.packageManager,
          },
        ])
      } else {
        setPackages([])
      }
      setProjectName(result.projectName)
    } catch {
      setPackages([])
    } finally {
      setScanning(false)
      setHasFetched(true)
    }
  }, [projectPath, projectId])

  useEffect(() => {
    fetchScripts()
  }, [fetchScripts])

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleRescan = useCallback(() => {
    if (!scanning) fetchScripts()
  }, [scanning, fetchScripts])

  const handleScriptSelect = useCallback(
    (name: string, command: string) => {
      onStartServer(projectId, name, command)
      setPopoverOpen(false)
    },
    [projectId, onStartServer],
  )

  // -----------------------------------------------------------------------
  // Visibility: hide until we know there's something to show
  // -----------------------------------------------------------------------

  const hasScripts = packages.length > 0
  const hasServers = servers.length > 0

  if (!hasFetched && !hasServers) return null
  if (hasFetched && !hasScripts && !hasServers) return null

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-1.5">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Services
        </span>

        <div className="flex items-center gap-0.5">
          {/* Rescan button */}
          <button
            onClick={handleRescan}
            disabled={scanning}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Rescan scripts"
          >
            <IconRefresh size={14} className={scanning ? 'animate-spin' : ''} />
          </button>

          {/* Add / script picker */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="Run script"
            >
              <IconPlus size={14} />
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" side="right" align="start">
              <ScriptPickerContent
                packages={packages}
                projectName={projectName}
                onSelect={handleScriptSelect}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Service rows */}
      {servers.map((server) => (
        <ServiceRow
          key={server.id}
          server={server}
          projectId={projectId}
          onStopServer={onStopServer}
          onDeleteServer={onDeleteServer}
        />
      ))}
    </div>
  )
}
