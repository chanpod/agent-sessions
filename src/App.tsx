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
import { Terminal as TerminalIcon, ChevronUp, ExternalLink, GitCompare } from 'lucide-react'
import { cn } from './lib/utils'
import { SectionErrorBoundary } from './components/ErrorBoundary'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TerminalArea } from './components/TerminalArea'
import { ChangedFilesPanel } from './components/ChangedFilesPanel'
import { UpdateNotification } from './components/UpdateNotification'
import { ToastContainer } from './components/ToastContainer'
import { NewProjectModal } from './components/NewProjectModal'
import { EditProjectModal } from './components/EditProjectModal'
import { PermissionModal } from './components/PermissionModal'
import { HookInstallPrompt } from './components/HookInstallPrompt'
import { usePermissionStore } from './stores/permission-store'
import { useTerminalStore } from './stores/terminal-store'
import { useProjectStore } from './stores/project-store'
import { useServerStore } from './stores/server-store'
import { useGridStore } from './stores/grid-store'
import { useViewStore } from './stores/view-store'
import { useSSHStore } from './stores/ssh-store'
import { useGitStore } from './stores/git-store'
import { useGlobalRulesStore } from './stores/global-rules-store'
import { useToastStore } from './stores/toast-store'
import { useNotificationStore } from './stores/notification-store'
import { disposeTerminal, clearTerminal } from './lib/terminal-registry'
import { useDetectedServers } from './hooks/useDetectedServers'
import { BranchSwitcher } from './components/BranchSwitcher'
import { AgentMessageView } from './components/agent'
import { AgentWorkspace } from './components/agent/AgentWorkspace'
import { useAgentStream } from './hooks/useAgentStream'
import { useAgentStreamStore, waitForRehydration } from './stores/agent-stream-store'
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
  const [terminalDockHeight, setTerminalDockHeight] = useState(() => {
    const saved = localStorage.getItem('terminal-dock-height')
    return saved ? parseInt(saved, 10) : Math.round(window.innerHeight * 0.3)
  })
  const [isTerminalResizing, setIsTerminalResizing] = useState(false)
  // State for agent processes (these use child_process, not PTY)
  const [agentProcesses, setAgentProcesses] = useState<Map<string, { id: string; agentType: string; cwd: string; sessionId?: string }>>(new Map())
  const [hookPromptState, setHookPromptState] = useState<{
    projectId: string
    projectName: string
    agentId: string
    contextId: string | null
    contextContent: string | null
  } | null>(null)
  const {
    addSession,
    addSessionsBatch,
    removeSession,
    removeSessionsByProject,
    updateSessionTitle,
    updateSessionPid,
    markSessionExited,
    saveConfig,
    removeSavedConfig,
    reorderSavedConfigs,
    sessions,
    setActiveSession,
    activeSessionId,
    activeAgentSessionId,
    setActiveAgentSession,
  } = useTerminalStore()
  const restoringRef = useRef(false)
  const { projects, activeProjectId } = useProjectStore()
  const { getConnection } = useSSHStore()
  const activeGitInfo = useGitStore((state) => activeProjectId ? state.gitInfo[activeProjectId] : undefined)
  const changedFileCount = activeGitInfo?.changedFiles.length || 0
  const activeProjectPath = projects.find(p => p.id === activeProjectId)?.path
  const {
    addServer,
    removeServer,
    updateServerStatus,
    saveConfig: saveServerConfig,
  } = useServerStore()
  const {
    dashboard,
    addTerminalToDashboard,
    setDashboardFocusedTerminal,
    cleanupTerminalReferences,
    validateDashboardState,
  } = useGridStore()
  const { isTerminalDockOpen, setTerminalDockOpen } = useViewStore()
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

  // Find active agent session (separate from terminal dock's activeSessionId)
  const activeAgentSession = sessions.find(s => s.id === activeAgentSessionId)
  const isAgentTerminal = activeAgentSession?.terminalType === 'agent'
  const agentType = activeAgentSession?.agentId || 'claude'

  // Get agent stream data for active agent session
  const agentStream = useAgentStream(activeAgentSessionId || '')

  // Map stream data to AgentConversation format for the UI
  const agentConversation: AgentConversation | null = useMemo(() => {
    if (!isAgentTerminal || !activeAgentSessionId || !agentStream.state) return null
    return mapToConversation(activeAgentSessionId, agentType, agentStream.state)
  }, [isAgentTerminal, activeAgentSessionId, agentStream.state, agentType])

  // Check if active agent session is an agent process (not PTY)
  const activeAgentProcess = agentProcesses.get(activeAgentSessionId || '')

  // Look up sessionId from stream store if not on the process entry (survives remounts)
  const activeAgentResumeSessionId = activeAgentProcess?.sessionId
    || useAgentStreamStore.getState().getSessionId(activeAgentSessionId || '')
    || undefined

  // Configure drag sensors with a distance threshold
  // This prevents clicks from being interpreted as drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  )

  const TERMINAL_MIN_HEIGHT = 150
  const TERMINAL_MAX_HEIGHT_RATIO = 0.6

  const startTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsTerminalResizing(true)
  }, [])

  const stopTerminalResize = useCallback(() => {
    setIsTerminalResizing(false)
  }, [])

  const resizeTerminalDock = useCallback((e: MouseEvent) => {
    if (!isTerminalResizing) return
    const maxHeight = Math.round(window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO)
    const newHeight = window.innerHeight - e.clientY
    const clamped = Math.max(TERMINAL_MIN_HEIGHT, Math.min(newHeight, maxHeight))
    setTerminalDockHeight(clamped)
    localStorage.setItem('terminal-dock-height', String(clamped))
  }, [isTerminalResizing])

  useEffect(() => {
    if (!isTerminalResizing) return
    document.addEventListener('mousemove', resizeTerminalDock)
    document.addEventListener('mouseup', stopTerminalResize)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', resizeTerminalDock)
      document.removeEventListener('mouseup', stopTerminalResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isTerminalResizing, resizeTerminalDock, stopTerminalResize])

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

  // Permission hook event subscription
  useEffect(() => {
    if (!window.electron?.permission) return
    const { addRequest, removeRequest } = usePermissionStore.getState()
    const unsubRequest = window.electron.permission.onRequest((request) => {
      addRequest(request)

      // If the request is for a session the user isn't currently viewing, show a toast
      const activeTerminalId = useTerminalStore.getState().activeAgentSessionId
      const activeCliSessionId = activeTerminalId
        ? useAgentStreamStore.getState().getSessionId(activeTerminalId)
        : null

      if (request.sessionId !== activeCliSessionId) {
        // Find the terminal that owns this session so we can navigate to it
        const terminalToSession = useAgentStreamStore.getState().terminalToSession
        let targetTerminalId: string | null = null
        for (const [termId, sessId] of terminalToSession) {
          if (sessId === request.sessionId) {
            targetTerminalId = termId
            break
          }
        }

        const { addToast } = useToastStore.getState()
        const sessionLabel = targetTerminalId
          ? useTerminalStore.getState().sessions.find((s) => s.id === targetTerminalId)?.title ?? 'Agent session'
          : 'Agent session'

        // Add notification for non-active project permissions
        const notifSession = targetTerminalId
          ? useTerminalStore.getState().sessions.find((s) => s.id === targetTerminalId)
          : null
        const notifProject = notifSession?.projectId
          ? useProjectStore.getState().projects.find((p) => p.id === notifSession.projectId)
          : null

        if (notifProject && notifSession?.projectId !== useProjectStore.getState().activeProjectId) {
          useNotificationStore.getState().addNotification({
            projectId: notifProject.id,
            projectName: notifProject.name,
            terminalId: targetTerminalId!,
            sessionTitle: sessionLabel,
            type: 'permission',
            message: `Needs permission for ${request.toolName}`,
          })
        }

        addToast(
          `${sessionLabel} needs permission for ${request.toolName}`,
          'warning',
          10000,
          targetTerminalId
            ? () => {
                const session = useTerminalStore.getState().sessions.find((s) => s.id === targetTerminalId)
                if (session?.projectId) {
                  useProjectStore.getState().setActiveProject(session.projectId)
                  useTerminalStore.getState().setActiveAgentSession(targetTerminalId)
                }
              }
            : undefined
        )
      }
    })
    const unsubExpired = window.electron.permission.onExpired((id) => {
      removeRequest(id)
    })
    return () => {
      unsubRequest()
      unsubExpired()
    }
  }, [])

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

      // Wait for agent stream store to complete async rehydration before restoring agent sessions
      // This prevents a race condition where we try to restore sessions before the persisted
      // session data has been loaded from storage
      await waitForRehydration()
      console.log('[App] Agent stream store rehydrated, proceeding with terminal restoration')

      // Step 2: Now restore terminals with connections ready
      const sessionsToAdd: Parameters<typeof addSession>[0][] = []
      const configUpdates: { oldId: string; newConfig: Parameters<typeof saveConfig>[0] }[] = []
      const terminalsToAddToProjects: { projectId: string; terminalId: string }[] = []
      // Collect agent processes to add to the agentProcesses Map (needed for AgentWorkspace rendering)
      const agentProcessesToAdd: { id: string; agentType: string; cwd: string; sessionId?: string }[] = []

      for (const config of configs) {
        try {
          // Check if this is an agent terminal
          if (config.terminalType === 'agent') {
            // Agent terminals don't need a PTY - they use the AgentProcessManager
            // Generate a new terminal ID (terminal IDs always regenerate on app restart)
            const newTerminalId = `agent-restored-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

            // Restore conversation history if we have a sessionId
            if (config.sessionId) {
              const { restoreSessionToTerminal } = useAgentStreamStore.getState()
              restoreSessionToTerminal(newTerminalId, config.sessionId)
              console.log(`[App] Restored agent session ${config.sessionId} to terminal ${newTerminalId}`)
            }

            // Create session entry with isAgentProcess flag (indicates no PTY)
            sessionsToAdd.push({
              id: newTerminalId,
              projectId: config.projectId,
              pid: 0, // No actual process yet - will be spawned when user sends a message
              shell: config.shell,
              shellName: config.shellName,
              cwd: config.cwd,
              title: config.shellName,
              createdAt: Date.now(),
              // Agent-specific fields
              terminalType: 'agent',
              agentId: config.agentId,
              contextId: config.contextId,
              isAgentProcess: true, // Flag to indicate this uses AgentProcessManager, not PTY
            })

            // Also add to agentProcesses Map so AgentWorkspace renders instead of AgentMessageView
            agentProcessesToAdd.push({
              id: newTerminalId,
              agentType: config.agentId || 'claude',
              cwd: config.cwd,
              sessionId: config.sessionId,
            })

            // Add terminal to its project grid
            if (config.projectId) {
              terminalsToAddToProjects.push({ projectId: config.projectId, terminalId: newTerminalId })
            }

            // Update saved config with new terminal ID, but preserve sessionId
            configUpdates.push({
              oldId: config.id,
              newConfig: {
                id: newTerminalId,
                projectId: config.projectId,
                shell: config.shell,
                shellName: config.shellName,
                cwd: config.cwd,
                terminalType: 'agent',
                agentId: config.agentId,
                contextId: config.contextId,
                sessionId: config.sessionId, // Preserve sessionId for future restores
              },
            })

            console.log(`[App] Restored agent terminal: ${config.shellName} (new ID: ${newTerminalId})`)
            continue
          }

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

      // Add restored agent processes to the agentProcesses Map
      // This is required for AgentWorkspace to render instead of AgentMessageView
      if (agentProcessesToAdd.length > 0) {
        setAgentProcesses(prev => {
          const next = new Map(prev)
          for (const agent of agentProcessesToAdd) {
            next.set(agent.id, agent)
          }
          return next
        })
        console.log(`[App] Added ${agentProcessesToAdd.length} restored agent(s) to agentProcesses Map`)
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
      unsubExit()
      unsubTitle()
    }
  }, [isElectron, markSessionExited, updateSessionTitle, updateServerStatus])

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
    _contextContent?: string | null,
    model?: string | null
  ): Promise<string | null> => {
    if (!window.electron?.agent?.spawn) return null

    try {
      const result = await window.electron.agent.spawn({ agentType, cwd, projectId, ...(model ? { model } : {}) })
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
          ...(model ? { model } : {}),
        })

        // Save config for persistence (sessionId added later by AgentWorkspace when stream captures it)
        saveConfig({
          id: result.process.id,
          projectId,
          shell: agentType,
          shellName: getAgentDisplayName(agentType),
          cwd,
          terminalType: 'agent',
          agentId: agentType,
          ...(model ? { model } : {}),
        })

        // Set as active session (both terminal and agent)
        setActiveSession(result.process.id)
        setActiveAgentSession(result.process.id)

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
  }, [setActiveSession, addSession, saveConfig, addTerminalToProject, setProjectFocusedTerminal])

  // Handler for creating agent terminals (Claude, Gemini, Codex)
  // Uses the new AgentProcessManager for Claude (JSON streaming),
  // falls back to PTY-based approach for other agents
  const handleCreateAgentTerminal = async (
    projectId: string,
    agentId: string,
    contextId: string | null,
    contextContent: string | null,
    skipPermissions?: boolean,
    model?: string | null
  ) => {
    const project = projects.find(p => p.id === projectId)
    if (!project || !window.electron) return

    // Check if permission hook is installed (Claude only - other agents use their own skip flags)
    if (agentId === 'claude' && skipPermissions !== true && window.electron.permission) {
      const { isHookInstalled, setHookInstalled } = usePermissionStore.getState()
      let hookInstalled = isHookInstalled(project.path)
      if (hookInstalled === undefined) {
        const checked = await window.electron.permission.checkHook(project.path)
        setHookInstalled(project.path, checked)
        hookInstalled = checked
      }
      if (!hookInstalled) {
        setHookPromptState({ projectId, projectName: project.name, agentId, contextId, contextContent })
        return
      }
    }

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

    // For SSH projects, use the remote path as the working directory
    const agentCwd = (project.isSSHProject && project.remotePath) ? project.remotePath : project.path

    // For Claude and Codex, use the AgentProcessManager with JSON streaming
    // This provides structured streaming and better message handling
    if ((agentId === 'claude' || agentId === 'codex') && window.electron.agent?.spawn !== undefined) {
      console.log(`[App] Using AgentProcessManager for ${agentId} (JSON streaming)`, project.isSSHProject ? `(SSH → ${agentCwd})` : '')

      const processId = await handleSpawnAgentProcess(
        projectId,
        agentId as 'claude' | 'codex' | 'gemini',
        agentCwd,
        combinedContext,
        model
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
      setActiveAgentSession(info.id)

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

  const handleHookInstall = async () => {
    if (!hookPromptState || !window.electron?.permission) return
    const project = projects.find(p => p.id === hookPromptState.projectId)
    if (!project) return

    const result = await window.electron.permission.installHook(project.path)
    if (result.success) {
      usePermissionStore.getState().setHookInstalled(project.path, true)
      setHookPromptState(null)
      // Re-launch without skipPermissions (hook will handle approvals)
      handleCreateAgentTerminal(hookPromptState.projectId, hookPromptState.agentId, hookPromptState.contextId, hookPromptState.contextContent)
    } else {
      console.error('[App] Failed to install hook:', result.error)
    }
  }

  const handleHookSkip = () => {
    if (!hookPromptState) return
    setHookPromptState(null)
    // Re-launch with skipPermissions=true to bypass hook check
    handleCreateAgentTerminal(hookPromptState.projectId, hookPromptState.agentId, hookPromptState.contextId, hookPromptState.contextContent, true)
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

    // Archive agent sessions that have a sessionId (for future restoration)
    if (session?.terminalType === 'agent') {
      const savedConfig = useTerminalStore.getState().savedConfigs.find((c) => c.id === id)
      // Try savedConfig first, fall back to runtime mapping in agent-stream-store
      const sessionId = savedConfig?.sessionId || useAgentStreamStore.getState().getSessionId(id)
      console.log('[App] Archiving check — terminalType:', session.terminalType, 'savedConfig:', !!savedConfig, 'sessionId:', sessionId)
      if (savedConfig && sessionId) {
        const configToArchive = { ...savedConfig, sessionId }
        useTerminalStore.getState().archiveSession(
          configToArchive,
          session.title || session.shellName || 'Agent Session',
          savedConfig.agentId || 'unknown'
        )
        console.log('[App] Session archived:', sessionId, 'title:', session.title)
      } else {
        console.warn('[App] Session NOT archived — missing savedConfig or sessionId. id:', id, 'sessionId:', sessionId)
      }
    }

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
      // Clear from agent stream store (but don't delete persisted session data - it's archived)
      useAgentStreamStore.getState().clearTerminal(id)
    } else {
      // Dispose the xterm instance from registry (for PTY-based terminals)
      disposeTerminal(id)
      await window.electron.pty.kill(id)
    }

    removeSession(id)
  }

  const handleRestoreArchivedSession = (sessionId: string) => {
    const archived = useTerminalStore.getState().restoreArchivedSession(sessionId)
    if (!archived) return

    const config = archived.config
    const newTerminalId = `agent-restored-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Hydrate messages from persisted session data
    const { restoreSessionToTerminal } = useAgentStreamStore.getState()
    restoreSessionToTerminal(newTerminalId, sessionId)

    // Create session entry
    addSession({
      id: newTerminalId,
      projectId: config.projectId,
      pid: 0,
      shell: config.shell,
      shellName: config.shellName,
      cwd: config.cwd,
      title: archived.title,
      createdAt: Date.now(),
      terminalType: 'agent',
      agentId: config.agentId,
      contextId: config.contextId,
      isAgentProcess: true,
    })

    // Track in agent processes
    setAgentProcesses(prev => {
      const next = new Map(prev)
      next.set(newTerminalId, {
        id: newTerminalId,
        agentType: config.agentId || 'claude',
        cwd: config.cwd,
        sessionId,
      })
      return next
    })

    // Save config for persistence
    saveConfig({
      id: newTerminalId,
      projectId: config.projectId,
      shell: config.shell,
      shellName: config.shellName,
      cwd: config.cwd,
      terminalType: 'agent',
      agentId: config.agentId,
      contextId: config.contextId,
      sessionId,
    })

    // Set as active and add to project grid
    setActiveSession(newTerminalId)
    setActiveAgentSession(newTerminalId)
    if (config.projectId) {
      addTerminalToProject(config.projectId, newTerminalId)
      setProjectFocusedTerminal(config.projectId, newTerminalId)
    }
  }

  const handlePermanentDeleteArchivedSession = (sessionId: string) => {
    useTerminalStore.getState().permanentlyDeleteArchivedSession(sessionId)
    useAgentStreamStore.getState().deletePersistedSession(sessionId)
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
    const overData = over.data.current as { type?: string; terminalId?: string } | undefined

    // Only handle sidebar reordering (drop target is another terminal item)
    if (overData?.type !== 'terminal' || !overData.terminalId) return

    const targetId = overData.terminalId
    if (draggedId === targetId) return

    // Find indices in savedConfigs
    const savedConfigs = useTerminalStore.getState().savedConfigs
    const fromIndex = savedConfigs.findIndex((c) => c.id === draggedId)
    const toIndex = savedConfigs.findIndex((c) => c.id === targetId)

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      reorderSavedConfigs(fromIndex, toIndex)
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
        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden relative">
          <SectionErrorBoundary name="Sidebar">
            <Sidebar
              onCloseTerminal={handleCloseTerminal}
              onReconnectTerminal={handleReconnectTerminal}
              onCreateAgentTerminal={handleCreateAgentTerminal}
              onRestoreArchivedSession={handleRestoreArchivedSession}
              onPermanentDeleteArchivedSession={handlePermanentDeleteArchivedSession}
              onStartServer={handleStartServer}
              onStopServer={handleStopServer}
              onDeleteServer={handleDeleteServer}
              onCreateProject={handleCreateProject}
              onEditProject={handleEditProject}
              onDeleteProject={handleDeleteProject}
            />
          </SectionErrorBoundary>
          <div className="flex flex-1 min-w-0 flex-col bg-zinc-950 relative">
            {/* Floating project action buttons */}
            {activeProjectId && (
              <div className="absolute top-3 right-3 z-40 flex items-center gap-1.5">
                <button
                  onClick={async () => {
                    if (!window.electron?.system || !activeProjectPath) return
                    await window.electron.system.openInEditor(activeProjectPath)
                  }}
                  disabled={!activeProjectPath}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg text-zinc-500 hover:text-zinc-300 bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/50 hover:border-zinc-700/60 backdrop-blur-sm transition-all disabled:opacity-30 disabled:pointer-events-none"
                  title="Open in editor"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open
                </button>
                {activeProjectPath && (
                  <BranchSwitcher projectId={activeProjectId} projectPath={activeProjectPath} />
                )}
                <button
                  onClick={() => setIsGitDrawerOpen((prev) => !prev)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg backdrop-blur-sm transition-all border',
                    isGitDrawerOpen
                      ? 'text-blue-300 bg-blue-500/15 border-blue-500/30 hover:bg-blue-500/25'
                      : 'text-zinc-500 hover:text-zinc-300 bg-zinc-900/60 hover:bg-zinc-800/80 border-zinc-800/50 hover:border-zinc-700/60'
                  )}
                  title="Toggle git drawer"
                >
                  <GitCompare className="h-4 w-4" />
                  Git
                  {changedFileCount > 0 && (
                    <span className="ml-0.5 px-1.5 py-0 text-[11px] rounded bg-zinc-700/60">
                      {changedFileCount}
                    </span>
                  )}
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0">
              <SectionErrorBoundary name="Agent Workspace" className="h-full">
                {activeAgentProcess ? (
                  // New process-based agent (JSON streaming via child_process)
                  // key forces clean remount when switching agent sessions (e.g. project switch)
                  // while remaining stable during multi-turn within the same session
                  <AgentWorkspace
                    key={activeAgentSessionId}
                    processId={activeAgentProcess.id}
                    agentType={activeAgentProcess.agentType as 'claude' | 'codex' | 'gemini'}
                    cwd={activeAgentProcess.cwd}
                    resumeSessionId={activeAgentResumeSessionId}
                    projectId={activeProjectId ?? undefined}
                    className="h-full"
                  />
                ) : isAgentTerminal && agentConversation ? (
                  // Backwards compatible: PTY-based agent terminal
                  <AgentMessageView
                    key={activeAgentSessionId}
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
              </SectionErrorBoundary>
            </div>
            {isTerminalDockOpen ? (
              <SectionErrorBoundary name="Terminal Dock">
                <div
                  style={{ height: terminalDockHeight }}
                  className={cn(
                    'border-t border-zinc-800 bg-zinc-950 flex flex-col',
                    isTerminalResizing && 'select-none'
                  )}
                >
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize terminal dock"
                    onMouseDown={startTerminalResize}
                    className={cn(
                      'h-1 flex-shrink-0 cursor-row-resize flex items-center justify-center transition-colors',
                      isTerminalResizing ? 'bg-zinc-600' : 'hover:bg-zinc-700'
                    )}
                  >
                    <div className="w-8 h-0.5 rounded-full bg-zinc-600" />
                  </div>
                  <div className="flex-1 min-h-0">
                    <TerminalArea
                      onCreateTerminal={handleCreateTerminal}
                      onCreateQuickTerminal={handleCreateQuickTerminal}
                      onCloseTerminal={handleCloseTerminal}
                      onStopServer={handleStopServer}
                      onRestartServer={handleRestartServer}
                      onDeleteServer={handleDeleteServer}
                      onToggleCollapse={() => setTerminalDockOpen(false)}
                    />
                  </div>
                </div>
              </SectionErrorBoundary>
            ) : (
              <button
                className="h-10 border-t border-zinc-800 bg-zinc-950/90 px-4 text-left text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-3"
                onClick={() => setTerminalDockOpen(true)}
              >
                <ChevronUp className="h-4 w-4 text-zinc-500" />
                <span className="uppercase tracking-[0.2em] text-zinc-500">Terminal Dock</span>
                <span className="text-zinc-600">{visibleTerminalSessions.length} terminals</span>
                <span className="text-zinc-500 truncate">{activeTerminalLabel}</span>
              </button>
            )}
          </div>
          <SectionErrorBoundary name="Git Panel">
            <ChangedFilesPanel isOpen={isGitDrawerOpen} onClose={() => setIsGitDrawerOpen(false)} />
          </SectionErrorBoundary>
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
      <PermissionModal />
      {hookPromptState && (
        <HookInstallPrompt
          projectName={hookPromptState.projectName}
          onInstall={handleHookInstall}
          onSkip={handleHookSkip}
          onCancel={() => setHookPromptState(null)}
        />
      )}
      {showNewProjectModal && (
        <NewProjectModal onClose={() => setShowNewProjectModal(false)} />
      )}
      {editingProjectId && (
        <EditProjectModal
          projectId={editingProjectId}
          onClose={() => setEditingProjectId(null)}
          onDelete={(projectId) => { setEditingProjectId(null); handleDeleteProject(projectId) }}
        />
      )}
    </DndContext>
  )
}

export default App
