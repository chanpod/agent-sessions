/**
 * AgentFooterToolbar - A compact footer toolbar showing installed AI agents
 * The + button is for installing new agents (future feature)
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, Bot, Sparkles, Gem, Code } from 'lucide-react'
import { cn } from '../lib/utils'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentFooterToolbarProps {
  projectId: string
  projectPath: string
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

export function AgentFooterToolbar({
  projectId,
  projectPath,
}: AgentFooterToolbarProps) {
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const [loading, setLoading] = useState(false)

  const detectAgents = useCallback(async () => {
    if (!window.electron?.cli) return

    setLoading(true)

    try {
      const result = await window.electron.cli.detectAll(projectPath, projectId)
      if (result.success || result.tools) {
        setAgents(result.tools)
      }
    } catch (err) {
      console.error('Agent detection failed:', err)
    } finally {
      setLoading(false)
    }
  }, [projectPath, projectId])

  // Detect agents on mount and when projectPath/projectId changes
  useEffect(() => {
    detectAgents()
  }, [detectAgents])

  // Get only installed agents
  const installedAgents = agents.filter((a) => a.installed)

  // Don't render if no agents detected yet
  if (loading && agents.length === 0) {
    return null
  }

  return (
    <div className="px-3 py-2 border-t border-zinc-800 flex items-center gap-1">
      {/* Installed agent icons */}
      {installedAgents.map((agent) => (
        <div
          key={agent.id}
          className="p-1.5 text-zinc-500"
          title={`${agent.name} ${agent.version || ''}`}
        >
          <AgentIcon id={agent.id} className="w-4 h-4" />
        </div>
      ))}

      {/* Show placeholder if no agents installed */}
      {installedAgents.length === 0 && (
        <span className="text-xs text-zinc-600">No agents installed</span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Plus button for installing agents (future feature) */}
      <button
        onClick={() => {
          // TODO: Open agent installation modal
          console.log('Install agents - future feature')
        }}
        className="p-1.5 rounded transition-colors text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800"
        title="Install agents (coming soon)"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}
