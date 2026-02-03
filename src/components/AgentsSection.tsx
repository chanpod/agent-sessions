/**
 * AgentsSection - Displays detected AI coding tools (Claude, Gemini, Codex)
 * with interactive launching and context management capabilities
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Bot, Gem, Code, Sparkles, Plus, FileText } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAgentContextStore } from '../stores/agent-context-store'
import { AgentLauncher } from './AgentLauncher'
import { AgentContextEditor } from './AgentContextEditor'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentsSectionProps {
  projectPath: string
  projectId: string
  onLaunchAgent?: (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => void
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

/**
 * Individual agent item display - now clickable for installed agents
 */
function AgentItem({
  agent,
  onClick,
}: {
  agent: CliToolDetectionResult
  onClick?: () => void
}) {
  const isClickable = agent.installed && onClick

  return (
    <li>
      <button
        onClick={isClickable ? onClick : undefined}
        disabled={!isClickable}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded text-zinc-400 transition-colors',
          isClickable && 'cursor-pointer hover:bg-zinc-800/60 hover:text-zinc-300',
          !isClickable && 'cursor-default'
        )}
      >
        {/* Status dot - green if installed, zinc/gray if not */}
        <span
          className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            agent.installed ? 'bg-green-500' : 'bg-zinc-600'
          )}
        />

        {/* Icon based on agent type */}
        <AgentIcon id={agent.id} className="w-4 h-4 flex-shrink-0" />

        {/* Name */}
        <span className="truncate flex-1 text-left">{agent.name}</span>

        {/* Version or "Not installed" */}
        <span className="text-xs text-zinc-600">
          {agent.installed ? agent.version || 'installed' : 'not found'}
        </span>
      </button>
    </li>
  )
}

export function AgentsSection({ projectPath, projectId, onLaunchAgent }: AgentsSectionProps) {
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [showLauncher, setShowLauncher] = useState(false)
  const [showContextEditor, setShowContextEditor] = useState(false)
  const [editingContextId, setEditingContextId] = useState<string | undefined>()
  const [preselectedAgentId, setPreselectedAgentId] = useState<string | undefined>()

  // Context store
  const { contexts, getActiveContext, loadContexts, isLoaded, currentProjectId } = useAgentContextStore()
  const loadedProjectRef = useRef<string | null>(null)

  // Load contexts when project changes
  useEffect(() => {
    if (projectId && loadedProjectRef.current !== projectId) {
      loadedProjectRef.current = projectId
      loadContexts(projectId)
    }
  }, [projectId, loadContexts])

  // Filter contexts for this project
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
        setAgents(result.tools) // Still show tools even if detection had errors
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed')
    } finally {
      setLoading(false)
    }
  }, [projectPath, projectId])

  // Detect agents on mount and when projectPath/projectId changes
  useEffect(() => {
    detectAgents()
  }, [detectAgents])

  const handleRefresh = () => {
    detectAgents(true) // Force refresh bypasses cache
  }

  // Handle clicking on an installed agent - quick launch with active context
  const handleAgentClick = (agent: CliToolDetectionResult) => {
    if (!agent.installed) return

    // Quick launch with active context if callback exists
    if (onLaunchAgent && activeContext) {
      onLaunchAgent(agent.id, activeContext.id, activeContext.content)
    } else {
      // Open launcher with this agent preselected
      setPreselectedAgentId(agent.id)
      setShowLauncher(true)
    }
  }

  // Open launcher modal
  const handleOpenLauncher = () => {
    setPreselectedAgentId(undefined)
    setShowLauncher(true)
  }

  // Handle launch from modal
  const handleLaunch = (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => {
    console.log('[AgentsSection] Launching agent:', { agentId, contextId, contextContent: contextContent?.substring(0, 100), skipPermissions })
    onLaunchAgent?.(agentId, contextId, contextContent, skipPermissions)
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

  // Get installed agents for the launcher
  const installedAgents = agents.filter((a) => a.installed)

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

        {/* Error message */}
        {error && (
          <p className="text-xs text-red-400 px-2 py-1">{error}</p>
        )}

        {/* Loading state */}
        {loading && agents.length === 0 && (
          <p className="text-sm text-zinc-600 px-2 py-1">Detecting agents...</p>
        )}

        {/* No agents found */}
        {!loading && agents.length === 0 && !error && (
          <p className="text-sm text-zinc-600 px-2 py-1">No AI tools detected</p>
        )}

        {/* Agent list */}
        {agents.length > 0 && (
          <ul className="space-y-0.5">
            {agents.map((agent) => (
              <AgentItem
                key={agent.id}
                agent={agent}
                onClick={agent.installed ? () => handleAgentClick(agent) : undefined}
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
    </>
  )
}
