/**
 * AgentFooterToolbar - A compact footer toolbar showing installed AI agents
 * The + button opens the AgentInstallModal to install new agents
 * Includes update checking functionality with visual indicators
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Bot, Sparkles, Gem, Code, Loader2 } from 'lucide-react'
import type { CliToolDetectionResult, UpdateCheckResult } from '../types/electron'
import { AgentInstallModal } from './AgentInstallModal'
import { AgentUpdateDialog } from './AgentUpdateDialog'

/** Update check interval: 60 minutes */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

interface AgentFooterToolbarProps {
  projectId: string
  projectPath: string
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

export function AgentFooterToolbar({
  projectId,
  projectPath,
}: AgentFooterToolbarProps) {
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const [loading, setLoading] = useState(false)
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)
  const [platform, setPlatform] = useState<'windows' | 'macos' | 'linux'>('linux')
  const [updateAvailable, setUpdateAvailable] = useState<Record<string, UpdateCheckResult>>({})
  const [checkingUpdate, setCheckingUpdate] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<CliToolDetectionResult | null>(null)
  const updateCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const detectAgents = useCallback(async () => {
    if (!window.electron?.cli) return

    setLoading(true)
    try {
      const result = await window.electron.cli.detectAll(projectPath, projectId)
      if (result.success || result.tools) {
        setAgents(result.tools)
      }
    } catch (err) {
      console.error('[AgentFooterToolbar] Agent detection failed:', err)
    } finally {
      setLoading(false)
    }
  }, [projectPath, projectId])

  const checkAllUpdates = useCallback(async () => {
    if (!window.electron?.cli?.checkUpdates) return

    const installedAgents = agents.filter((a) => a.installed && a.version)
    if (installedAgents.length === 0) return

    setUpdateAvailable({})

    try {
      const agentsToCheck = installedAgents.map((a) => ({ id: a.id, version: a.version || null }))
      const results = await window.electron.cli.checkUpdates(agentsToCheck)

      const updatesMap: Record<string, UpdateCheckResult> = {}
      for (const result of results) {
        updatesMap[result.agentId] = result
      }
      setUpdateAvailable(updatesMap)
    } catch (err) {
      console.error('[AgentFooterToolbar] Update check failed:', err)
    }
  }, [agents])

  const checkSingleUpdate = useCallback(async (agentId: string, currentVersion: string | null) => {
    if (!window.electron?.cli?.checkUpdate) return

    setCheckingUpdate(agentId)
    setUpdateAvailable((prev) => {
      const next = { ...prev }
      delete next[agentId]
      return next
    })

    try {
      const result = await window.electron.cli.checkUpdate(agentId, currentVersion)
      setUpdateAvailable((prev) => ({ ...prev, [agentId]: result }))
    } catch (err) {
      console.error(`[AgentFooterToolbar] Update check failed for ${agentId}:`, err)
    } finally {
      setCheckingUpdate(null)
    }
  }, [])

  // Detect agents on mount
  useEffect(() => {
    detectAgents()
  }, [detectAgents])

  // Detect platform on mount
  useEffect(() => {
    if (window.electron?.cli?.getPlatform) {
      window.electron.cli.getPlatform().then(setPlatform)
    }
  }, [])

  // Check for updates when agents change
  useEffect(() => {
    if (agents.length > 0) {
      checkAllUpdates()
    }
  }, [agents, checkAllUpdates])

  // Periodic update check
  useEffect(() => {
    if (updateCheckIntervalRef.current) {
      clearInterval(updateCheckIntervalRef.current)
    }

    updateCheckIntervalRef.current = setInterval(() => {
      checkAllUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)

    return () => {
      if (updateCheckIntervalRef.current) {
        clearInterval(updateCheckIntervalRef.current)
        updateCheckIntervalRef.current = null
      }
    }
  }, [checkAllUpdates])

  const installedAgents = agents.filter((a) => a.installed)

  if (loading && agents.length === 0) {
    return null
  }

  const handleAgentClick = (agent: CliToolDetectionResult) => {
    setSelectedAgent(agent)
    if (agent.version) {
      checkSingleUpdate(agent.id, agent.version)
    }
  }

  const getAgentTooltip = (agent: CliToolDetectionResult): string => {
    const update = updateAvailable[agent.id]
    const versionText = agent.version ? `v${agent.version}` : ''
    const methodText = agent.installMethod && agent.installMethod !== 'unknown' ? ` (${agent.installMethod})` : ''

    if (!agent.version) {
      return `${agent.name} - Version unknown`
    }

    if (update?.updateAvailable && update.latestVersion) {
      return `${agent.name} ${versionText}${methodText} - Update available: v${update.latestVersion}`
    }

    if (checkingUpdate === agent.id) {
      return `${agent.name} ${versionText} - Checking for updates...`
    }

    return `${agent.name} ${versionText}${methodText}`
  }

  return (
    <div className="px-3 py-2 border-t border-zinc-800 flex items-center gap-1">
      {installedAgents.map((agent) => {
        const hasUpdate = updateAvailable[agent.id]?.updateAvailable
        const isChecking = checkingUpdate === agent.id
        const hasVersion = !!agent.version

        return (
          <button
            key={agent.id}
            onClick={() => handleAgentClick(agent)}
            disabled={isChecking}
            className={`relative p-1.5 rounded transition-colors ${
              hasVersion
                ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800'
            } disabled:opacity-50`}
            title={getAgentTooltip(agent)}
          >
            {isChecking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <AgentIcon id={agent.id} className="w-4 h-4" />
            )}

            {/* Update available indicator */}
            {hasUpdate && !isChecking && hasVersion && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full"
                aria-label="Update available"
              />
            )}

            {/* Version unknown indicator */}
            {!hasVersion && !isChecking && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-zinc-600 rounded-full"
                aria-label="Version unknown"
              />
            )}
          </button>
        )
      })}

      {installedAgents.length === 0 && (
        <span className="text-xs text-zinc-600">No agents installed</span>
      )}

      <div className="flex-1" />

      {loading ? (
        <div className="p-1.5">
          <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
        </div>
      ) : (
        <button
          onClick={() => setIsInstallModalOpen(true)}
          className="p-1.5 rounded transition-colors text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800"
          title="Install agents"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      <AgentInstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        uninstalledAgents={agents.filter(a => !a.installed).map(a => ({ id: a.id, name: a.name }))}
        platform={platform}
        onInstallComplete={async () => {
          await new Promise(resolve => setTimeout(resolve, 500))
          await detectAgents()
        }}
        onInstall={async (agentId, method) => {
          if (!window.electron?.cli?.install) {
            return { success: false, output: 'Installation not available' }
          }
          return await window.electron.cli.install(agentId, method)
        }}
      />

      {selectedAgent && (
        <AgentUpdateDialog
          isOpen={!!selectedAgent}
          onClose={() => setSelectedAgent(null)}
          agent={selectedAgent}
          updateInfo={updateAvailable[selectedAgent.id] || null}
          isCheckingUpdate={checkingUpdate === selectedAgent.id}
          platform={platform}
          onRefresh={async () => {
            if (selectedAgent.version) {
              await checkSingleUpdate(selectedAgent.id, selectedAgent.version)
            }
          }}
          onInstall={async (method) => {
            if (!window.electron?.cli?.install) {
              return { success: false, output: 'Installation not available' }
            }
            return await window.electron.cli.install(selectedAgent.id, method)
          }}
          onInstallComplete={async () => {
            await new Promise(resolve => setTimeout(resolve, 500))
            await detectAgents()
          }}
        />
      )}
    </div>
  )
}
