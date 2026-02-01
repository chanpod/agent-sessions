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
  const [updateAvailable, setUpdateAvailable] = useState<Record<string, UpdateCheckResult>>({})
  const [checkingUpdate, setCheckingUpdate] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<CliToolDetectionResult | null>(null)
  const updateCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)

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

  /**
   * Check for updates for all installed agents
   */
  const checkAllUpdates = useCallback(async () => {
    console.log('[AgentFooterToolbar] checkAllUpdates() - START')
    console.log('[AgentFooterToolbar] checkAllUpdates() - Current agents state:', agents.map(a => ({ id: a.id, installed: a.installed, version: a.version })))

    if (!window.electron?.cli?.checkUpdates) {
      console.log('[AgentFooterToolbar] checkAllUpdates() - checkUpdates not available')
      return
    }

    const installedAgents = agents.filter((a) => a.installed && a.version)
    if (installedAgents.length === 0) {
      console.log('[AgentFooterToolbar] checkAllUpdates() - No installed agents with versions to check')
      return
    }

    console.log('[AgentFooterToolbar] checkAllUpdates() - Checking updates for agents:', installedAgents.map(a => ({ id: a.id, version: a.version })))

    // Clear all previous results before bulk check
    console.log('[AgentFooterToolbar] checkAllUpdates() - Clearing previous updateAvailable state')
    setUpdateAvailable({})

    try {
      const agentsToCheck = installedAgents.map((a) => ({ id: a.id, version: a.version || null }))
      console.log('[AgentFooterToolbar] checkAllUpdates() - Calling window.electron.cli.checkUpdates() with:', JSON.stringify(agentsToCheck))

      const results = await window.electron.cli.checkUpdates(agentsToCheck)

      console.log('[AgentFooterToolbar] checkAllUpdates() - Raw results from checkUpdates:', JSON.stringify(results, null, 2))

      const updatesMap: Record<string, UpdateCheckResult> = {}
      for (const result of results) {
        console.log(`[AgentFooterToolbar] checkAllUpdates() - Processing result for ${result.agentId}:`, {
          updateAvailable: result.updateAvailable,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          error: result.error
        })
        updatesMap[result.agentId] = result
      }

      console.log('[AgentFooterToolbar] checkAllUpdates() - Final updatesMap to store in state:', JSON.stringify(updatesMap, null, 2))
      setUpdateAvailable(updatesMap)
      console.log('[AgentFooterToolbar] checkAllUpdates() - State updated')
    } catch (err) {
      console.error('[AgentFooterToolbar] checkAllUpdates() - Update check failed:', err)
    }

    console.log('[AgentFooterToolbar] checkAllUpdates() - END')
  }, [agents])

  /**
   * Check for update for a single agent (on click)
   */
  const checkSingleUpdate = useCallback(async (agentId: string, currentVersion: string | null) => {
    console.log(`[AgentFooterToolbar] checkSingleUpdate() - START for ${agentId}`)
    console.log(`[AgentFooterToolbar] checkSingleUpdate() - agentId: ${agentId}, currentVersion: ${currentVersion}`)

    if (!window.electron?.cli?.checkUpdate) {
      console.log('[AgentFooterToolbar] checkSingleUpdate() - checkUpdate not available')
      return
    }

    setCheckingUpdate(agentId)
    console.log(`[AgentFooterToolbar] checkSingleUpdate() - Set checkingUpdate state to: ${agentId}`)

    // Clear old result before checking to prevent stale data
    console.log(`[AgentFooterToolbar] checkSingleUpdate() - Clearing old result for ${agentId}`)
    setUpdateAvailable((prev) => {
      const next = { ...prev }
      delete next[agentId]
      console.log(`[AgentFooterToolbar] checkSingleUpdate() - updateAvailable after clear:`, JSON.stringify(next))
      return next
    })

    try {
      console.log(`[AgentFooterToolbar] checkSingleUpdate() - Calling window.electron.cli.checkUpdate(${agentId}, ${currentVersion})`)
      const result = await window.electron.cli.checkUpdate(agentId, currentVersion)

      console.log(`[AgentFooterToolbar] checkSingleUpdate() - Raw result from checkUpdate:`, JSON.stringify(result, null, 2))

      console.log(`[AgentFooterToolbar] checkSingleUpdate() - Updating state with new result`)
      setUpdateAvailable((prev) => {
        const next = {
          ...prev,
          [agentId]: result,
        }
        console.log(`[AgentFooterToolbar] checkSingleUpdate() - updateAvailable after update:`, JSON.stringify(next))
        return next
      })

      // Log update status
      if (result.updateAvailable) {
        console.log(`[AgentFooterToolbar] checkSingleUpdate() - Update available for ${agentId}: ${result.currentVersion} -> ${result.latestVersion}`)
      } else if (result.error) {
        console.log(`[AgentFooterToolbar] checkSingleUpdate() - Update check error for ${agentId}: ${result.error}`)
      } else {
        console.log(`[AgentFooterToolbar] checkSingleUpdate() - ${agentId} is up to date (${result.currentVersion})`)
      }
    } catch (err) {
      console.error(`[AgentFooterToolbar] checkSingleUpdate() - Update check failed for ${agentId}:`, err)
    } finally {
      console.log(`[AgentFooterToolbar] checkSingleUpdate() - Clearing checkingUpdate state`)
      setCheckingUpdate(null)
    }

    console.log(`[AgentFooterToolbar] checkSingleUpdate() - END for ${agentId}`)
  }, [])

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

  // Check for updates when agents change (after detection)
  useEffect(() => {
    if (agents.length > 0) {
      checkAllUpdates()
    }
  }, [agents, checkAllUpdates])

  // Set up periodic update check (every 60 minutes)
  useEffect(() => {
    // Clear any existing interval
    if (updateCheckIntervalRef.current) {
      clearInterval(updateCheckIntervalRef.current)
    }

    // Set up new interval
    updateCheckIntervalRef.current = setInterval(() => {
      console.log('[AgentFooterToolbar] Periodic update check triggered')
      checkAllUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)

    // Cleanup on unmount
    return () => {
      if (updateCheckIntervalRef.current) {
        clearInterval(updateCheckIntervalRef.current)
        updateCheckIntervalRef.current = null
      }
    }
  }, [checkAllUpdates])

  // Get only installed agents
  const installedAgents = agents.filter((a) => a.installed)

  // Don't render if no agents detected yet
  if (loading && agents.length === 0) {
    return null
  }

  /**
   * Handle click on agent icon - open the update dialog
   */
  const handleAgentClick = (agent: CliToolDetectionResult) => {
    console.log(`[AgentFooterToolbar] Opening update dialog for ${agent.id}`)
    setSelectedAgent(agent)
    // If we have a version, trigger an update check when opening the dialog
    if (agent.version) {
      checkSingleUpdate(agent.id, agent.version)
    }
  }

  /**
   * Get tooltip text for agent
   */
  const getAgentTooltip = (agent: CliToolDetectionResult): string => {
    const update = updateAvailable[agent.id]
    const versionText = agent.version ? `v${agent.version}` : ''

    // Handle case where version is unknown
    if (!agent.version) {
      return `${agent.name} - Version unknown (cannot check for updates)`
    }

    if (update?.updateAvailable && update.latestVersion) {
      return `${agent.name} ${versionText} - Update available: v${update.latestVersion} (click to refresh)`
    }

    if (checkingUpdate === agent.id) {
      return `${agent.name} ${versionText} - Checking for updates...`
    }

    return `${agent.name} ${versionText} (click to check for updates)`
  }

  return (
    <div className="px-3 py-2 border-t border-zinc-800 flex items-center gap-1">
      {/* Installed agent icons */}
      {installedAgents.map((agent) => {
        const hasUpdate = updateAvailable[agent.id]?.updateAvailable
        const isChecking = checkingUpdate === agent.id
        const hasVersion = !!agent.version

        // Debug logging for render
        console.log(`[AgentFooterToolbar] RENDER - Agent: ${agent.id}`, {
          hasUpdate,
          isChecking,
          hasVersion,
          agentVersion: agent.version,
          updateAvailableEntry: updateAvailable[agent.id],
          willShowYellowDot: hasUpdate && !isChecking && hasVersion
        })

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

            {/* Update available indicator - yellow dot (only show if we have a version) */}
            {hasUpdate && !isChecking && hasVersion && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full"
                aria-label="Update available"
              />
            )}

            {/* Version unknown indicator - gray dot */}
            {!hasVersion && !isChecking && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-zinc-600 rounded-full"
                aria-label="Version unknown"
              />
            )}
          </button>
        )
      })}

      {/* Show placeholder if no agents installed */}
      {installedAgents.length === 0 && (
        <span className="text-xs text-zinc-600">No agents installed</span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Plus button for installing agents (or loading spinner while detecting) */}
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

      {/* Agent Update Dialog */}
      {selectedAgent && (
        <AgentUpdateDialog
          isOpen={!!selectedAgent}
          onClose={() => setSelectedAgent(null)}
          agent={selectedAgent}
          updateInfo={updateAvailable[selectedAgent.id] || null}
          isCheckingUpdate={checkingUpdate === selectedAgent.id}
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
            console.log('[AgentFooterToolbar] Update onInstallComplete called')
            // Add a small delay to allow the system to register the newly updated CLI
            await new Promise(resolve => setTimeout(resolve, 500))
            console.log('[AgentFooterToolbar] Delay complete, calling detectAgents...')
            await detectAgents()
            console.log('[AgentFooterToolbar] detectAgents complete after update')
          }}
        />
      )}
    </div>
  )
}
