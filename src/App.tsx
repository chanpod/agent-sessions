import { useEffect, useState, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  DragEndEvent,
  DragStartEvent,
  pointerWithin,
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core'
import { Terminal as TerminalIcon } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { TerminalArea } from './components/TerminalArea'
import { useTerminalStore } from './stores/terminal-store'
import { useProjectStore } from './stores/project-store'
import { useServerStore } from './stores/server-store'
import { useGridStore } from './stores/grid-store'
import { disposeTerminal } from './lib/terminal-registry'

function App() {
  const [isElectron, setIsElectron] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDragTitle, setActiveDragTitle] = useState<string>('')
  const {
    addSession,
    removeSession,
    updateSessionTitle,
    markSessionExited,
    updateSessionActivity,
    saveConfig,
    removeSavedConfig,
    sessions,
  } = useTerminalStore()
  const restoringRef = useRef(false)
  const { projects } = useProjectStore()
  const {
    addServer,
    removeServer,
    updateServerStatus,
    saveConfig: saveServerConfig,
  } = useServerStore()
  const {
    grids,
    activeGridId,
    createGrid,
    addTerminalToGrid,
    moveTerminal,
    reorderInGrid,
    setFocusedTerminal,
    setActiveGrid,
    getGridForTerminal,
  } = useGridStore()
  const { setActiveProject } = useProjectStore()

  // Configure drag sensors with a distance threshold
  // This prevents clicks from being interpreted as drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  )

  useEffect(() => {
    // Check if running in Electron
    setIsElectron(typeof window !== 'undefined' && !!window.electron)
  }, [])

  // Restore saved terminals on startup (runs once)
  useEffect(() => {
    if (!isElectron || !window.electron || restoringRef.current) return

    // Prevent re-entry
    restoringRef.current = true

    // Get configs snapshot from store directly
    const configs = useTerminalStore.getState().savedConfigs
    if (configs.length === 0) return

    console.log(`Restoring ${configs.length} terminals...`)

    // Process all configs
    ;(async () => {
      for (const config of configs) {
        try {
          const info = await window.electron!.pty.create({
            shell: config.shell,
            cwd: config.cwd,
          })

          addSession({
            id: info.id,
            projectId: config.projectId,
            pid: info.pid,
            shell: config.shell,
            shellName: config.shellName,
            cwd: info.cwd,
            title: config.shellName,
            createdAt: Date.now(),
          })

          // Check if terminal already has a grid (from persisted state)
          // If not, create one
          const existingGrid = useGridStore.getState().getGridForTerminal(info.id)
          if (!existingGrid) {
            createGrid(info.id)
          }

          // Remove old config before saving with new session ID
          removeSavedConfig(config.id)
          saveConfig({
            id: info.id,
            projectId: config.projectId,
            shell: config.shell,
            shellName: config.shellName,
            cwd: config.cwd,
          })
        } catch (err) {
          console.error(`Failed to restore terminal ${config.shellName}:`, err)
        }
      }
    })()
  }, [isElectron, addSession, saveConfig, removeSavedConfig, createGrid])

  useEffect(() => {
    if (!isElectron || !window.electron) return

    // Set up PTY event listeners
    const unsubData = window.electron.pty.onData((id) => {
      // Update activity timestamp when terminal receives data
      updateSessionActivity(id)
    })

    const unsubExit = window.electron.pty.onExit((id, code) => {
      markSessionExited(id, code)
    })

    const unsubTitle = window.electron.pty.onTitleChange((id, title) => {
      updateSessionTitle(id, title)
    })

    return () => {
      unsubData()
      unsubExit()
      unsubTitle()
    }
  }, [isElectron, markSessionExited, updateSessionTitle, updateSessionActivity])

  // Keyboard shortcuts: Ctrl+N for project switch, Alt+N for terminal focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10)
      if (isNaN(num) || num < 1 || num > 9) return

      // Ctrl+N: Switch to project N
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        const projectIndex = num - 1
        const project = projects[projectIndex]
        if (project) {
          setActiveProject(project.id)
        }
        return
      }

      // Alt+N: Focus terminal N in active grid
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const activeGrid = grids.find((g) => g.id === activeGridId)
        if (activeGrid) {
          const terminalIndex = num - 1
          const terminalId = activeGrid.terminalIds[terminalIndex]
          if (terminalId) {
            setFocusedTerminal(activeGrid.id, terminalId)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [projects, grids, activeGridId, setActiveProject, setFocusedTerminal])

  const handleCreateTerminal = async (projectId: string, shell: { name: string; path: string }) => {
    if (!window.electron) return

    // Find the project to get its path
    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    const info = await window.electron.pty.create({
      shell: shell.path,
      cwd: project.path,
    })

    // Save config for persistence
    saveConfig({
      id: info.id,
      projectId,
      shell: shell.path,
      shellName: shell.name,
      cwd: project.path,
    })

    addSession({
      id: info.id,
      projectId,
      pid: info.pid,
      shell: shell.path,
      shellName: shell.name,
      cwd: info.cwd,
      title: shell.name,
      createdAt: info.createdAt,
    })

    // Create a new grid for this terminal
    createGrid(info.id)
  }

  const handleCloseTerminal = async (id: string) => {
    if (!window.electron) return

    // Dispose the xterm instance from registry
    disposeTerminal(id)
    await window.electron.pty.kill(id)
    removeSession(id)
  }

  const handleStartServer = async (projectId: string, name: string, command: string) => {
    if (!window.electron) return

    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    const serverId = crypto.randomUUID()

    // Create a PTY for the server
    const info = await window.electron.pty.create({
      cwd: project.path,
    })

    // Save server config for persistence
    saveServerConfig({
      id: serverId,
      projectId,
      name,
      command,
      cwd: project.path,
    })

    // Add the server terminal to sessions so it can be viewed
    addSession({
      id: info.id,
      projectId,
      pid: info.pid,
      shell: '',
      shellName: `Server: ${name}`,
      cwd: project.path,
      title: `Server: ${name}`,
      createdAt: Date.now(),
    })

    // Create a grid for the server terminal
    createGrid(info.id)

    // Add server to store
    addServer({
      id: serverId,
      projectId,
      name,
      command,
      cwd: project.path,
      terminalId: info.id,
      status: 'starting',
      startedAt: Date.now(),
    })

    // Write the command to start the server
    await window.electron.pty.write(info.id, command + '\n')

    // Mark as running after a short delay
    setTimeout(() => {
      updateServerStatus(serverId, 'running')
    }, 500)
  }

  const handleStopServer = async (serverId: string) => {
    if (!window.electron) return

    const { servers } = useServerStore.getState()
    const server = servers.find((s) => s.id === serverId)

    if (server) {
      // Send Ctrl+C to gracefully stop the process, but keep terminal open for logs
      await window.electron.pty.write(server.terminalId, '\x03')
      updateServerStatus(serverId, 'stopped')
    }
  }

  const handleRestartServer = async (serverId: string) => {
    if (!window.electron) return

    const { servers } = useServerStore.getState()
    const server = servers.find((s) => s.id === serverId)

    if (server) {
      const { command } = server

      // Send Ctrl+C to stop current process
      await window.electron.pty.write(server.terminalId, '\x03')

      // Small delay for process to terminate
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Run the command again in the same terminal
      await window.electron.pty.write(server.terminalId, command + '\n')
      updateServerStatus(serverId, 'running')
    }
  }

  const handleDeleteServer = async (serverId: string) => {
    if (!window.electron) return

    const { servers } = useServerStore.getState()
    const server = servers.find((s) => s.id === serverId)

    if (server) {
      // Dispose the xterm instance from registry
      disposeTerminal(server.terminalId)
      // Kill the associated terminal
      await window.electron.pty.kill(server.terminalId)
      // Remove the terminal session
      removeSession(server.terminalId)
      removeServer(serverId)
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    setActiveDragId(active.id as string)
    // Get title from drag data or find session
    const data = active.data.current
    if (data?.terminalTitle) {
      setActiveDragTitle(data.terminalTitle)
    } else {
      const session = sessions.find((s) => s.id === active.id)
      setActiveDragTitle(session?.title || 'Terminal')
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    setActiveDragId(null)
    setActiveDragTitle('')

    if (!over) return

    const draggedId = active.id as string
    const overId = over.id as string
    const overData = over.data.current

    // Get the grid the dragged terminal is currently in
    const sourceGrid = getGridForTerminal(draggedId)

    // Handle dropping on the empty terminal area
    if (overId === 'empty-terminal-area-drop-zone') {
      // If terminal is already in a grid, just make that grid active
      if (sourceGrid) {
        setActiveGrid(sourceGrid.id)
      } else {
        // Create new grid for this terminal
        createGrid(draggedId)
      }
      return
    }

    // Handle dropping on a grid drop zone
    if (overId.startsWith('grid-drop-zone-')) {
      const targetGridId = overData?.gridId as string
      if (!targetGridId) return

      if (sourceGrid && sourceGrid.id !== targetGridId) {
        // Move from one grid to another
        moveTerminal(draggedId, sourceGrid.id, targetGridId)
      } else if (!sourceGrid) {
        // Terminal not in any grid, add to target grid
        addTerminalToGrid(targetGridId, draggedId)
      }
      // If already in target grid, do nothing
      return
    }

    // Handle dropping on another terminal (either in same grid or different grid)
    const targetGrid = getGridForTerminal(overId)

    if (targetGrid) {
      if (sourceGrid && sourceGrid.id === targetGrid.id) {
        // Reordering within the same grid
        const fromIndex = sourceGrid.terminalIds.indexOf(draggedId)
        const toIndex = sourceGrid.terminalIds.indexOf(overId)
        if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {
          reorderInGrid(sourceGrid.id, fromIndex, toIndex)
        }
      } else if (sourceGrid) {
        // Moving from one grid to another by dropping on a terminal
        moveTerminal(draggedId, sourceGrid.id, targetGrid.id)
      } else {
        // Terminal not in any grid, add to target's grid
        addTerminalToGrid(targetGrid.id, draggedId)
      }
    }
  }

  if (!isElectron) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Agent Sessions</h1>
          <p className="text-muted-foreground">
            This app requires Electron to run.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Run <code className="bg-muted px-2 py-1 rounded">npm run dev</code> to start.
          </p>
        </div>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          onCreateTerminal={handleCreateTerminal}
          onCloseTerminal={handleCloseTerminal}
          onStartServer={handleStartServer}
          onStopServer={handleStopServer}
          onRestartServer={handleRestartServer}
          onDeleteServer={handleDeleteServer}
        />
        <TerminalArea />
      </div>
      <DragOverlay>
        {activeDragId ? (
          <div className="drag-overlay flex items-center gap-2">
            <TerminalIcon className="w-4 h-4" />
            <span>{activeDragTitle}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export default App
