/**
 * AgentLauncher - Modal for launching AI agents with optional context injection
 */

import { useState, useMemo } from 'react'
import { X, Sparkles, Gem, Code, Bot, ChevronDown, Edit3, FileText, ShieldCheck, AlertTriangle, Zap } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAgentContextStore, type AgentContext } from '../stores/agent-context-store'
import { useGlobalRulesStore } from '../stores/global-rules-store'
import { usePermissionStore } from '@/stores/permission-store'
import { Button } from './ui/button'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentLauncherProps {
  projectId: string
  projectPath: string
  installedAgents: CliToolDetectionResult[]
  preselectedAgentId?: string
  onLaunch: (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean, model?: string | null) => void
  onClose: () => void
  onEditContext?: (contextId?: string) => void
}

// =============================================================================
// Agent icon mapping
// =============================================================================

const AGENT_META: Record<string, { icon: typeof Sparkles; gradient: string; glow: string }> = {
  claude: {
    icon: Sparkles,
    gradient: 'from-amber-500/80 to-orange-600/80',
    glow: 'shadow-amber-500/25',
  },
  gemini: {
    icon: Gem,
    gradient: 'from-blue-500/80 to-indigo-600/80',
    glow: 'shadow-blue-500/25',
  },
  codex: {
    icon: Code,
    gradient: 'from-emerald-500/80 to-teal-600/80',
    glow: 'shadow-emerald-500/25',
  },
}

const DEFAULT_META = {
  icon: Bot,
  gradient: 'from-zinc-500/80 to-zinc-600/80',
  glow: 'shadow-zinc-500/25',
}

function getAgentMeta(id: string) {
  return AGENT_META[id] ?? DEFAULT_META
}

// =============================================================================
// Model definitions
// =============================================================================

const MODELS = [
  { id: null, label: 'Default', desc: 'CLI default' },
  { id: 'opus', label: 'Opus', desc: 'Most capable' },
  { id: 'sonnet', label: 'Sonnet', desc: 'Balanced' },
  { id: 'haiku', label: 'Haiku', desc: 'Fastest' },
] as const

// =============================================================================
// Sub-components
// =============================================================================

function AgentTile({
  agent,
  selected,
  onClick,
}: {
  agent: CliToolDetectionResult
  selected: boolean
  onClick: () => void
}) {
  const meta = getAgentMeta(agent.id)
  const Icon = meta.icon

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all duration-200',
        'border min-w-[88px] flex-1',
        selected
          ? `border-white/15 bg-white/[0.06] shadow-lg ${meta.glow}`
          : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
      )}
    >
      {/* Icon orb */}
      <div
        className={cn(
          'relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200',
          selected
            ? `bg-gradient-to-br ${meta.gradient} shadow-md ${meta.glow}`
            : 'bg-white/[0.06] group-hover:bg-white/[0.09]'
        )}
      >
        <Icon className={cn(
          'w-5 h-5 transition-colors duration-200',
          selected ? 'text-white' : 'text-muted-foreground group-hover:text-foreground/80'
        )} />
        {/* Selection ring */}
        {selected && (
          <div className="absolute -inset-px rounded-xl ring-1 ring-white/20" />
        )}
      </div>

      {/* Label */}
      <div className="text-center">
        <div className={cn(
          'text-[11px] font-semibold tracking-wide uppercase transition-colors',
          selected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground/70'
        )}>
          {agent.name}
        </div>
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
          {agent.version || 'ready'}
        </div>
      </div>

      {/* Active dot */}
      {selected && (
        <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
      )}
    </button>
  )
}

function ModelSelector({
  selected,
  onChange,
}: {
  selected: 'opus' | 'sonnet' | 'haiku' | null
  onChange: (model: 'opus' | 'sonnet' | 'haiku' | null) => void
}) {
  return (
    <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
      {MODELS.map((m) => (
        <button
          key={m.id ?? 'default'}
          onClick={() => onChange(m.id)}
          className={cn(
            'flex-1 relative px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150',
            selected === m.id
              ? 'bg-white/[0.10] text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground/70 hover:bg-white/[0.04]'
          )}
        >
          <span className="relative z-10">{m.label}</span>
          {selected === m.id && (
            <div className="absolute inset-x-2 -bottom-px h-px bg-emerald-400/60" />
          )}
        </button>
      ))}
    </div>
  )
}

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
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground/50">
        No context &mdash; agent launches clean
      </div>
    )
  }

  const isLong = context.content.length > maxLength
  const displayContent = expanded ? context.content : context.content.slice(0, maxLength)

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileText className="w-3 h-3" />
          <span className="truncate">{context.name}</span>
        </div>
        {onEdit && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onEdit}
            title="Edit context"
            className="h-5 w-5 text-muted-foreground/60 hover:text-muted-foreground"
          >
            <Edit3 className="w-3 h-3" />
          </Button>
        )}
      </div>
      <div className="px-3 py-2">
        <pre className="text-[11px] leading-relaxed text-muted-foreground/70 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto scrollbar-thin">
          {displayContent}
          {isLong && !expanded && '...'}
        </pre>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-[10px] text-emerald-400/70 hover:text-emerald-400 transition-colors"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

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

  const projectContexts = useMemo(
    () => contexts.filter(c => c.projectId === projectId),
    [contexts, projectId]
  )
  const activeContext = useMemo(
    () => getActiveContext(),
    [getActiveContext]
  )

  const availableAgents = useMemo(
    () => installedAgents.filter((a) => a.installed),
    [installedAgents]
  )

  // State
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
  const [selectedModel, setSelectedModel] = useState<'opus' | 'sonnet' | 'haiku' | null>(null)
  const hookInstalled = usePermissionStore((s) => s.isHookInstalled(projectPath ?? ''))

  const selectedContext = useMemo(
    () => projectContexts.find((c) => c.id === selectedContextId) ?? null,
    [projectContexts, selectedContextId]
  )

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
      skipPermissions,
      selectedModel
    )
  }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 max-h-[85vh] flex flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/95 shadow-2xl shadow-black/50 overflow-hidden">

        {/* Ambient glow (top) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(16,185,129,0.08),transparent)]" />

        {/* ── Header ── */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground tracking-tight">New Session</h2>
              <p className="text-[11px] text-muted-foreground/60">Configure and launch</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4 scrollbar-thin">

          {/* Agent selection */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">
              Agent
            </label>
            {availableAgents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Bot className="w-7 h-7 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground/50">No agents installed</p>
              </div>
            ) : (
              <div className="flex gap-1.5">
                {availableAgents.map((agent) => (
                  <AgentTile
                    key={agent.id}
                    agent={agent}
                    selected={selectedAgentId === agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Model selector (Claude only) */}
          {selectedAgentId === 'claude' && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">
                Model
              </label>
              <ModelSelector
                selected={selectedModel}
                onChange={setSelectedModel}
              />
            </div>
          )}

          {/* Divider */}
          <div className="h-px bg-white/[0.05]" />

          {/* Context selector */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">
              Context
            </label>
            <div className="relative">
              <button
                onClick={() => setContextDropdownOpen(!contextDropdownOpen)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg',
                  'border border-white/[0.08] bg-white/[0.02]',
                  'text-sm transition-colors hover:bg-white/[0.04]',
                  contextDropdownOpen && 'bg-white/[0.04] border-white/[0.12]'
                )}
              >
                <span className={selectedContext ? 'text-foreground text-xs' : 'text-muted-foreground/50 text-xs'}>
                  {selectedContext?.name ?? 'None'}
                </span>
                <ChevronDown
                  className={cn(
                    'w-3.5 h-3.5 text-muted-foreground/40 transition-transform duration-200',
                    contextDropdownOpen && 'rotate-180'
                  )}
                />
              </button>

              {contextDropdownOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] bg-zinc-900/98 shadow-xl shadow-black/40 overflow-hidden backdrop-blur-xl">
                  <button
                    onClick={() => handleContextSelect(null)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                      selectedContextId === null
                        ? 'text-emerald-300 bg-emerald-500/10'
                        : 'text-muted-foreground hover:bg-white/[0.04]'
                    )}
                  >
                    <span className="text-muted-foreground/40">&mdash;</span>
                    <span>None</span>
                  </button>
                  {projectContexts.map((context) => (
                    <button
                      key={context.id}
                      onClick={() => handleContextSelect(context.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                        selectedContextId === context.id
                          ? 'text-emerald-300 bg-emerald-500/10'
                          : 'text-foreground/80 hover:bg-white/[0.04]'
                      )}
                    >
                      <FileText className="w-3 h-3 text-muted-foreground/40" />
                      <span className="truncate">{context.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Context preview */}
          {selectedContext && (
            <ContextPreview
              context={selectedContext}
              onEdit={onEditContext ? handleEditContext : undefined}
            />
          )}

          {/* Safety & rules row */}
          <div className="space-y-1.5">
            {/* Permission hook / skip toggle */}
            {selectedAgentId && (
              <>
                {hookInstalled && selectedAgentId === 'claude' ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80" />
                    <span className="text-[11px] text-emerald-300/80">Permission hooks active</span>
                  </div>
                ) : (
                  <label
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all',
                      'border',
                      skipPermissions
                        ? 'bg-amber-500/[0.06] border-amber-500/25'
                        : 'bg-transparent border-white/[0.06] hover:border-white/[0.10]'
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
                        'w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors',
                        skipPermissions
                          ? 'bg-amber-500 border-amber-500'
                          : 'border-muted-foreground/30'
                      )}
                    >
                      {skipPermissions && (
                        <svg className="w-2.5 h-2.5 text-black" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                        </svg>
                      )}
                    </div>
                    <AlertTriangle className={cn(
                      'w-3.5 h-3.5',
                      skipPermissions ? 'text-amber-400/80' : 'text-muted-foreground/30'
                    )} />
                    <span className={cn(
                      'text-[11px]',
                      skipPermissions ? 'text-amber-300/80' : 'text-muted-foreground/50'
                    )}>
                      {getSkipPermissionsLabel()}
                    </span>
                  </label>
                )}
              </>
            )}

            {/* Global rules indicator */}
            {enabledRulesCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground/50"
                title="Global rules from Settings will be applied alongside the project context"
              >
                <ShieldCheck className="w-3 h-3 text-emerald-400/50" />
                <span>
                  <span className="text-emerald-400/70">{enabledRulesCount}</span> global{' '}
                  {enabledRulesCount === 1 ? 'rule' : 'rules'} active
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="relative flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.05]">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground/60 hover:text-muted-foreground text-xs"
          >
            Cancel
          </Button>
          <button
            onClick={handleLaunch}
            disabled={!selectedAgentId}
            className={cn(
              'group relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200',
              selectedAgentId
                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20 hover:shadow-emerald-400/30'
                : 'bg-white/[0.06] text-muted-foreground/40 cursor-not-allowed'
            )}
          >
            {selectedAgent && (
              <span className={cn(
                'flex items-center justify-center w-4 h-4',
                selectedAgentId ? 'text-zinc-950/70' : ''
              )}>
                {(() => { const Icon = getAgentMeta(selectedAgent.id).icon; return <Icon className="w-3.5 h-3.5" /> })()}
              </span>
            )}
            <span>Launch</span>
          </button>
        </div>
      </div>
    </div>
  )
}
