/**
 * AgentTerminalsSection - Displays agent terminals (terminalType === 'agent')
 * for a specific project, with ability to launch new agent terminals
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Bot, Code, Gem, Package, Pencil, Plus, RefreshCw, Settings2, Sparkles, X } from 'lucide-react'
import { useTerminalStore, type TerminalSession } from '../stores/terminal-store'
import { useViewStore } from '../stores/view-store'
import { useProjectStore } from '../stores/project-store'
import { useAgentContextStore } from '../stores/agent-context-store'
import { AgentStatusIcon } from './AgentStatusIcon'
import { usePermissionStore } from '../stores/permission-store'
import { useAgentStreamStore } from '../stores/agent-stream-store'
import { ShieldAlert } from 'lucide-react'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { AgentLauncher } from './AgentLauncher'
import { AgentContextEditor } from './AgentContextEditor'
import { AgentUpdateDialog } from './AgentUpdateDialog'
import AgentContextManager from './AgentContextManager'
import { SkillBrowser, type InstalledSkill, type MarketplaceSkill } from './skills/SkillBrowser'
import { cn, formatModelDisplayName } from '../lib/utils'
import { Button } from './ui/button'
import type { CliToolDetectionResult, UpdateCheckResult } from '../types/electron'

interface AgentTerminalsSectionProps {
  projectId: string
  projectPath: string
  /** SSH connection status — triggers CLI re-detection when connection is established */
  sshConnected?: boolean
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onLaunchAgent: (projectId: string, agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean, model?: string | null) => void
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
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check if this session has pending permission requests
  const cliSessionId = useAgentStreamStore((s) => s.terminalToSession.get(session.id))
  const hasPendingPermission = usePermissionStore((s) =>
    cliSessionId ? s.pendingRequests.some((r) => r.sessionId === cliSessionId) : false
  )

  // Get the actual model from stream messages (includes version like "claude-opus-4-6-20260101")
  const streamModel = useAgentStreamStore((store) => {
    const conv = store.conversations.get(session.id)
    const pids = conv?.processIds ?? [session.id]
    for (let i = pids.length - 1; i >= 0; i--) {
      const pid = pids[i]
      if (!pid) continue
      const state = store.terminals.get(pid)
      if (!state) continue
      if (state.currentMessage?.model) return state.currentMessage.model
      for (let j = state.messages.length - 1; j >= 0; j--) {
        const msg = state.messages[j]
        if (msg?.model) return msg.model
      }
    }
    return null
  })

  // Format model name: "claude-opus-4-6-20260101" → "Opus 4.6", "o3" → "o3", etc.
  const modelLabel = useMemo(() => {
    const raw = streamModel || session.model
    if (!raw) return null
    return formatModelDisplayName(raw)
  }, [streamModel, session.model])

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

  const isExited = session.status === 'exited'
  const isSsh = !!(session.sshConnectionId || session.shell === 'ssh')

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={(e) => !isEditing && e.key === 'Enter' && handleSelect()}
        className={cn(
          'group relative flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-all',
          isActive
            ? 'border-emerald-400/40 bg-emerald-400/10 text-foreground shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)]'
            : 'border-transparent bg-transparent hover:bg-card/60'
        )}
      >
        {/* Drag handle - slim left edge */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-grab rounded-l-lg opacity-0 group-hover:opacity-100 active:cursor-grabbing active:opacity-100 transition-opacity touch-none flex items-center justify-center"
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-0.5 h-4 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Agent icon with status overlay */}
        <div className="relative shrink-0 mt-0.5">
          <div className={cn(
            'rounded-md p-1.5 transition-colors',
            isActive ? 'bg-emerald-400/15' : 'bg-muted/50'
          )}>
            <AgentIcon id={session.agentId || ''} className={cn(
              'w-4 h-4',
              isActive ? 'text-emerald-300' : 'text-muted-foreground'
            )} />
          </div>
          {/* Status dot overlay — bottom-right corner of icon */}
          <div className="absolute -bottom-0.5 -right-0.5">
            <AgentStatusIcon sessionId={session.id} className="w-2 h-2" />
          </div>
        </div>

        {/* Content area - two lines */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Top row: title + close button */}
          <div className="flex items-center gap-1.5">
            {hasPendingPermission && (
              <span title="Awaiting permission"><ShieldAlert className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" /></span>
            )}
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
                className="w-full min-w-0 rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-emerald-400"
              />
            ) : (
              <span
                className="truncate text-[13px] font-medium leading-tight"
                onDoubleClick={handleStartEdit}
                title={session.title}
              >
                {session.title}
              </span>
            )}

            {/* Hover actions — float right */}
            {!isEditing && (
              <div className="ml-auto flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleStartEdit}
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  title="Rename"
                >
                  <Pencil className="w-3 h-3" />
                </Button>
                {isSsh && onReconnect && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => { e.stopPropagation(); onReconnect() }}
                    className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    title="Reconnect SSH"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => { e.stopPropagation(); onClose() }}
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  title="Close"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Bottom row: metadata badges */}
          {!isEditing && (
            <div className="flex items-center gap-1.5 text-[10px]">
              {modelLabel && (
                <span className="text-violet-300/70">{modelLabel}</span>
              )}
              {modelLabel && (contextLabel || isExited) && (
                <span className="text-muted-foreground/40">&middot;</span>
              )}
              {contextLabel && (
                <span className="text-emerald-300/70 truncate">{contextLabel}</span>
              )}
              {contextLabel && isExited && (
                <span className="text-muted-foreground/40">&middot;</span>
              )}
              {isExited && (
                <span className="text-muted-foreground/60">exited</span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export function AgentTerminalsSection({
  projectId,
  projectPath,
  sshConnected,
  onCloseTerminal,
  onReconnectTerminal,
  onLaunchAgent,
}: AgentTerminalsSectionProps) {
  const { sessions, activeAgentSessionId, setActiveSession, setActiveAgentSession } = useTerminalStore()
  const { projects } = useProjectStore()
  const { contexts, activeContextId, loadContexts } = useAgentContextStore()

  // Agent detection state
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const loadedProjectRef = useRef<string | null>(null)

  // Update state
  const [updateAvailable, setUpdateAvailable] = useState<Record<string, UpdateCheckResult>>({})
  const [updateAgent, setUpdateAgent] = useState<CliToolDetectionResult | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'windows' | 'macos' | 'linux'>('linux')

  // Modal state
  const [showLauncher, setShowLauncher] = useState(false)
  const [showContextEditor, setShowContextEditor] = useState(false)
  const [showContextManager, setShowContextManager] = useState(false)
  const [showSkillBrowser, setShowSkillBrowser] = useState(false)
  const [editingContextId, setEditingContextId] = useState<string | undefined>()

  // Skills state
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)

  // Load skills when browser opens
  const loadSkills = useCallback(async () => {
    if (!window.electron?.skill) return
    setSkillsLoading(true)
    try {
      const [installedRes, availableRes] = await Promise.all([
        window.electron.skill.listInstalled(),
        window.electron.skill.listAvailable(),
      ])

      if (installedRes.success && installedRes.skills) {
        setInstalledSkills(
          installedRes.skills.map((s: Record<string, unknown>) => ({
            id: String(s.id ?? ''),
            name: String(s.id ?? '').split('@')[0],
            version: String(s.version ?? ''),
            scope: (s.scope as InstalledSkill['scope']) ?? 'user',
            enabled: s.enabled !== false,
            installPath: String(s.installPath ?? ''),
            installedAt: String(s.installedAt ?? ''),
            lastUpdated: String(s.lastUpdated ?? ''),
            projectPath: s.projectPath as string | undefined,
            marketplace: String(s.id ?? '').split('@')[1],
          }))
        )
      }

      if (availableRes.success && availableRes.skills) {
        setMarketplaceSkills(
          availableRes.skills.map((s: Record<string, unknown>) => ({
            id: String(s.pluginId ?? s.name ?? ''),
            name: String(s.name ?? String(s.pluginId ?? '').split('@')[0]),
            description: String(s.description ?? ''),
            source: 'anthropic' as const,
            category: s.category as MarketplaceSkill['category'],
            version: s.version as string | undefined,
            installCount: s.installCount as number | undefined,
            homepage: s.homepage as string | undefined,
          }))
        )
      }
    } catch (err) {
      console.error('[Skills] Failed to load:', err)
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (showSkillBrowser) loadSkills()
  }, [showSkillBrowser, loadSkills])

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
  const [detectingAgents, setDetectingAgents] = useState(false)
  const detectAgents = useCallback(async (forceRefresh = false) => {
    if (!window.electron?.cli) return

    if (forceRefresh) setDetectingAgents(true)
    try {
      const result = await window.electron.cli.detectAll(projectPath, projectId, forceRefresh)
      if (result.success || result.tools) {
        setAgents(result.tools)
      }
    } catch (err) {
      console.error('Agent detection failed:', err)
    } finally {
      setDetectingAgents(false)
    }
  // sshConnected triggers re-detection when SSH tunnel is established
  }, [projectPath, projectId, sshConnected])

  useEffect(() => {
    // For SSH projects, force refresh to bypass any stale cache from failed detection
    // attempts that may have run before the SSH tunnel was fully established.
    detectAgents(!!sshConnected)
  }, [detectAgents, sshConnected])

  // Detect platform for update dialog
  useEffect(() => {
    if (window.electron?.cli?.getPlatform) {
      window.electron.cli.getPlatform().then(setPlatform)
    }
  }, [])

  // Check all updates after agent detection
  const checkAllUpdates = useCallback(async (agentList: CliToolDetectionResult[]) => {
    if (!window.electron?.cli?.checkUpdates) return

    const installed = agentList.filter((a) => a.installed && a.version)
    if (installed.length === 0) return

    try {
      const results = await window.electron.cli.checkUpdates(
        installed.map((a) => ({ id: a.id, version: a.version || null }))
      )
      const map: Record<string, UpdateCheckResult> = {}
      for (const r of results) {
        map[r.agentId] = r
      }
      setUpdateAvailable(map)
    } catch {
      // Silently fail - update checks are non-critical
    }
  }, [])

  // Check single update (for the update dialog)
  const checkSingleUpdate = useCallback(async (agentId: string, currentVersion: string | null) => {
    if (!window.electron?.cli?.checkUpdate) return

    setCheckingUpdate(agentId)
    try {
      const result = await window.electron.cli.checkUpdate(agentId, currentVersion)
      setUpdateAvailable((prev) => ({ ...prev, [agentId]: result }))
    } catch {
      // Silently fail
    } finally {
      setCheckingUpdate(null)
    }
  }, [])

  // Trigger update check when agents are detected
  useEffect(() => {
    if (agents.length > 0) {
      checkAllUpdates(agents)
    }
  }, [agents, checkAllUpdates])

  // Filter sessions to only agent terminals for this project
  const agentSessions = sessions.filter(
    (s) => s.projectId === projectId && s.terminalType === 'agent'
  )

  const contextNameById = useMemo(() => {
    const map = new Map<string, string>()
    projectContexts.forEach((context) => map.set(context.id, context.name))
    return map
  }, [projectContexts])


  // Get installed agents for the launcher
  const installedAgents = agents.filter((a) => a.installed)

  // Handle launch from modal
  const handleLaunch = (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean, model?: string | null) => {
    onLaunchAgent(projectId, agentId, contextId, contextContent, skipPermissions, model)
    setShowLauncher(false)
  }

  // Handle update click from launcher
  const handleUpdateClick = (agent: CliToolDetectionResult) => {
    setUpdateAgent(agent)
    if (agent.version) {
      checkSingleUpdate(agent.id, agent.version)
    }
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
      <div className="space-y-2">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground">
              Sessions
            </span>
            {activeContext && (
              <span className="text-[10px] text-emerald-300/70 truncate max-w-[100px]" title={`Context: ${activeContext.name}`}>
                {activeContext.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => detectAgents(true)}
              disabled={detectingAgents}
              className="text-muted-foreground hover:text-foreground h-7 w-7"
              title="Refresh agent detection"
            >
              <RefreshCw className={cn('w-4 h-4', detectingAgents && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowLauncher(true)}
              disabled={installedAgents.length === 0}
              className="text-muted-foreground hover:text-foreground h-7 w-7"
              title="New session"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowSkillBrowser(true)}
              className="text-muted-foreground hover:text-foreground h-7 w-7"
              title="Browse skills"
            >
              <Package className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowContextManager(true)}
              className="text-muted-foreground hover:text-foreground h-7 w-7"
              title="Project contexts"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Session list */}
        {agentSessions.length === 0 ? (
          <button
            onClick={() => installedAgents.length > 0 && setShowLauncher(true)}
            disabled={installedAgents.length === 0}
            className="w-full rounded-lg border border-dashed border-sidebar-border/70 bg-card/30 px-3 py-3 text-center text-xs text-muted-foreground hover:bg-card/50 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-default"
          >
            Launch an agent session to get started
          </button>
        ) : (
          <ul className="space-y-1">
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

      {/* Agent Launcher Modal */}
      {showLauncher && (
        <AgentLauncher
          projectId={projectId}
          projectPath={projectPath}
          installedAgents={agents}
          onLaunch={handleLaunch}
          onClose={() => setShowLauncher(false)}
          onEditContext={handleEditContext}
          updateInfo={updateAvailable}
          onUpdateAgent={handleUpdateClick}
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

      {/* Skill Browser Modal */}
      <SkillBrowser
        open={showSkillBrowser}
        onClose={() => setShowSkillBrowser(false)}
        installedSkills={installedSkills}
        marketplaceSkills={marketplaceSkills}
        onInstall={async (skill, scope) => {
          if (!window.electron?.skill) return
          const res = await window.electron.skill.install(skill.id, skill.source, scope)
          if (res.success) await loadSkills()
        }}
        onUninstall={async (skill) => {
          if (!window.electron?.skill) return
          const res = await window.electron.skill.uninstall(skill.id)
          if (res.success) await loadSkills()
        }}
        onToggleEnabled={async (skill, enabled) => {
          if (!window.electron?.skill) return
          const res = await window.electron.skill.toggleEnabled(skill.id, enabled)
          if (res.success) await loadSkills()
        }}
        onSearchVercel={async (query) => {
          if (!window.electron?.skill) return []
          const res = await window.electron.skill.searchVercel(query, 20)
          if (!res.success || !res.skills) return []
          return res.skills.map((s: Record<string, unknown>) => ({
            id: String(s.source ?? '') + '/' + String(s.skillId ?? ''),
            name: String(s.name ?? s.skillId ?? ''),
            description: `From ${String(s.source ?? 'unknown')}`,
            source: 'vercel' as const,
            installCount: (s.installs as number) ?? undefined,
          }))
        }}
        isLoading={skillsLoading}
      />

      {/* Agent Update Dialog */}
      {updateAgent && (
        <AgentUpdateDialog
          isOpen={!!updateAgent}
          onClose={() => setUpdateAgent(null)}
          agent={updateAgent}
          updateInfo={updateAvailable[updateAgent.id] || null}
          isCheckingUpdate={checkingUpdate === updateAgent.id}
          platform={platform}
          onRefresh={async () => {
            if (updateAgent.version) {
              await checkSingleUpdate(updateAgent.id, updateAgent.version)
            }
          }}
          onInstall={async (method) => {
            if (!window.electron?.cli?.install) {
              return { success: false, output: 'Installation not available' }
            }
            return await window.electron.cli.install(updateAgent.id, method)
          }}
          onInstallComplete={async () => {
            await new Promise(resolve => setTimeout(resolve, 500))
            await detectAgents(true)
          }}
        />
      )}
    </>
  )
}
