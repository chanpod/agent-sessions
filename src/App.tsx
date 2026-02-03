import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
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
import { Terminal as TerminalIcon, ChevronUp } from 'lucide-react'
import { TitleBar } from './components/TitleBar'
import { ProjectHeader } from './components/ProjectHeader'
import { Sidebar } from './components/Sidebar'
import { TerminalArea } from './components/TerminalArea'
import { ChangedFilesPanel } from './components/ChangedFilesPanel'
import { UpdateNotification } from './components/UpdateNotification'
import { ToastContainer } from './components/ToastContainer'
import { NewProjectModal } from './components/NewProjectModal'
import { EditProjectModal } from './components/EditProjectModal'
import { useTerminalStore } from './stores/terminal-store'
import { useProjectStore } from './stores/project-store'
import { useServerStore } from './stores/server-store'
import { useGridStore } from './stores/grid-store'
import { useViewStore } from './stores/view-store'
import { useSSHStore } from './stores/ssh-store'
import { useGlobalRulesStore } from './stores/global-rules-store'
import { disposeTerminal, clearTerminal } from './lib/terminal-registry'
import { useDetectedServers } from './hooks/useDetectedServers'
import { AgentMessageView } from './components/agent'
import { AgentWorkspace } from './components/agent/AgentWorkspace'
import { useAgentStream } from './hooks/useAgentStream'
import { useAgentStreamStore } from './stores/agent-stream-store'
import type { AgentConversation, ContentBlock as UIContentBlock, AgentMessage as UIAgentMessage } from './types/agent-ui'
import type { TerminalAgentState, AgentMessage as StreamAgentMessage, ContentBlock as StreamContentBlock } from './types/stream-json'

// =============================================================================
// Mapping Functions for Stream State to AgentConversation
// =============================================================================

/**
 * Generate a unique ID for content blocks that don't have one
 */
function generateBlockId(messageId: string, index: number): string {
  return `${messageId}_block_${index}`
}

/**
 * Map a stream ContentBlock to a UI ContentBlock
 */
function mapContentBlock(
  block: StreamContentBlock,
  messageId: string,
  index: number
): UIContentBlock {
  const baseBlock = {
    id: generateBlockId(messageId, index),
    timestamp: Date.now(),
  }

  switch (block.type) {
    case 'text':
      return {
        ...baseBlock,
        type: 'text',
        content: block.content,
        isStreaming: !block.isComplete,
      }

    case 'thinking':
      return {
        ...baseBlock,
        type: 'thinking',
        content: block.content,
        isStreaming: !block.isComplete,
      }

    case 'tool_use':
      return {
        ...baseBlock,
        type: 'tool_use',
        toolId: block.toolId || '',
        toolName: block.toolName || '',
        input: block.toolInput || '{}',
        status: block.isComplete ? 'completed' : 'running',
      }

    default:
      // Fallback for unknown types - treat as text
      return {
        ...baseBlock,
        type: 'text',
        content: block.content,
      }
  }
}

/**
 * Map a stream AgentMessage to a UI AgentMessage
 */
function mapMessage(
  message: StreamAgentMessage,
  agentType: string
): UIAgentMessage {
  return {
    id: message.id,
    agentType,
    role: 'assistant',
    blocks: message.blocks.map((block, idx) =>
      mapContentBlock(block, message.id, idx)
    ),
    status: message.status,
    timestamp: message.startedAt,
    metadata: {
      model: message.model,
      usage: message.usage,
      stopReason: message.stopReason,
    },
  }
}

/**
 * Convert stream store state to AgentConversation format
 */
function mapToConversation(
  terminalId: string,
  agentType: string,
  state: TerminalAgentState | undefined
): AgentConversation {
  if (!state) {
    return {
      terminalId,
      agentType,
      messages: [],
      currentMessage: null,
      status: 'idle',
    }
  }

  const messages = state.messages.map((msg) => mapMessage(msg, agentType))
  const currentMessage = state.currentMessage
    ? mapMessage(state.currentMessage, agentType)
    : null

  let status: AgentConversation['status'] = 'idle'
  if (state.isActive) {
    status = 'streaming'
  } else if (state.error) {
    status = 'error'
  } else if (state.messages.length > 0) {
    status = 'completed'
  }

  return {
    terminalId,
    agentType,
    messages,
    currentMessage,
    status,
  }
}

function App() {
  const [isElectron, setIsElectron] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDragTitle, setActiveDragTitle] = useState<string>('')
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [isGitDrawerOpen, setIsGitDrawerOpen] = useState(false)
  const [isTerminalDockOpen, setIsTerminalDockOpen] = useState(true)
  // State for agent processes (these use child_process, not PTY)
  const [agentProcesses, setAgentProcesses] = useState<Map<string, { id: string; agentType: string; cwd: string }>>(new Map())
  const {
    addSession,
    addSessionsBatch,
    removeSession,
    removeSessionsByProject,
    updateSessionTitle,
    updateSessionPid,
    markSessionExited,
    updateSessionActivity,
    saveConfig,
    removeSavedConfig,
    sessions,
    setActiveSession,
    activeSessionId,
  } = useTerminalStore()
  const restoringRef = useRef(false)
  const { projects, activeProjectId } = useProjectStore()
  const { getConnection } = useSSHStore()
  const {
    addServer,
    removeServer,
    updateServerStatus,
    saveConfig: saveServerConfig,
  } = useServerStore()
  const {
    dashboard,
    addTerminalToDashboard,
    reorderDashboardTerminals,
    setDashboardFocusedTerminal,
    cleanupTerminalReferences,
    validateDashboardState,
  } = useGridStore()
  const { activeView } = useViewStore()
  const { setActiveProject, removeProject, disconnectProject, addTerminalToProject, setProjectFocusedTerminal, removeTerminalFromProject } = useProjectStore()
  const { getEnabledRulesText, loadRules: loadGlobalRules } = useGlobalRulesStore()

  const visibleTerminalSessions = useMemo(() => {
    return sessions.filter((s) =>
      s.terminalType !== 'agent' &&
      s.shell !== '' &&
      (s.projectId === activeProjectId || s.projectId === '')
    )
  }, [sessions, activeProjectId])

  const activeTerminalLabel = useMemo(() => {
    const activeSession = visibleTerminalSessions.find((s) => s.id === activeSessionId)
    return activeSession?.title || visibleTerminalSessions[visibleTerminalSessions.length - 1]?.title || 'No terminal'
  }, [visibleTerminalSessions, activeSessionId])

  // Find active session and check if it's an agent
  const activeSession = sessions.find(s => s.id === activeSessionId)
  const isAgentTerminal = activeSession?.terminalType === 'agent'
  const agentType = activeSession?.agentId || 'claude'

  // Get agent stream data for active session
  const agentStream = useAgentStream(activeSessionId || '')

  // Map stream data to AgentConversation format for the UI
  const agentConversation: AgentConversation | null = useMemo(() => {
    if (!isAgentTerminal || !activeSessionId || !agentStream.state) return null
    return mapToConversation(activeSessionId, agentType, agentStream.state)
  }, [isAgentTerminal, activeSessionId, agentStream.state, agentType])

  // Check if active session is an agent process (not PTY)
  const activeAgentProcess = agentProcesses.get(activeSessionId || '')

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

  // Initialize global rules store
  useEffect(() => {
    if (isElectron) {
      loadGlobalRules()
    }
  }, [isElectron, loadGlobalRules])

  // Listen for SSH project status changes (e.g., when connection is lost after sleep)
  useEffect(() => {
    if (!isElectron || !window.electron) return

    const unsubscribe = window.electron.ssh.onProjectStatusChange((projectId, connected, error) => {
      const { setProjectConnectionStatus } = useProjectStore.getState()
      if (!connected) {
        console.log(`[App] SSH project ${projectId} disconnected:`, error || 'Connection lost')
        setProjectConnectionStatus(projectId, 'disconnected', error)
      }
    })

    return () => unsubscribe?.()
  }, [isElectron])

  // Subscribe to agent process events (JSON streaming via child_process)
  useEffect(() => {
    if (!isElectron || !window.electron?.agent) return

    // Subscribe to stream events for agent processes
    const unsubStream = window.electron.agent.onStreamEvent((id, event) => {
      // Forward to agent stream store for processing
      const agentEvent = event as { type: string; data: unknown }
      console.log(`[App] Received stream event:`, agentEvent.type, agentEvent)
      if (agentEvent.type?.startsWith('agent-')) {
        console.log(`[App] Processing agent event:`, agentEvent.type)
        useAgentStreamStore.getState().processEvent(id, agentEvent as any)
      }
    })

    // Subscribe to process exit events
    const unsubExit = window.electron.agent.onProcessExit((id, code) => {
      // Don't remove from map - keep the UI visible so user can see the response
      // Just log for now; multi-turn will spawn new processes with --resume
      console.log(`[App] Agent process ${id} exited with code ${code}`)
    })

    // Subscribe to error events
    const unsubError = window.electron.agent.onError((id, error) => {
      console.error(`[App] Agent process ${id} error:`, error)
    })

    return () => {
      unsubStream?.()
      unsubExit?.()
      unsubError?.()
    }
  }, [isElectron])

  // Helper function to categorize terminal output activity level
  // Returns: 'substantial' (green), 'minor' (yellow), or 'none' (no update)
  const getActivityLevel = (data: string): 'substantial' | 'minor' | 'none' => {
    // Empty or very short data is likely just cursor blink - ignore it
    if (!data || data.length < 2) return 'none'

    // Strip ANSI escape sequences to see what's left
    const stripped = data
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // CSI sequences
      .replace(/\x1b\][0-9;]*[^\x07]*(\x07|\x1b\\)/g, '') // OSC sequences
      .replace(/\x1b[=>]/g, '') // Simple escape sequences
      .replace(/\x07/g, '') // Bell
      .replace(/\r/g, '') // Carriage returns
      .trim()

    // If nothing left after stripping, it's just control codes
    if (stripped.length === 0) return 'none'

    // Check if this looks like a prompt redraw
    // Prompts typically end with $, #, >, :, or ) followed by optional space
    const looksLikePrompt = /[$#>:)][\s]*$/.test(stripped) && stripped.length < 100

    if (looksLikePrompt) {
      // Prompt redraws are minor activity (don't trigger green)
      return 'minor'
    }

    // Substantial activity: Has newlines (multi-line output) or significant length
    // This catches command output, agent responses, compilation errors, etc.
    if (data.includes('\n') || stripped.length >= 20) {
      return 'substantial'
    }

    // Minor activity: Short output without newlines
    // This catches spinners, single-char updates, small prompt changes
    if (stripped.length > 0) {
      return 'minor'
    }

    return 'none'
  }

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
      // IMPORTANT: Do NOT auto-connect SSH projects on startup
      // SSH connections should only be established when user explicitly clicks "Connect"
      // This prevents password prompts on app startup

      // Step 2: Now restore terminals with connections ready
      const sessionsToAdd: Parameters<typeof addSession>[0][] = []
      const configUpdates: { oldId: string; newConfig: Parameters<typeof saveConfig>[0] }[] = []
      const terminalsToAddToProjects: { projectId: string; terminalId: string }[] = []

      for (const config of configs) {
        try {
          let info

          // Check if this config has an SSH connection
          if (config.sshConnectionId) {
            // Skip SSH terminals on startup - they need explicit connection
            console.log(`Skipping SSH terminal restoration: ${config.shellName}`)
            removeSavedConfig(config.id)
            continue
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

          // Add terminal to its project grid
          if (config.projectId) {
            terminalsToAddToProjects.push({ projectId: config.projectId, terminalId: info.id })
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

      // Add terminals to their project grids
      for (const { projectId, terminalId } of terminalsToAddToProjects) {
        addTerminalToProject(projectId, terminalId)
      }

      // Update configs
      for (const { oldId, newConfig } of configUpdates) {
        removeSavedConfig(oldId)
        saveConfig(newConfig)
      }

      // Validate dashboard state after terminals are restored
      validateDashboardState()
    })()
  }, [isElectron, addSessionsBatch, saveConfig, removeSavedConfig, addTerminalToProject, projects, getConnection, validateDashboardState])

  useEffect(() => {
    if (!isElectron || !window.electron) return

    // Set up PTY event listeners
    const unsubData = window.electron.pty.onData((id, data) => {
      // Categorize the activity level
      const level = getActivityLevel(data)

      // Update activity if it's substantial or minor (not 'none')
      if (level !== 'none') {
        updateSessionActivity(id, level)
      }
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

      // Alt+N: Focus terminal N in dashboard
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const terminalIndex = num - 1
        const terminalId = dashboard.terminalRefs[terminalIndex]
        if (terminalId) {
          setDashboardFocusedTerminal(terminalId)
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [projects, dashboard, setActiveProject, setDashboardFocusedTerminal])

  // Helper to get display name for AI agents
  const getAgentDisplayName = (agentId: string): string => {
    const names: Record<string, string> = {
      claude: 'Claude',
      gemini: 'Gemini',
      codex: 'Codex'
    }
    return names[agentId] || agentId
  }

  // Spawn agent process using the new child_process-based API (JSON streaming)
  // Currently only Claude supports proper JSON streaming; Gemini/Codex fall back to PTY
  const handleSpawnAgentProcess = useCallback(async (
    projectId: string,
    agentType: 'claude' | 'codex' | 'gemini',
    cwd: string,
    _contextContent?: string | null // Reserved for future context injection
  ): Promise<string | null> => {
    if (!window.electron?.agent?.spawn) return null

    try {
      const result = await window.electron.agent.spawn({ agentType, cwd })
      if (result.success && result.process) {
        // Track the agent process
        setAgentProcesses(prev => {
          const next = new Map(prev)
          next.set(result.process!.id, {
            id: result.process!.id,
            agentType: result.process!.agentType,
            cwd: result.process!.cwd
          })
          return next
        })

        // Also add to terminal sessions for consistent tracking
        addSession({
          id: result.process.id,
          projectId,
          pid: 0, // Process-based agents don't have a PTY pid
          shell: agentType,
          shellName: getAgentDisplayName(agentType),
          cwd,
          title: `${getAgentDisplayName(agentType)} Agent`,
          createdAt: Date.now(),
          terminalType: 'agent',
          agentId: agentType,
          isAgentProcess: true, // Flag to distinguish from PTY-based agents
        })

        // Set as active session
        setActiveSession(result.process.id)

        // Add to project if applicable
        if (projectId) {
          addTerminalToProject(projectId, result.process.id)
          setProjectFocusedTerminal(projectId, result.process.id)
        }

        return result.process.id
      }
      return null
    } catch (error) {
      console.error('[App] Failed to spawn agent process:', error)
      return null
    }
  }, [setActiveSession, addSession, addTerminalToProject, setProjectFocusedTerminal])

  // Handler for creating agent terminals (Claude, Gemini, Codex)
  // Uses the new AgentProcessManager for Claude (JSON streaming),
  // falls back to PTY-based approach for other agents
  const handleCreateAgentTerminal = async (
    projectId: string,
    agentId: string,
    contextId: string | null,
    contextContent: string | null,
    skipPermissions?: boolean
  ) => {
    const project = projects.find(p => p.id === projectId)
    if (!project || !window.electron) return

    console.log('[App] handleCreateAgentTerminal called:', {
      projectId,
      agentId,
      contextId,
      hasContext: !!contextContent,
      contextLength: contextContent?.length,
      contextPreview: contextContent?.substring(0, 100),
      skipPermissions
    })

    // Combine global rules with project context
    const globalRulesText = getEnabledRulesText()
    const combinedContext = [globalRulesText, contextContent].filter(Boolean).join('\n\n') || null

    // For Claude, use the new AgentProcessManager with JSON streaming
    // This provides structured streaming and better message handling
    if (agentId === 'claude' && window.electron.agent?.spawn !== undefined) {
      console.log('[App] Using AgentProcessManager for Claude (JSON streaming)')

      const processId = await handleSpawnAgentProcess(
        projectId,
        'claude',
        project.path,
        combinedContext
      )

      if (processId) {
        // Switch to dedicated single terminal view to show the agent workspace
        const { setProjectTerminalActive } = useViewStore.getState()
        setProjectTerminalActive(projectId, processId)
        return
      }

      // If process spawn failed, fall through to PTY approach
      console.warn('[App] AgentProcessManager spawn failed, falling back to PTY')
    }

    // PTY-based approach for Gemini, Codex, or as fallback
    try {
      // Build the command with optional context
      // Each agent has different context injection syntax
      let initialCommand = agentId
      if (combinedContext) {
        // Escape the context for shell (handle quotes, special chars)
        const escapedContext = combinedContext
          .replace(/\\/g, '\\\\')  // Escape backslashes first
          .replace(/"/g, '\\"')     // Escape double quotes
          .replace(/\$/g, '\\$')    // Escape dollar signs
          .replace(/`/g, '\\`')     // Escape backticks

        // Agent-specific context injection
        switch (agentId) {
          case 'claude':
            // Claude uses --append-system-prompt flag
            initialCommand = `claude --append-system-prompt "${escapedContext}"`
            break
          case 'gemini':
            // Gemini uses -p flag for prompt
            initialCommand = `gemini -p "${escapedContext}"`
            break
          case 'codex':
            // Codex takes prompt as direct argument (no flag)
            initialCommand = `codex "${escapedContext}"`
            break
          default:
            // Fallback: try --append-system-prompt
            initialCommand = `${agentId} --append-system-prompt "${escapedContext}"`
        }
      }

      // Append skip permissions flag if enabled
      if (skipPermissions) {
        switch (agentId) {
          case 'claude':
            initialCommand += ' --dangerously-skip-permissions'
            break
          case 'gemini':
          case 'codex':
            initialCommand += ' --yolo'
            break
        }
      }

      // Use unified pty.create with initialCommand
      const info = await window.electron.pty.create({
        cwd: project.path,
        initialCommand,
        title: getAgentDisplayName(agentId),
      })

      if (!info) {
        console.error('Failed to create agent terminal')
        return
      }

      console.log('[App] pty.create result for agent:', info)

      // Add to terminal store with agent metadata
      addSession({
        id: info.id,
        projectId,
        pid: info.pid,
        shell: agentId,
        shellName: getAgentDisplayName(agentId),
        cwd: project.path,
        title: `${getAgentDisplayName(agentId)} Agent`,
        createdAt: info.createdAt,
        terminalType: 'agent',
        agentId,
        contextId: contextId ?? undefined,
        contextInjected: !!combinedContext
      })

      // Set as the active session so the Agent Workspace shows it
      setActiveSession(info.id)

      // Add terminal to project grid and focus it
      addTerminalToProject(projectId, info.id)
      setProjectFocusedTerminal(projectId, info.id)

      // Switch to dedicated single terminal view to show the newly created terminal
      const { setProjectTerminalActive } = useViewStore.getState()
      setProjectTerminalActive(projectId, info.id)
    } catch (error) {
      console.error('Failed to create agent terminal:', error)
    }
  }

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

      // For SSH projects, the connection should already be established via the project tunnel
      // We don't need to call ssh.connect() here - just create the terminal with projectId
      console.log('[handleCreateTerminal] Creating SSH terminal through existing project tunnel:', projectId)

      // Create terminal with SSH using the project's remote path
      info = await window.electron.pty.create({
        sshConnectionId: project.sshConnectionId,
        remoteCwd: project.remotePath || undefined,
        projectId: projectId, // Pass project ID to use tunnel (no password needed!)
      })

      if (!info) {
        console.error('Failed to create terminal')
        return
      }

      sessionSshConnectionId = project.sshConnectionId

      // Mark project as connected (tunnel is working if we got here)
      console.log('[handleCreateTerminal] Marking project as connected:', projectId)
      await window.electron.ssh.markProjectConnected(projectId)

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

      if (!info) {
        console.error('Failed to create terminal')
        return
      }

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

      if (!info) {
        console.error('Failed to create terminal')
        return
      }

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

    // Add terminal to project grid and focus it
    addTerminalToProject(projectId, info.id)
    setProjectFocusedTerminal(projectId, info.id)

    // Switch to dedicated single terminal view to show the newly created terminal
    const { setProjectTerminalActive } = useViewStore.getState()
    setProjectTerminalActive(projectId, info.id)
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

    // Add terminal to dashboard
    addTerminalToDashboard(info.id)
  }

  const handleCloseTerminal = async (id: string) => {
    if (!window.electron) return

    // Get session to find its project
    const session = sessions.find((s) => s.id === id)

    // Remove from project grid if it belongs to one
    if (session?.projectId) {
      removeTerminalFromProject(session.projectId, id)
    }

    // Remove from dashboard if it was pinned there
    cleanupTerminalReferences(id)

    // Check if this is an agent process (JSON streaming) vs PTY terminal
    if (session?.isAgentProcess) {
      // Kill the agent process
      if (window.electron.agent?.kill) {
        await window.electron.agent.kill(id)
      }
      // Remove from agent processes state
      setAgentProcesses(prev => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      // Clear from agent stream store
      useAgentStreamStore.getState().clearTerminal(id)
    } else {
      // Dispose the xterm instance from registry (for PTY-based terminals)
      disposeTerminal(id)
      await window.electron.pty.kill(id)
    }

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

    // Add server terminal to project grid
    addTerminalToProject(projectId, info.id)

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

  const handleCreateProject = () => {
    setShowNewProjectModal(true)
  }

  const handleEditProject = (projectId: string) => {
    setEditingProjectId(projectId)
  }

  const handleDeleteProject = async (projectId: string) => {
    console.log('Delete project:', projectId)

    // Find the project to check if it's an SSH project
    const project = projects.find((p) => p.id === projectId)

    // If it's an SSH project, disconnect it first
    if (project?.isSSHProject) {
      try {
        await disconnectProject(projectId)
      } catch (error) {
        console.error('Failed to disconnect SSH project:', error)
      }
    }

    // Remove all terminals associated with this project
    removeSessionsByProject(projectId)

    // Finally, remove the project itself (permanent deletion)
    removeProject(projectId)
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
    const overData = over.data.current as { viewType?: string; projectId?: string } | undefined

    // Get the dragged terminal's session to know its project
    const draggedSession = sessions.find((s) => s.id === draggedId)

    // Handle dropping on empty terminal area - depends on current view
    if (overId === 'empty-terminal-area-drop-zone') {
      if (activeView.type === 'dashboard') {
        if (!dashboard.terminalRefs.includes(draggedId)) {
          addTerminalToDashboard(draggedId)
        }
      } else if (activeView.type === 'project-grid' && draggedSession?.projectId === activeView.projectId) {
        // Terminal already belongs to this project, ensure it's in the grid
        const project = projects.find((p) => p.id === activeView.projectId)
        if (project && !project.gridTerminalIds.includes(draggedId)) {
          addTerminalToProject(activeView.projectId, draggedId)
        }
      }
      return
    }

    // Handle dropping on dashboard drop zone
    if (overId === 'dashboard-drop-zone') {
      if (!dashboard.terminalRefs.includes(draggedId)) {
        addTerminalToDashboard(draggedId)
      }
      return
    }

    // Handle dropping on project drop zone
    if (overId.startsWith('project-drop-zone-')) {
      const targetProjectId = overData?.projectId
      if (targetProjectId && draggedSession?.projectId === targetProjectId) {
        // Terminal belongs to this project - add to its grid
        const project = projects.find((p) => p.id === targetProjectId)
        if (project && !project.gridTerminalIds.includes(draggedId)) {
          addTerminalToProject(targetProjectId, draggedId)
        }
      }
      return
    }

    // Handle dropping on another terminal (reordering)
    const isInDashboard = dashboard.terminalRefs.includes(draggedId)
    const targetIsInDashboard = dashboard.terminalRefs.includes(overId)

    if (targetIsInDashboard && isInDashboard) {
      // Reordering within the dashboard
      const fromIndex = dashboard.terminalRefs.indexOf(draggedId)
      const toIndex = dashboard.terminalRefs.indexOf(overId)
      if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {
        reorderDashboardTerminals(fromIndex, toIndex)
      }
    } else if (targetIsInDashboard && !isInDashboard) {
      // Terminal not in dashboard, add it
      addTerminalToDashboard(draggedId)
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
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Custom title bar (Windows only) */}
        <TitleBar />
        {/* Top header with project tabs */}
        <ProjectHeader
          onCreateProject={handleCreateProject}
          onEditProject={handleEditProject}
          onDeleteProject={handleDeleteProject}
          onToggleGitDrawer={() => setIsGitDrawerOpen((prev) => !prev)}
          gitDrawerOpen={isGitDrawerOpen}
        />
        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden relative">
          <Sidebar
            onCloseTerminal={handleCloseTerminal}
            onReconnectTerminal={handleReconnectTerminal}
            onCreateAgentTerminal={handleCreateAgentTerminal}
          />
          <div className="flex flex-1 min-w-0 flex-col bg-zinc-950">
            <div className="flex-1 min-h-0">
              {activeAgentProcess ? (
                // New process-based agent (JSON streaming via child_process)
                <AgentWorkspace
                  processId={activeAgentProcess.id}
                  agentType={activeAgentProcess.agentType as 'claude' | 'codex' | 'gemini'}
                  cwd={activeAgentProcess.cwd}
                  className="h-full"
                />
              ) : isAgentTerminal && agentConversation ? (
                // Backwards compatible: PTY-based agent terminal
                <AgentMessageView
                  conversation={agentConversation}
                  className="h-full"
                />
              ) : (
                // Empty placeholder
                <div className="h-full w-full flex items-center justify-center text-zinc-500">
                  <div className="text-center">
                    <p className="text-sm uppercase tracking-[0.2em] text-zinc-600">Agent Workspace</p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {sessions.some(s => s.terminalType === 'agent') || agentProcesses.size > 0
                        ? 'Select an agent terminal to view conversation'
                        : 'Launch an agent to get started'}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {isTerminalDockOpen ? (
              <div className="h-[30vh] min-h-[220px] max-h-[420px] border-t border-zinc-800 bg-zinc-950">
                <TerminalArea
                  onCreateTerminal={handleCreateTerminal}
                  onCreateQuickTerminal={handleCreateQuickTerminal}
                  onCloseTerminal={handleCloseTerminal}
                  onStopServer={handleStopServer}
                  onRestartServer={handleRestartServer}
                  onDeleteServer={handleDeleteServer}
                  onToggleCollapse={() => setIsTerminalDockOpen(false)}
                />
              </div>
            ) : (
              <button
                className="h-10 border-t border-zinc-800 bg-zinc-950/90 px-4 text-left text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-3"
                onClick={() => setIsTerminalDockOpen(true)}
              >
                <ChevronUp className="h-4 w-4 text-zinc-500" />
                <span className="uppercase tracking-[0.2em] text-zinc-500">Terminal Dock</span>
                <span className="text-zinc-600">{visibleTerminalSessions.length} terminals</span>
                <span className="text-zinc-500 truncate">{activeTerminalLabel}</span>
              </button>
            )}
          </div>
          <ChangedFilesPanel isOpen={isGitDrawerOpen} onClose={() => setIsGitDrawerOpen(false)} />
        </div>
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
      <ToastContainer />
      {showNewProjectModal && (
        <NewProjectModal onClose={() => setShowNewProjectModal(false)} />
      )}
      {editingProjectId && (
        <EditProjectModal
          projectId={editingProjectId}
          onClose={() => setEditingProjectId(null)}
        />
      )}
    </DndContext>
  )
}

export default App
