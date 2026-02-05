/**
 * AgentTerminalsSection - Displays agent terminals (terminalType === 'agent')
 * for a specific project, with ability to launch new agent terminals
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Bot, Code, Gem, GripVertical, LayoutDashboard, LayoutGrid, Pencil, Plus, RefreshCw, Settings2, Sparkles, X } from 'lucide-react'
import { useTerminalStore, type TerminalSession } from '../stores/terminal-store'
import { useViewStore } from '../stores/view-store'
import { useProjectStore } from '../stores/project-store'
import { useAgentContextStore } from '../stores/agent-context-store'
import { useGridStore } from '../stores/grid-store'
import { ActivityIndicator } from './ActivityIndicator'
import { usePermissionStore } from '../stores/permission-store'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import { ShieldAlert } from 'lucide-react'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { AgentLauncher } from './AgentLauncher'
import { AgentContextEditor } from './AgentContextEditor'
import AgentContextManager from './AgentContextManager'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentTerminalsSectionProps {
  projectId: string
  projectPath: string
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onLaunchAgent: (projectId: string, agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => void
}

/**
 * Get the appropriate icon for an agent based on its ID
 */
function AgentIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'claude':
      return <Sparkles className={className} />
    case 'gemini':
      return <Gem className={className} />
    case 'codex':
      return <Code className={className} />
    default:
      return <Bot className={className} />
  }
}

function AgentSessionRow({
  session,
  isActive,
  onSelect,
  onClose,
  onReconnect,
  dragHandleProps,
  contextLabel,
}: {
  session: TerminalSession
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onReconnect?: () => void
  dragHandleProps?: Record<string, unknown>
  contextLabel?: string
}) {
  const { updateSessionTitle } = useTerminalStore()
  const { setProjectTerminalActive } = useViewStore()
  const dashboard = useGridStore((state) => state.dashboard)
  const addTerminalToDashboard = useGridStore((state) => state.addTerminalToDashboard)
  const removeTerminalFromDashboard = useGridStore((state) => state.removeTerminalFromDashboard)

  const isInDashboard = dashboard.terminalRefs.includes(session.id)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check if this session has pending permission requests
  const cliSessionId = useAgentStreamStore((s) => s.terminalToSession.get(session.id))
  const hasPendingPermission = usePermissionStore((s) =>
    cliSessionId ? s.pendingRequests.some((r) => r.sessionId === cliSessionId) : false
  )

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSelect = () => {
    if (isEditing) return
    onSelect()
    if (session.projectId) {
      setProjectTerminalActive(session.projectId, session.id)
    }
  }

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(session.title)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (editValue.trim()) {
      updateSessionTitle(session.id, editValue.trim())
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={(e) => !isEditing && e.key === 'Enter' && handleSelect()}
        className={cn(
          'group flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-all',
          isActive
            ? 'border-emerald-400/40 bg-emerald-400/10 text-foreground shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)]'
            : 'border-border/60 bg-card/50 hover:bg-card/80'
        )}
      >
        <div
          className="active:cursor-grabbing touch-none rounded-md p-1 text-muted-foreground/70 hover:text-foreground"
          {...dragHandleProps}
          style={{ cursor: 'grab' }}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </div>
        <div className="rounded-md bg-muted/40 p-1.5">
          <AgentIcon id={session.agentId || ''} className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ActivityIndicator sessionId={session.id} className="w-2 h-2" />
          {hasPendingPermission && (
            <span title="Awaiting permission">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 animate-pulse flex-shrink-0" />
            </span>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-full min-w-0 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs text-foreground outline-none focus:border-emerald-400"
              />
            ) : (
              <span
                className="truncate text-sm font-medium"
                onDoubleClick={handleStartEdit}
                title="Double-click to rename"
              >
                {session.title}
              </span>
            )}
            {contextLabel && !isEditing && (
              <Badge variant="outline" className="border-emerald-400/30 text-emerald-200/80">
                {contextLabel}
              </Badge>
            )}
          </div>
        </div>

        {session.status === 'exited' && (
          <span className="text-xs text-muted-foreground">exited</span>
        )}

        {!isEditing && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation()
              if (isInDashboard) {
                removeTerminalFromDashboard(session.id)
              } else {
                addTerminalToDashboard(session.id)
              }
            }}
            className={cn(
              'opacity-0 group-hover:opacity-100',
              isInDashboard ? 'text-sky-300 hover:text-sky-200' : 'text-muted-foreground'
            )}
            title={isInDashboard ? 'Remove from Dashboard' : 'Add to Dashboard'}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
          </Button>
        )}

        {!isEditing && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleStartEdit}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
            title="Rename"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        )}

        {!isEditing && (session.sshConnectionId || session.shell === 'ssh') && onReconnect && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation()
              onReconnect()
            }}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
            title="Reconnect SSH"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </li>
  )
}

export function AgentTerminalsSection({
  projectId,
  projectPath,
  onCloseTerminal,
  onReconnectTerminal,
  onLaunchAgent,
}: AgentTerminalsSectionProps) {
  const { sessions, activeAgentSessionId, setActiveSession, setActiveAgentSession } = useTerminalStore()
  const { activeView, setProjectGridActive } = useViewStore()
  const { projects } = useProjectStore()
  const { contexts, activeContextId, loadContexts } = useAgentContextStore()

  // Agent detection state
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const loadedProjectRef = useRef<string | null>(null)

  // Modal state
  const [showLauncher, setShowLauncher] = useState(false)
  const [showContextEditor, setShowContextEditor] = useState(false)
  const [showContextManager, setShowContextManager] = useState(false)
  const [editingContextId, setEditingContextId] = useState<string | undefined>()

  // Derive project name from store
  const projectName = projects.find((p) => p.id === projectId)?.name || 'Unknown Project'
  const projectContexts = useMemo(
    () => contexts.filter((context) => context.projectId === projectId),
    [contexts, projectId]
  )
  const activeContext = projectContexts.find((context) => context.id === activeContextId) ?? null

  // Load contexts when project changes
  useEffect(() => {
    if (projectId && loadedProjectRef.current !== projectId) {
      loadedProjectRef.current = projectId
      loadContexts(projectId)
    }
  }, [projectId, loadContexts])

  // Detect agents
  const detectAgents = useCallback(async () => {
    if (!window.electron?.cli) return

    try {
      const result = await window.electron.cli.detectAll(projectPath, projectId)
      if (result.success || result.tools) {
        setAgents(result.tools)
      }
    } catch (err) {
      console.error('Agent detection failed:', err)
    }
  }, [projectPath, projectId])

  useEffect(() => {
    detectAgents()
  }, [detectAgents])

  // Filter sessions to only agent terminals for this project
  const agentSessions = sessions.filter(
    (s) => s.projectId === projectId && s.terminalType === 'agent'
  )

  const contextNameById = useMemo(() => {
    const map = new Map<string, string>()
    projectContexts.forEach((context) => map.set(context.id, context.name))
    return map
  }, [projectContexts])


  // Check if currently in project grid view for this project
  const isInGridView = activeView.type === 'project-grid' && activeView.projectId === projectId

  // Get installed agents for the launcher
  const installedAgents = agents.filter((a) => a.installed)

  // Handle launch from modal
  const handleLaunch = (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => {
    onLaunchAgent(projectId, agentId, contextId, contextContent, skipPermissions)
    setShowLauncher(false)
  }

  // Handle edit context from launcher
  const handleEditContext = (contextId?: string) => {
    setEditingContextId(contextId)
    setShowContextEditor(true)
  }

  // Close context editor
  const handleCloseContextEditor = () => {
    setShowContextEditor(false)
    setEditingContextId(undefined)
  }

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              Agents
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowLauncher(true)}
                disabled={installedAgents.length === 0}
                className="text-muted-foreground hover:text-foreground"
                title="New session"
              >
                <Plus className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowContextManager(true)}
                className="text-muted-foreground hover:text-foreground"
                title="Project contexts"
              >
                <Settings2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant="secondary"
              className={cn(
                'border',
                installedAgents.some(a => a.id === 'claude' && a.installed)
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/20'
                  : 'bg-muted/40 text-muted-foreground border-border/60'
              )}
            >
              Claude
            </Badge>
            <Badge
              variant="secondary"
              className={cn(
                'border',
                installedAgents.some(a => a.id === 'codex' && a.installed)
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                  : 'bg-muted/40 text-muted-foreground border-border/60'
              )}
            >
              Codex
            </Badge>
            <Badge
              variant="secondary"
              className={cn(
                'border',
                installedAgents.some(a => a.id === 'gemini' && a.installed)
                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/20'
                  : 'bg-muted/40 text-muted-foreground border-border/60'
              )}
            >
              Gemini
            </Badge>
            {activeContext ? (
              <Badge variant="outline" className="border-emerald-400/30 text-emerald-200/80">
                Context: {activeContext.name}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-border/60 text-muted-foreground">
                No context
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              Sessions
            </div>
            <div className="flex items-center gap-1">
              {agentSessions.length > 1 && (
                <Button
                  variant={isInGridView ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setProjectGridActive(projectId)}
                  className="gap-1.5 border-sidebar-border/60"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Dashboard
                </Button>
              )}
            </div>
          </div>
          <Separator className="bg-border/60" />
          {agentSessions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-sidebar-border/70 bg-card/40 px-3 py-4 text-center text-sm text-muted-foreground">
              No agent terminals yet. Launch one to begin a session.
            </div>
          ) : (
            <ul className="space-y-2">
              {agentSessions.map((session) => {
                const contextLabel = session.contextId
                  ? contextNameById.get(session.contextId)
                  : session.contextInjected
                    ? 'Context'
                    : undefined
                return (
                  <DraggableTerminalItem
                    key={session.id}
                    terminalId={session.id}
                    terminalTitle={session.title}
                  >
                    <AgentSessionRow
                      session={session}
                      isActive={activeAgentSessionId === session.id}
                      onSelect={() => {
                        setActiveSession(session.id)
                        setActiveAgentSession(session.id)
                      }}
                      onClose={() => onCloseTerminal(session.id)}
                      onReconnect={() => onReconnectTerminal(session.id)}
                      contextLabel={contextLabel}
                    />
                  </DraggableTerminalItem>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Agent Launcher Modal */}
      {showLauncher && (
        <AgentLauncher
          projectId={projectId}
          projectPath={projectPath}
          installedAgents={agents}
          onLaunch={handleLaunch}
          onClose={() => setShowLauncher(false)}
          onEditContext={handleEditContext}
        />
      )}

      {/* Agent Context Editor Modal */}
      {showContextEditor && (
        <AgentContextEditor
          projectId={projectId}
          contextId={editingContextId}
          onClose={handleCloseContextEditor}
        />
      )}

      {/* Agent Context Manager Modal */}
      <AgentContextManager
        isOpen={showContextManager}
        onClose={() => setShowContextManager(false)}
        projectId={projectId}
        projectName={projectName}
      />
    </>
  )
}
