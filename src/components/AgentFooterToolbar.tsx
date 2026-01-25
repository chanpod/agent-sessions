/**
 * AgentFooterToolbar - A compact footer toolbar showing installed AI agents
 * The + button opens the AgentInstallModal to install new agents
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, Bot, Sparkles, Gem, Code } from 'lucide-react'
import type { CliToolDetectionResult } from '../types/electron'
import { AgentInstallModal } from './AgentInstallModal'

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
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)
  const [platform, setPlatform] = useState<'windows' | 'wsl' | 'macos' | 'linux'>('linux')

  const detectAgents = useCallback(async () => {
    console.log('[AgentFooterToolbar] detectAgents called')
    if (!window.electron?.cli) {
      console.log('[AgentFooterToolbar] No electron.cli available')
      return
    }

    setLoading(true)

    try {
      console.log('[AgentFooterToolbar] Calling detectAll...')
      const result = await window.electron.cli.detectAll(projectPath, projectId)
      console.log('[AgentFooterToolbar] detectAll result:', JSON.stringify(result, null, 2))
      if (result.success || result.tools) {
        console.log('[AgentFooterToolbar] Setting agents:', result.tools.map(t => `${t.id}: ${t.installed}`))
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

  // Detect platform on mount
  useEffect(() => {
    if (window.electron?.cli?.getPlatform) {
      window.electron.cli.getPlatform().then(setPlatform)
    }
  }, [])

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

      {/* Plus button for installing agents */}
      <button
        onClick={() => setIsInstallModalOpen(true)}
        className="p-1.5 rounded transition-colors text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800"
        title="Install agents"
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Agent Installation Modal */}
      <AgentInstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        uninstalledAgents={agents.filter(a => !a.installed).map(a => ({ id: a.id, name: a.name }))}
        platform={platform}
        onInstallComplete={async () => {
          console.log('[AgentFooterToolbar] onInstallComplete called')
          // Add a small delay to allow the system to register the newly installed CLI in PATH
          await new Promise(resolve => setTimeout(resolve, 500))
          console.log('[AgentFooterToolbar] Delay complete, calling detectAgents...')
          await detectAgents()
          console.log('[AgentFooterToolbar] detectAgents complete')
        }}
        onInstall={async (agentId, method) => {
          if (!window.electron?.cli?.install) {
            return { success: false, output: 'Installation not available' }
          }
          return await window.electron.cli.install(agentId, method)
        }}
      />
    </div>
  )
}
