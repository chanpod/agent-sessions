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
import { UpdateNotification } from './components/UpdateNotification'
import { FileSearchModal } from './components/FileSearchModal'
import { ReviewPanel } from './components/ReviewPanel'
import { useTerminalStore } from './stores/terminal-store'
import { useProjectStore } from './stores/project-store'
import { useServerStore } from './stores/server-store'
import { useGridStore } from './stores/grid-store'
import { useSSHStore } from './stores/ssh-store'
import { useFileSearchStore } from './stores/file-search-store'
import { disposeTerminal, clearTerminal } from './lib/terminal-registry'
import { useDetectedServers } from './hooks/useDetectedServers'

function App() {
  const [isElectron, setIsElectron] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDragTitle, setActiveDragTitle] = useState<string>('')
  const {
    addSession,
    addSessionsBatch,
    removeSession,
    updateSessionTitle,
    updateSessionPid,
    markSessionExited,
    updateSessionActivity,
    saveConfig,
    removeSavedConfig,
    sessions,
  } = useTerminalStore()
  const restoringRef = useRef(false)
  const { projects } = useProjectStore()
  const { getConnection } = useSSHStore()
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
  const { setActiveProject, activeProjectId } = useProjectStore()
  const { openSearch } = useFileSearchStore()

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

  // Listen for detected servers from terminal output
  useDetectedServers()

  // Restore saved terminals on startup (runs once)
  useEffect(() => {
    if (!isElectron || !window.electron || restoringRef.current) return

    // Prevent re-entry
    restoringRef.current = true

    // Get configs snapshot from store directly
    const configs = useTerminalStore.getState().savedConfigs
    if (configs.length === 0) return

    console.log(`Restoring ${configs.length} terminals...`)

    // Process all configs and batch the additions
    ;(async () => {
      // Step 1: Establish SSH connections for SSH projects FIRST
      const sshProjectConnections = new Set<string>()

      // Identify unique SSH projects that need connections
      for (const config of configs) {
        const project = projects.find((p) => p.id === config.projectId)
        if (project?.isSSHProject && project.sshConnectionId) {
          sshProjectConnections.add(project.sshConnectionId)
        }
      }

      // Establish all SSH connections in parallel
      if (sshProjectConnections.size > 0) {
        console.log(`Establishing ${sshProjectConnections.size} SSH connections...`)
        await Promise.all(
          Array.from(sshProjectConnections).map(async (connectionId) => {
            const connection = getConnection(connectionId)
            if (connection) {
              try {
                const result = await window.electron!.ssh.connect(connection)
                if (result.success) {
                  console.log(`SSH connection established: ${connection.name}`)
                } else {
                  console.error(`Failed to establish SSH connection to ${connection.name}:`, result.error)
                }
              } catch (err) {
                console.error(`Error connecting to ${connection.name}:`, err)
              }
            }
          })
        )
      }

      // Step 2: Now restore terminals with connections ready
      const sessionsToAdd: Parameters<typeof addSession>[0][] = []
      const configUpdates: { oldId: string; newConfig: Parameters<typeof saveConfig>[0] }[] = []
      const gridsToCreate: string[] = []

      for (const config of configs) {
        try {
          let info

          // Check if this config has an SSH connection
          if (config.sshConnectionId) {
            // SSH terminal - use SSH connection ID
            info = await window.electron!.pty.create({
              sshConnectionId: config.sshConnectionId,
              remoteCwd: config.cwd || undefined,
            })
          } else {
            // Local terminal
            info = await window.electron!.pty.create({
              shell: config.shell,
              cwd: config.cwd,
            })
          }

          sessionsToAdd.push({
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
          const existingGrid = useGridStore.getState().getGridForTerminal(info.id)
          if (!existingGrid) {
            gridsToCreate.push(info.id)
          }

          configUpdates.push({
            oldId: config.id,
            newConfig: {
              id: info.id,
              projectId: config.projectId,
              shell: config.shell,
              shellName: config.shellName,
              cwd: config.cwd,
              sshConnectionId: config.sshConnectionId,
            },
          })
        } catch (err) {
          console.error(`Failed to restore terminal ${config.shellName}:`, err)
        }
      }

      // Batch add all sessions at once
      if (sessionsToAdd.length > 0) {
        addSessionsBatch(sessionsToAdd)
      }

      // Create grids for terminals that need them
      for (const terminalId of gridsToCreate) {
        createGrid(terminalId)
      }

      // Update configs
      for (const { oldId, newConfig } of configUpdates) {
        removeSavedConfig(oldId)
        saveConfig(newConfig)
      }
    })()
  }, [isElectron, addSessionsBatch, saveConfig, removeSavedConfig, createGrid, projects, getConnection])

  useEffect(() => {
    if (!isElectron || !window.electron) return

    // Set up PTY event listeners
    const unsubData = window.electron.pty.onData((id) => {
      // Update activity timestamp when terminal receives data
      updateSessionActivity(id)
    })

    const unsubExit = window.electron.pty.onExit((id, code) => {
      markSessionExited(id, code)

      // Check if this terminal belongs to a server
      const { servers } = useServerStore.getState()
      const server = servers.find((s) => s.terminalId === id)

      if (server) {
        // Server process died - mark as error if non-zero exit, stopped if clean exit
        const newStatus = code !== 0 ? 'error' : 'stopped'
        updateServerStatus(server.id, newStatus)
        console.log(`[App] Server "${server.name}" process exited with code ${code}, marked as ${newStatus}`)
      }
    })

    const unsubTitle = window.electron.pty.onTitleChange((id, title) => {
      updateSessionTitle(id, title)
    })

    return () => {
      unsubData()
      unsubExit()
      unsubTitle()
    }
  }, [isElectron, markSessionExited, updateSessionTitle, updateSessionActivity, updateServerStatus])

  // Keyboard shortcuts: Ctrl+P for file search, Ctrl+N for project switch, Alt+N for terminal focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+P / Cmd+P: Open file search
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        openSearch()
        return
      }

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
  }, [projects, grids, activeGridId, setActiveProject, setFocusedTerminal, openSearch])

  const handleCreateTerminal = async (projectId: string, shell: { name: string; path: string }) => {
    if (!window.electron) return

    // Find the project to get its path
    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    console.log('[handleCreateTerminal] Project:', project.name, 'isSSHProject:', project.isSSHProject, 'sshConnectionId:', project.sshConnectionId)

    let info
    let sessionSshConnectionId: string | undefined = undefined

    // Check if this is an SSH project
    if (project.isSSHProject && project.sshConnectionId) {
      const sshConnection = getConnection(project.sshConnectionId)

      if (!sshConnection) {
        console.error('SSH connection not found:', project.sshConnectionId)
        alert(`SSH connection not found for project ${project.name}`)
        return
      }

      // Connect to SSH if not already connected
      const connectResult = await window.electron.ssh.connect(sshConnection)
      if (!connectResult.success) {
        console.error('Failed to establish SSH connection:', connectResult.error)
        alert(`Failed to connect to ${sshConnection.name}: ${connectResult.error}`)
        return
      }

      // Create terminal with SSH using the project's remote path
      info = await window.electron.pty.create({
        sshConnectionId: project.sshConnectionId,
        remoteCwd: project.remotePath || undefined,
      })

      sessionSshConnectionId = project.sshConnectionId

      // Save config for persistence
      saveConfig({
        id: info.id,
        projectId,
        shell: 'ssh',
        shellName: shell.name,
        cwd: project.remotePath || '~',
        sshConnectionId: project.sshConnectionId,
      })
    } else if (shell.path.startsWith('ssh:')) {
      // User manually selected an SSH connection from shell dropdown (for non-SSH projects)
      const sshConnectionId = shell.path.substring(4) // Remove "ssh:" prefix
      const sshConnection = getConnection(sshConnectionId)

      if (!sshConnection) {
        console.error('SSH connection not found:', sshConnectionId)
        return
      }

      // Connect to SSH if not already connected
      const connectResult = await window.electron.ssh.connect(sshConnection)
      if (!connectResult.success) {
        console.error('Failed to establish SSH connection:', connectResult.error)
        alert(`Failed to connect to ${sshConnection.name}: ${connectResult.error}`)
        return
      }

      // Create terminal with SSH (use project path if provided, otherwise start in home directory)
      info = await window.electron.pty.create({
        sshConnectionId,
        remoteCwd: project.path || undefined,
      })

      sessionSshConnectionId = sshConnectionId

      // Save config for persistence
      saveConfig({
        id: info.id,
        projectId,
        shell: 'ssh',
        shellName: shell.name,
        cwd: project.path || '~',
        sshConnectionId,
      })
    } else {
      // Local shell
      // Safety check: if shell.path is 'ssh' without a colon, it means
      // we're trying to create an SSH terminal but project isn't configured
      if (shell.path === 'ssh') {
        console.error('SSH terminal requested but project is not configured as SSH project')
        alert(`Project ${project.name} is not configured as an SSH project. Please edit the project settings.`)
        return
      }

      info = await window.electron.pty.create({
        shell: shell.path,
        cwd: project.path || process.cwd(),
      })

      // Save config for persistence
      saveConfig({
        id: info.id,
        projectId,
        shell: shell.path,
        shellName: shell.name,
        cwd: project.path || process.cwd(),
      })
    }

    addSession({
      id: info.id,
      projectId,
      pid: info.pid,
      shell: shell.path,
      shellName: shell.name,
      cwd: info.cwd,
      title: shell.name,
      createdAt: info.createdAt,
      sshConnectionId: sessionSshConnectionId,
    })

    // Create a new grid for this terminal
    createGrid(info.id)
  }

  const handleCreateQuickTerminal = async (shell: { name: string; path: string }) => {
    if (!window.electron) return

    let info

    // Check if this is an SSH connection (path starts with "ssh:")
    if (shell.path.startsWith('ssh:')) {
      const sshConnectionId = shell.path.substring(4) // Remove "ssh:" prefix
      const sshConnection = getConnection(sshConnectionId)

      if (!sshConnection) {
        console.error('SSH connection not found:', sshConnectionId)
        return
      }

      // Connect to SSH if not already connected
      const connectResult = await window.electron.ssh.connect(sshConnection)
      if (!connectResult.success) {
        console.error('Failed to establish SSH connection:', connectResult.error)
        alert(`Failed to connect to ${sshConnection.name}: ${connectResult.error}`)
        return
      }

      // Create terminal with SSH (no specific working directory - will start in home)
      info = await window.electron.pty.create({
        sshConnectionId,
      })

      // Save config for persistence (use empty projectId for quick terminals)
      saveConfig({
        id: info.id,
        projectId: '', // Empty projectId indicates this is a quick terminal
        shell: 'ssh',
        shellName: shell.name,
        cwd: '~',
        sshConnectionId,
      })
    } else {
      // Local shell - get system default directory
      const systemInfo = await window.electron.system.getInfo()
      const defaultCwd = systemInfo.cwd

      info = await window.electron.pty.create({
        shell: shell.path,
        cwd: defaultCwd,
      })

      // Save config for persistence
      saveConfig({
        id: info.id,
        projectId: '', // Empty projectId indicates this is a quick terminal
        shell: shell.path,
        shellName: shell.name,
        cwd: defaultCwd,
      })
    }

    addSession({
      id: info.id,
      projectId: '', // Empty projectId for quick terminals
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

  const handleReconnectTerminal = async (id: string) => {
    if (!window.electron) return

    // Find the terminal session
    const session = sessions.find((s) => s.id === id)
    if (!session) {
      console.error('Cannot reconnect: Session not found')
      return
    }

    // Get the SSH connection ID from session or from the project
    let sshConnectionId = session.sshConnectionId
    if (!sshConnectionId && session.projectId) {
      const project = projects.find((p) => p.id === session.projectId)
      if (project?.sshConnectionId) {
        sshConnectionId = project.sshConnectionId
      }
    }

    if (!sshConnectionId) {
      console.error('Cannot reconnect: Not an SSH terminal or SSH connection ID not found')
      alert('Cannot reconnect: This terminal is not associated with an SSH connection')
      return
    }

    // Get the SSH connection
    const sshConnection = getConnection(sshConnectionId)
    if (!sshConnection) {
      console.error('SSH connection not found:', sshConnectionId)
      alert('SSH connection configuration not found')
      return
    }

    try {
      // Clear the terminal display
      clearTerminal(id)

      // Disconnect the existing SSH connection
      await window.electron.ssh.disconnect(sshConnectionId)

      // Reconnect to SSH
      const connectResult = await window.electron.ssh.connect(sshConnection)
      if (!connectResult.success) {
        console.error('Failed to reconnect SSH:', connectResult.error)
        alert(`Failed to reconnect: ${connectResult.error}`)
        return
      }

      // Kill the old terminal PTY (but keep session in store)
      await window.electron.pty.kill(id)

      // Create a new PTY with the SAME ID so it reuses the terminal instance
      const info = await window.electron.pty.create({
        sshConnectionId: sshConnectionId,
        remoteCwd: session.cwd || undefined,
        id: id, // Reuse the same ID!
      })

      // Update the session with the new PID
      updateSessionPid(id, info.pid)

      console.log(`Reconnected terminal ${id} with new PID ${info.pid}`)
    } catch (error) {
      console.error('Error reconnecting terminal:', error)
      alert(`Failed to reconnect: ${error}`)
    }
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
    // Use \r on Windows to auto-execute, \n on Unix
    const lineEnding = navigator.platform.toLowerCase().includes('win') ? '\r' : '\n'
    await window.electron.pty.write(info.id, command + lineEnding)

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
      // Send Ctrl+C multiple times to force-terminate without prompts
      // On Windows, double Ctrl+C bypasses "Terminate batch job (Y/N)?" prompt
      await window.electron.pty.write(server.terminalId, '\x03')
      await new Promise((resolve) => setTimeout(resolve, 50))
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

      // Send Ctrl+C multiple times to force-terminate without prompts
      await window.electron.pty.write(server.terminalId, '\x03')
      await new Promise((resolve) => setTimeout(resolve, 50))
      await window.electron.pty.write(server.terminalId, '\x03')

      // Small delay for process to terminate
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Run the command again in the same terminal
      // Use \r on Windows to auto-execute, \n on Unix
      const lineEnding = navigator.platform.toLowerCase().includes('win') ? '\r' : '\n'
      await window.electron.pty.write(server.terminalId, command + lineEnding)
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
          <h1 className="text-2xl font-bold mb-2">ToolChain</h1>
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
          onCreateQuickTerminal={handleCreateQuickTerminal}
          onCloseTerminal={handleCloseTerminal}
          onReconnectTerminal={handleReconnectTerminal}
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
      <UpdateNotification />
      <FileSearchModal />
      <ReviewPanel projectPath={projects.find(p => p.id === activeProjectId)?.path || ''} />
    </DndContext>
  )
}

export default App
