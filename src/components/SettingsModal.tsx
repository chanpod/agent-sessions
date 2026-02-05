/**
 * GlobalSettingsModal - Tabbed settings for global AI rules and SSH connections
 */

import { useEffect, useState } from 'react'
import { X, Shield, Plus, Pencil, Trash2, AlertTriangle, ChevronRight, Info, Server } from 'lucide-react'
import { cn } from '../lib/utils'
import { useGlobalRulesStore, GlobalRule } from '../stores/global-rules-store'
import { SSHConnectionsList } from './SSHConnectionsList'
import { Switch } from './ui/switch'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsTab = 'rules' | 'connections'
type RuleCategory = 'safety' | 'quality' | 'workflow'

const TABS: { id: SettingsTab; label: string; icon: typeof Shield }[] = [
  { id: 'rules', label: 'AI Rules', icon: Shield },
  { id: 'connections', label: 'Connections', icon: Server },
]

const CATEGORY_META: Record<RuleCategory, { label: string; color: string; bgColor: string }> = {
  safety: { label: 'Safety', color: 'text-rose-400/80', bgColor: 'bg-rose-400/10' },
  quality: { label: 'Quality', color: 'text-blue-400/80', bgColor: 'bg-blue-400/10' },
  workflow: { label: 'Workflow', color: 'text-amber-400/80', bgColor: 'bg-amber-400/10' },
}

const CATEGORY_OPTIONS: { value: RuleCategory; label: string }[] = [
  { value: 'safety', label: 'Safety' },
  { value: 'quality', label: 'Quality' },
  { value: 'workflow', label: 'Workflow' },
]

// =============================================================================
// Sub-components
// =============================================================================

function CategoryBadge({ category }: { category: RuleCategory }) {
  const meta = CATEGORY_META[category]
  return (
    <span className={cn('text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', meta.bgColor, meta.color)}>
      {meta.label}
    </span>
  )
}

function RuleRow({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: GlobalRule
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn(
      'rounded-lg border transition-all duration-150',
      rule.enabled
        ? 'border-white/[0.08] bg-white/[0.02]'
        : 'border-transparent bg-transparent'
    )}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="pt-0.5">
          <Switch
            size="sm"
            checked={rule.enabled}
            onCheckedChange={onToggle}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-[13px] font-medium transition-colors',
              rule.enabled ? 'text-foreground' : 'text-muted-foreground/50'
            )}>
              {rule.name}
            </span>
            {rule.isCustom && <CategoryBadge category={rule.category} />}
          </div>
          {rule.description && (
            <p className={cn(
              'text-[11px] mt-0.5 transition-colors',
              rule.enabled ? 'text-muted-foreground/60' : 'text-muted-foreground/30'
            )}>
              {rule.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className={cn(
              'p-1.5 rounded-md transition-all duration-150',
              expanded
                ? 'text-emerald-400 bg-emerald-500/10'
                : 'text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-white/[0.04]'
            )}
            title="View injected prompt"
          >
            <ChevronRight className={cn('w-3 h-3 transition-transform duration-150', expanded && 'rotate-90')} />
          </button>
          {rule.isCustom && onEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-md text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-white/[0.04] transition-colors"
              title="Edit rule"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {rule.isCustom && onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-md text-muted-foreground/30 hover:text-rose-400/80 hover:bg-rose-500/10 transition-colors"
              title="Delete rule"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pl-10">
          <pre className="text-[11px] leading-relaxed text-muted-foreground/50 font-mono whitespace-pre-wrap px-3 py-2 rounded-md bg-black/20 border border-white/[0.04]">
            {rule.ruleContent}
          </pre>
        </div>
      )}
    </div>
  )
}

function CustomRuleEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; description: string; content: string; category: RuleCategory }
  onSave: (name: string, description: string, content: string, category: RuleCategory) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [category, setCategory] = useState<RuleCategory>(initial?.category ?? 'workflow')

  const canSave = name.trim() && content.trim()

  const inputClass = 'w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder-muted-foreground/30 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 transition-all'

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Plus className="w-3.5 h-3.5 text-emerald-400/60" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/60">
          {initial ? 'Edit Rule' : 'New Custom Rule'}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Always use strict mode"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-1.5">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as RuleCategory)}
            className={cn(inputClass, 'pr-8 appearance-none cursor-pointer')}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-1.5">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of what this rule enforces"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-1.5">Prompt Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="The instruction injected into the AI system prompt..."
          rows={3}
          className={cn(inputClass, 'resize-y font-mono text-[11px] leading-relaxed')}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground/50 hover:text-muted-foreground rounded-md hover:bg-white/[0.04] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => canSave && onSave(name.trim(), description.trim(), content.trim(), category)}
          disabled={!canSave}
          className={cn(
            'px-4 py-1.5 text-[11px] font-semibold rounded-md transition-all duration-150',
            canSave
              ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 shadow-sm shadow-emerald-500/20'
              : 'bg-white/[0.04] text-muted-foreground/30 cursor-not-allowed'
          )}
        >
          {initial ? 'Update' : 'Add Rule'}
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Tab content: AI Rules
// =============================================================================

function RulesTabContent() {
  const {
    rules,
    initialized,
    loadRules,
    toggleRule,
    addCustomRule,
    updateCustomRule,
    removeCustomRule,
  } = useGlobalRulesStore()

  const [showAddEditor, setShowAddEditor] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const presetRules = rules.filter((r) => !r.isCustom)
  const customRules = rules.filter((r) => r.isCustom)

  const rulesByCategory = (category: RuleCategory) =>
    presetRules.filter((r) => r.category === category)

  const handleAddCustomRule = (
    name: string,
    description: string,
    content: string,
    category: RuleCategory
  ) => {
    addCustomRule(name, description, content, category)
    setShowAddEditor(false)
  }

  const handleUpdateCustomRule = (
    ruleId: string,
    name: string,
    description: string,
    content: string,
    category: RuleCategory
  ) => {
    updateCustomRule(ruleId, { name, description, ruleContent: content, category })
    setEditingRuleId(null)
  }

  if (!initialized) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-muted-foreground/40">
        Loading rules...
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Description */}
      <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
        Rules are injected into the system prompt of every agent session across all projects.
      </p>

      {/* Preset rules by category */}
      {(['safety', 'quality', 'workflow'] as RuleCategory[]).map((category) => {
        const categoryRules = rulesByCategory(category)
        if (categoryRules.length === 0) return null
        const meta = CATEGORY_META[category]
        return (
          <div key={category}>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">
              {meta.label}
            </label>
            <div className="space-y-1">
              {categoryRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onToggle={() => toggleRule(rule.id)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {/* Divider */}
      <div className="h-px bg-white/[0.05]" />

      {/* Custom rules */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Custom Rules
          </label>
          {!showAddEditor && (
            <button
              onClick={() => setShowAddEditor(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-emerald-400/70 hover:text-emerald-400 rounded-md hover:bg-emerald-500/10 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add Rule
            </button>
          )}
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber-500/[0.05] border border-amber-500/15 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-300/50 leading-relaxed">
            Custom rules apply to <strong className="text-amber-300/70">all agents across all projects</strong>. Keep them generic.
          </p>
        </div>

        {/* Custom rules list */}
        {customRules.length > 0 && (
          <div className="space-y-1 mb-3">
            {customRules.map((rule) =>
              editingRuleId === rule.id ? (
                <CustomRuleEditor
                  key={rule.id}
                  initial={{
                    name: rule.name,
                    description: rule.description,
                    content: rule.ruleContent,
                    category: rule.category,
                  }}
                  onSave={(name, description, content, category) =>
                    handleUpdateCustomRule(rule.id, name, description, content, category)
                  }
                  onCancel={() => setEditingRuleId(null)}
                />
              ) : (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onToggle={() => toggleRule(rule.id)}
                  onEdit={() => setEditingRuleId(rule.id)}
                  onDelete={() => removeCustomRule(rule.id)}
                />
              )
            )}
          </div>
        )}

        {customRules.length === 0 && !showAddEditor && (
          <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground/30">
            No custom rules yet
          </div>
        )}

        {showAddEditor && (
          <CustomRuleEditor
            onSave={handleAddCustomRule}
            onCancel={() => setShowAddEditor(false)}
          />
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Tab content: Connections
// =============================================================================

function ConnectionsTabContent() {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
        Manage SSH connections for remote terminals and projects.
      </p>
      <SSHConnectionsList />
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('rules')
  const enabledCount = useGlobalRulesStore((s) => s.rules.filter(r => r.enabled).length)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-xl mx-4 max-h-[85vh] flex flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/95 shadow-2xl shadow-black/50 overflow-hidden">

        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(16,185,129,0.06),transparent)]" />

        {/* ── Header ── */}
        <div className="relative px-5 pt-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground tracking-tight">Settings</h2>
                <p className="text-[11px] text-muted-foreground/60">Global configuration for all projects</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-white/[0.06]">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative flex items-center gap-2 px-4 pb-2.5 text-[12px] font-medium transition-colors',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground/50 hover:text-muted-foreground/80'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {tab.id === 'rules' && enabledCount > 0 && (
                    <span className={cn(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-white/[0.06] text-muted-foreground/40'
                    )}>
                      {enabledCount}
                    </span>
                  )}
                  {isActive && (
                    <div className="absolute inset-x-4 -bottom-px h-px bg-emerald-400/60" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          {activeTab === 'rules' && <RulesTabContent />}
          {activeTab === 'connections' && <ConnectionsTabContent />}
        </div>

        {/* ── Footer ── */}
        <div className="relative flex items-center justify-between px-5 py-3 border-t border-white/[0.05]">
          {activeTab === 'rules' ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
              <Info className="w-3 h-3" />
              <span>
                <span className="text-emerald-400/60 font-medium">{enabledCount}</span>{' '}
                {enabledCount === 1 ? 'rule' : 'rules'} active
              </span>
            </div>
          ) : (
            <div />
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground rounded-md hover:bg-white/[0.04] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
