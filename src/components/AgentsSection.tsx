/**
 * AgentsSection - Displays detected AI coding tools (Claude, Gemini, Codex)
 */

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Bot, Gem, Code, Sparkles } from 'lucide-react'
import { cn } from '../lib/utils'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentsSectionProps {
  projectPath: string
  projectId?: string
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
 * Individual agent item display
 */
function AgentItem({ agent }: { agent: CliToolDetectionResult }) {
  return (
    <li>
      <div className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded text-zinc-400">
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
        <span className="truncate flex-1">{agent.name}</span>

        {/* Version or "Not installed" */}
        <span className="text-xs text-zinc-600">
          {agent.installed ? agent.version || 'installed' : 'not found'}
        </span>
      </div>
    </li>
  )
}

export function AgentsSection({ projectPath, projectId }: AgentsSectionProps) {
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectAgents = useCallback(async () => {
    if (!window.electron?.cli) {
      setError('CLI detection not available')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.electron.cli.detectAll(projectPath, projectId)

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
    detectAgents()
  }

  return (
    <div className="mb-4 bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Agents
        </span>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          title="Refresh agent detection"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
        </button>
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
            <AgentItem key={agent.id} agent={agent} />
          ))}
        </ul>
      )}
    </div>
  )
}
