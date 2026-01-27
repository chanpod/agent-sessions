/**
 * AgentLauncher - Modal for launching AI agents with optional context injection
 */

import { useState, useMemo } from 'react'
import { X, Sparkles, Gem, Code, Bot, ChevronDown, Edit3, FileText, ShieldCheck } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAgentContextStore, type AgentContext } from '../stores/agent-context-store'
import { useGlobalRulesStore } from '../stores/global-rules-store'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentLauncherProps {
  projectId: string
  projectPath: string
  installedAgents: CliToolDetectionResult[]
  preselectedAgentId?: string
  onLaunch: (agentId: string, contextId: string | null, contextContent: string | null) => void
  onClose: () => void
  onEditContext?: (contextId?: string) => void
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
 * Agent selection card
 */
function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: CliToolDetectionResult
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-all',
        'hover:bg-zinc-800/50',
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-zinc-700 bg-zinc-800/30'
      )}
    >
      {/* Agent icon */}
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          selected ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-700 text-zinc-400'
        )}
      >
        <AgentIcon id={agent.id} className="w-5 h-5" />
      </div>

      {/* Agent info */}
      <div className="flex-1 text-left">
        <div className={cn('text-sm font-medium', selected ? 'text-blue-300' : 'text-zinc-200')}>
          {agent.name}
        </div>
        <div className="text-xs text-zinc-500">
          {agent.version || 'installed'}
        </div>
      </div>

      {/* Selection indicator */}
      <div
        className={cn(
          'w-4 h-4 rounded-full border-2 flex items-center justify-center',
          selected ? 'border-blue-500 bg-blue-500' : 'border-zinc-600'
        )}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
    </button>
  )
}

/**
 * Context preview component with truncation and expand
 */
function ContextPreview({
  context,
  onEdit,
}: {
  context: AgentContext | null
  onEdit?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const maxLength = 300

  if (!context) {
    return (
      <div className="p-3 rounded-lg border border-zinc-700 bg-zinc-800/30 text-center">
        <p className="text-sm text-zinc-500">No context selected</p>
        <p className="text-xs text-zinc-600 mt-1">
          Agent will launch without context injection
        </p>
      </div>
    )
  }

  const isLong = context.content.length > maxLength
  const displayContent = expanded ? context.content : context.content.slice(0, maxLength)

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 overflow-hidden">
      {/* Preview header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50 bg-zinc-800/50">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <FileText className="w-3.5 h-3.5" />
          <span>{context.name}</span>
        </div>
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Edit context"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Preview content */}
      <div className="p-3">
        <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
          {displayContent}
          {isLong && !expanded && '...'}
        </pre>

        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

export function AgentLauncher({
  projectId,
  projectPath,
  installedAgents,
  preselectedAgentId,
  onLaunch,
  onClose,
  onEditContext,
}: AgentLauncherProps) {
  const { contexts, getActiveContext } = useAgentContextStore()
  const { getEnabledRules } = useGlobalRulesStore()
  const enabledRulesCount = getEnabledRules().length

  // Get contexts for this project (contexts are already loaded for this project)
  const projectContexts = useMemo(
    () => contexts.filter(c => c.projectId === projectId),
    [contexts, projectId]
  )
  const activeContext = useMemo(
    () => getActiveContext(),
    [getActiveContext]
  )

  // Only show installed agents
  const availableAgents = useMemo(
    () => installedAgents.filter((a) => a.installed),
    [installedAgents]
  )

  // State - use preselectedAgentId if provided, otherwise first available
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    preselectedAgentId && availableAgents.some(a => a.id === preselectedAgentId)
      ? preselectedAgentId
      : availableAgents[0]?.id ?? null
  )
  const [selectedContextId, setSelectedContextId] = useState<string | null>(
    activeContext?.id ?? null
  )
  const [contextDropdownOpen, setContextDropdownOpen] = useState(false)

  // Get selected context object
  const selectedContext = useMemo(
    () => projectContexts.find((c) => c.id === selectedContextId) ?? null,
    [projectContexts, selectedContextId]
  )

  // Get selected agent object
  const selectedAgent = useMemo(
    () => availableAgents.find((a) => a.id === selectedAgentId) ?? null,
    [availableAgents, selectedAgentId]
  )

  const handleLaunch = () => {
    if (!selectedAgentId) return
    onLaunch(
      selectedAgentId,
      selectedContextId,
      selectedContext?.content ?? null
    )
  }

  const handleContextSelect = (contextId: string | null) => {
    setSelectedContextId(contextId)
    setContextDropdownOpen(false)
  }

  const handleEditContext = () => {
    if (selectedContextId) {
      onEditContext?.(selectedContextId)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">Launch Agent</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Agent Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              Select Agent
            </label>

            {availableAgents.length === 0 ? (
              <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-800/30 text-center">
                <Bot className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">No agents installed</p>
                <p className="text-xs text-zinc-600 mt-1">
                  Install Claude, Gemini CLI, or Codex to get started
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                {availableAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    selected={selectedAgentId === agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Context Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              Context
            </label>

            {/* Dropdown */}
            <div className="relative">
              <button
                onClick={() => setContextDropdownOpen(!contextDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 hover:bg-zinc-750 transition-colors"
              >
                <span className={selectedContext ? '' : 'text-zinc-500'}>
                  {selectedContext?.name ?? 'No Context'}
                </span>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-zinc-500 transition-transform',
                    contextDropdownOpen && 'rotate-180'
                  )}
                />
              </button>

              {/* Dropdown menu */}
              {contextDropdownOpen && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg overflow-hidden">
                  {/* No context option */}
                  <button
                    onClick={() => handleContextSelect(null)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 transition-colors',
                      selectedContextId === null
                        ? 'text-blue-400 bg-blue-500/10'
                        : 'text-zinc-300'
                    )}
                  >
                    <span className="text-zinc-500">-</span>
                    <span>No Context</span>
                  </button>

                  {/* Saved contexts */}
                  {projectContexts.map((context) => (
                    <button
                      key={context.id}
                      onClick={() => handleContextSelect(context.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 transition-colors',
                        selectedContextId === context.id
                          ? 'text-blue-400 bg-blue-500/10'
                          : 'text-zinc-300'
                      )}
                    >
                      <FileText className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="truncate">{context.name}</span>
                    </button>
                  ))}

                </div>
              )}
            </div>
          </div>

          {/* Global Rules Indicator */}
          {enabledRulesCount > 0 && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400"
              title="Global rules from Settings will be applied alongside the project context"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              <span>
                <span className="text-blue-400">{enabledRulesCount}</span> global{' '}
                {enabledRulesCount === 1 ? 'rule' : 'rules'} active
              </span>
            </div>
          )}

          {/* Context Preview */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              Preview
            </label>
            <ContextPreview
              context={selectedContext}
              onEdit={selectedContext && onEditContext ? handleEditContext : undefined}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={!selectedAgentId}
            className={cn(
              'px-4 py-1.5 text-sm rounded-md transition-colors flex items-center gap-2',
              selectedAgentId
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            )}
          >
            {selectedAgent && <AgentIcon id={selectedAgent.id} className="w-4 h-4" />}
            <span>Launch {selectedAgent?.name ?? 'Agent'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
