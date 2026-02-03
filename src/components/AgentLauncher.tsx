/**
 * AgentLauncher - Modal for launching AI agents with optional context injection
 */

import { useState, useMemo } from 'react'
import { X, Sparkles, Gem, Code, Bot, ChevronDown, Edit3, FileText, ShieldCheck, AlertTriangle, Rocket } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAgentContextStore, type AgentContext } from '../stores/agent-context-store'
import { useGlobalRulesStore } from '../stores/global-rules-store'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Separator } from './ui/separator'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentLauncherProps {
  projectId: string
  projectPath: string
  installedAgents: CliToolDetectionResult[]
  preselectedAgentId?: string
  onLaunch: (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => void
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
        'hover:bg-muted/50',
        selected
          ? 'border-emerald-400/60 bg-emerald-400/10'
          : 'border-border/60 bg-card/40'
      )}
    >
      {/* Agent icon */}
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          selected ? 'bg-emerald-400/20 text-emerald-300' : 'bg-muted text-muted-foreground'
        )}
      >
        <AgentIcon id={agent.id} className="w-5 h-5" />
      </div>

      {/* Agent info */}
      <div className="flex-1 text-left">
        <div className={cn('text-sm font-medium', selected ? 'text-emerald-200' : 'text-foreground')}>
          {agent.name}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="border-border/60 text-muted-foreground">
            {agent.version || 'installed'}
          </Badge>
          <span>Ready</span>
        </div>
      </div>

      {/* Selection indicator */}
      <div
        className={cn(
          'w-4 h-4 rounded-full border-2 flex items-center justify-center',
          selected ? 'border-emerald-400 bg-emerald-400' : 'border-muted-foreground/50'
        )}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-zinc-900" />}
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
      <div className="p-3 rounded-lg border border-border/60 bg-card/40 text-center">
        <p className="text-sm text-muted-foreground">No context selected</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Agent will launch without context injection
        </p>
      </div>
    )
  }

  const isLong = context.content.length > maxLength
  const displayContent = expanded ? context.content : context.content.slice(0, maxLength)

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden">
      {/* Preview header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/40">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="w-3.5 h-3.5" />
          <span>{context.name}</span>
        </div>
        {onEdit && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onEdit}
            title="Edit context"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Preview content */}
      <div className="p-3">
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
          {displayContent}
          {isLong && !expanded && '...'}
        </pre>

        {isLong && (
          <Button
            variant="link"
            size="xs"
            onClick={() => setExpanded(!expanded)}
            className="mt-2 h-auto px-0 text-xs text-emerald-300 hover:text-emerald-200"
          >
            {expanded ? 'Show less' : 'Show more'}
          </Button>
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
  const [skipPermissions, setSkipPermissions] = useState(false)

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
      selectedContext?.content ?? null,
      skipPermissions
    )
  }

  // Get the skip permissions label based on selected agent
  const getSkipPermissionsLabel = () => {
    switch (selectedAgentId) {
      case 'claude':
        return 'Skip permission prompts'
      case 'gemini':
      case 'codex':
        return 'Auto-approve all (YOLO mode)'
      default:
        return 'Skip permission prompts'
    }
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
      <Card className="w-full max-w-xl mx-4 max-h-[85vh] flex flex-col border-sidebar-border/70 bg-card/90 shadow-2xl">
        <CardHeader className="relative overflow-hidden border-b border-border/60">
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(16,185,129,0.18),transparent_60%)]" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rocket className="w-4 h-4 text-emerald-300" />
                Launch Session
              </CardTitle>
              <CardDescription>Choose your agent, context, and safety posture.</CardDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-muted-foreground">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        {/* Content */}
        <CardContent className="flex-1 overflow-y-auto space-y-5">
          {/* Agent Selector */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Select Agent
            </label>

            {availableAgents.length === 0 ? (
              <div className="p-4 rounded-lg border border-border/60 bg-card/40 text-center">
                <Bot className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No agents installed</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
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
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Context
            </label>

            {/* Dropdown */}
            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setContextDropdownOpen(!contextDropdownOpen)}
                className="w-full justify-between bg-background/60"
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
              </Button>

              {/* Dropdown menu */}
              {contextDropdownOpen && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-card border border-border/60 rounded-md shadow-lg overflow-hidden">
                  {/* No context option */}
                  <button
                    onClick={() => handleContextSelect(null)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-700 transition-colors',
                      selectedContextId === null
                        ? 'text-emerald-200 bg-emerald-400/10'
                        : 'text-foreground'
                    )}
                  >
                    <span className="text-muted-foreground">-</span>
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
                          ? 'text-emerald-200 bg-emerald-400/10'
                          : 'text-foreground'
                      )}
                    >
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
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
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground"
              title="Global rules from Settings will be applied alongside the project context"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span>
                <span className="text-emerald-300">{enabledRulesCount}</span> global{' '}
                {enabledRulesCount === 1 ? 'rule' : 'rules'} active
              </span>
            </div>
          )}

          {/* Skip Permissions Checkbox */}
          {selectedAgentId && (
            <div className="px-1">
              <label
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors border',
                  skipPermissions
                    ? 'bg-amber-500/10 border-amber-500/50'
                    : 'bg-card/40 border-border/60 hover:bg-card/60'
                )}
              >
                <input
                  type="checkbox"
                  checked={skipPermissions}
                  onChange={(e) => setSkipPermissions(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={cn(
                    'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
                    skipPermissions
                      ? 'bg-amber-500 border-amber-500'
                      : 'border-muted-foreground/50'
                  )}
                >
                  {skipPermissions && (
                    <svg className="w-2.5 h-2.5 text-black" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                    </svg>
                  )}
                </div>
                <AlertTriangle className={cn(
                  'w-4 h-4',
                  skipPermissions ? 'text-amber-400' : 'text-amber-500/70'
                )} />
                <span className={cn(
                  'text-sm',
                  skipPermissions ? 'text-amber-300' : 'text-muted-foreground'
                )}>
                  {getSkipPermissionsLabel()}
                </span>
              </label>
            </div>
          )}

          {/* Context Preview */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Preview
            </label>
            <ContextPreview
              context={selectedContext}
              onEdit={selectedContext && onEditContext ? handleEditContext : undefined}
            />
          </div>
        </CardContent>

        <Separator />
        {/* Footer */}
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
          </Button>
          <Button
            onClick={handleLaunch}
            disabled={!selectedAgentId}
            className={cn(
              'gap-2',
              selectedAgentId
                ? 'bg-emerald-500 text-zinc-900 hover:bg-emerald-400'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {selectedAgent && <AgentIcon id={selectedAgent.id} className="w-4 h-4" />}
            <span>Launch {selectedAgent?.name ?? 'Agent'}</span>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
