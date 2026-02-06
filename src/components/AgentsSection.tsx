/**
 * AgentsSection - Displays detected AI coding tools (Claude, Gemini, Codex)
 * with interactive launching, update indicators, and context management
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Bot, Gem, Code, Sparkles, Plus, FileText, Download, Package, Globe } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAgentContextStore } from '../stores/agent-context-store'
import { AgentLauncher } from './AgentLauncher'
import { AgentContextEditor } from './AgentContextEditor'
import { AgentUpdateDialog } from './AgentUpdateDialog'
import type { CliToolDetectionResult, UpdateCheckResult } from '../types/electron'

interface AgentsSectionProps {
  projectPath: string
  projectId: string
  onLaunchAgent?: (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => void
}

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

/** Short label for install method */
function getMethodShortLabel(method: 'npm' | 'native' | 'brew' | 'unknown'): string {
  switch (method) {
    case 'native': return 'native';
    case 'npm': return 'npm';
    case 'brew': return 'brew';
    case 'unknown': return '';
  }
}

function AgentItem({
  agent,
  updateInfo,
  onClick,
  onUpdateClick,
}: {
  agent: CliToolDetectionResult
  updateInfo?: UpdateCheckResult
  onClick?: () => void
  onUpdateClick?: () => void
}) {
  const isClickable = agent.installed && onClick
  const hasUpdate = updateInfo?.updateAvailable
  const method = agent.installMethod || 'unknown'
  const methodLabel = getMethodShortLabel(method)

  return (
    <li>
      <div className="flex items-center gap-1">
        <button
          onClick={isClickable ? onClick : undefined}
          disabled={!isClickable}
          className={cn(
            'flex-1 flex items-center gap-2 px-2 py-1.5 text-sm rounded text-zinc-400 transition-colors min-w-0',
            isClickable && 'cursor-pointer hover:bg-zinc-800/60 hover:text-zinc-300',
            !isClickable && 'cursor-default'
          )}
        >
          {/* Status dot */}
          <span
            className={cn(
              'w-2 h-2 rounded-full flex-shrink-0',
              agent.installed ? 'bg-green-500' : 'bg-zinc-600'
            )}
          />

          <AgentIcon id={agent.id} className="w-4 h-4 flex-shrink-0" />

          <span className="truncate flex-1 text-left">{agent.name}</span>

          {/* Version + method badge */}
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {agent.installed && methodLabel && (
              <span className={cn(
                'flex items-center gap-0.5 px-1 py-0 text-[10px] rounded border',
                method === 'native' ? 'bg-emerald-500/10 text-emerald-500/70 border-emerald-500/20' :
                method === 'npm' ? 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' :
                method === 'brew' ? 'bg-amber-500/10 text-amber-500/70 border-amber-500/20' :
                'bg-zinc-500/10 text-zinc-600 border-zinc-500/20'
              )}>
                {method === 'native' ? (
                  <Globe className="w-2.5 h-2.5" />
                ) : (
                  <Package className="w-2.5 h-2.5" />
                )}
                {methodLabel}
              </span>
            )}
            <span className="text-xs text-zinc-600">
              {agent.installed ? agent.version || 'installed' : 'not found'}
            </span>
          </span>
        </button>

        {/* Update button */}
        {hasUpdate && onUpdateClick && (
          <button
            onClick={onUpdateClick}
            className="p-1 rounded text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors flex-shrink-0"
            title={`Update available: v${updateInfo.latestVersion}`}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </li>
  )
}

export function AgentsSection({ projectPath, projectId, onLaunchAgent }: AgentsSectionProps) {
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'windows' | 'wsl' | 'macos' | 'linux'>('linux')

  // Update state
  const [updateAvailable, setUpdateAvailable] = useState<Record<string, UpdateCheckResult>>({})
  const [updateAgent, setUpdateAgent] = useState<CliToolDetectionResult | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState<string | null>(null)

  // Modal state
  const [showLauncher, setShowLauncher] = useState(false)
  const [showContextEditor, setShowContextEditor] = useState(false)
  const [editingContextId, setEditingContextId] = useState<string | undefined>()
  const [, setPreselectedAgentId] = useState<string | undefined>()

  // Context store
  const { contexts, getActiveContext, loadContexts } = useAgentContextStore()
  const loadedProjectRef = useRef<string | null>(null)

  // Load contexts when project changes
  useEffect(() => {
    if (projectId && loadedProjectRef.current !== projectId) {
      loadedProjectRef.current = projectId
      loadContexts(projectId)
    }
  }, [projectId, loadContexts])

  // Detect platform
  useEffect(() => {
    if (window.electron?.cli?.getPlatform) {
      window.electron.cli.getPlatform().then(setPlatform)
    }
  }, [])

  const projectContexts = contexts.filter(c => c.projectId === projectId)
  const contextCount = projectContexts.length
  const activeContext = getActiveContext()

  const detectAgents = useCallback(async (forceRefresh = false) => {
    if (!window.electron?.cli) {
      setError('CLI detection not available')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.electron.cli.detectAll(projectPath, projectId, forceRefresh)

      if (result.success) {
        setAgents(result.tools)
      } else {
        setError(result.error || 'Detection failed')
        setAgents(result.tools)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed')
    } finally {
      setLoading(false)
    }
  }, [projectPath, projectId])

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

  // Check single update (for the dialog)
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

  // Detect agents on mount
  useEffect(() => {
    detectAgents()
  }, [detectAgents])

  // Check for updates when agents are detected
  useEffect(() => {
    if (agents.length > 0) {
      checkAllUpdates(agents)
    }
  }, [agents, checkAllUpdates])

  const handleRefresh = () => {
    detectAgents(true)
  }

  const handleAgentClick = (agent: CliToolDetectionResult) => {
    if (!agent.installed) return

    if (onLaunchAgent && activeContext) {
      onLaunchAgent(agent.id, activeContext.id, activeContext.content)
    } else {
      setPreselectedAgentId(agent.id)
      setShowLauncher(true)
    }
  }

  const handleOpenLauncher = () => {
    setPreselectedAgentId(undefined)
    setShowLauncher(true)
  }

  const handleLaunch = (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => {
    onLaunchAgent?.(agentId, contextId, contextContent, skipPermissions)
    setShowLauncher(false)
  }

  const handleEditContext = (contextId?: string) => {
    setEditingContextId(contextId)
    setShowContextEditor(true)
  }

  const handleCloseContextEditor = () => {
    setShowContextEditor(false)
    setEditingContextId(undefined)
  }

  const handleUpdateClick = (agent: CliToolDetectionResult) => {
    setUpdateAgent(agent)
    if (agent.version) {
      checkSingleUpdate(agent.id, agent.version)
    }
  }

  const installedAgents = agents.filter((a) => a.installed)
  const totalUpdates = Object.values(updateAvailable).filter(u => u.updateAvailable).length

  return (
    <>
      <div className="mb-4 bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
        <div className="flex items-center justify-between px-2 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Agents
            </span>
            {/* Context count badge */}
            {contextCount > 0 && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-zinc-800 text-zinc-500 rounded"
                title={`${contextCount} saved context${contextCount !== 1 ? 's' : ''}`}
              >
                <FileText className="w-3 h-3" />
                {contextCount}
              </span>
            )}
            {/* Updates available badge */}
            {totalUpdates > 0 && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-500/15 text-amber-400 rounded border border-amber-500/20"
                title={`${totalUpdates} update${totalUpdates !== 1 ? 's' : ''} available`}
              >
                <Download className="w-3 h-3" />
                {totalUpdates}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Launch button */}
            <button
              onClick={handleOpenLauncher}
              disabled={installedAgents.length === 0}
              className={cn(
                'p-1 rounded text-zinc-500 transition-colors',
                installedAgents.length > 0
                  ? 'hover:bg-blue-500/20 hover:text-blue-400'
                  : 'opacity-50 cursor-not-allowed'
              )}
              title={installedAgents.length > 0 ? 'Launch agent' : 'No agents installed'}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              title="Refresh agent detection"
            >
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 px-2 py-1">{error}</p>
        )}

        {loading && agents.length === 0 && (
          <p className="text-sm text-zinc-600 px-2 py-1">Detecting agents...</p>
        )}

        {!loading && agents.length === 0 && !error && (
          <p className="text-sm text-zinc-600 px-2 py-1">No AI tools detected</p>
        )}

        {agents.length > 0 && (
          <ul className="space-y-0.5">
            {agents.map((agent) => (
              <AgentItem
                key={agent.id}
                agent={agent}
                updateInfo={updateAvailable[agent.id]}
                onClick={agent.installed ? () => handleAgentClick(agent) : undefined}
                onUpdateClick={agent.installed ? () => handleUpdateClick(agent) : undefined}
              />
            ))}
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
