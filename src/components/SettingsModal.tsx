import { useEffect, useState } from 'react'
import { X, Shield, Plus, Pencil, Trash2, AlertTriangle, Info } from 'lucide-react'
import { SSHConnectionsList } from './SSHConnectionsList'
import { useGlobalRulesStore, GlobalRule } from '../stores/global-rules-store'

interface SettingsModalProps {
  onClose: () => void
}

type RuleCategory = 'safety' | 'quality' | 'workflow'

const CATEGORY_LABELS: Record<RuleCategory, string> = {
  safety: 'Safety',
  quality: 'Quality',
  workflow: 'Workflow',
}

const CATEGORY_OPTIONS: { value: RuleCategory; label: string }[] = [
  { value: 'safety', label: 'Safety' },
  { value: 'quality', label: 'Quality' },
  { value: 'workflow', label: 'Workflow' },
]

interface CustomRuleEditorProps {
  initial?: { name: string; description: string; content: string; category: RuleCategory }
  onSave: (name: string, description: string, content: string, category: RuleCategory) => void
  onCancel: () => void
}

function CustomRuleEditor({ initial, onSave, onCancel }: CustomRuleEditorProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [category, setCategory] = useState<RuleCategory>(initial?.category ?? 'workflow')

  const canSave = name.trim() && content.trim()

  return (
    <div className="border border-zinc-700 rounded-md p-3 space-y-3 bg-zinc-800/50">
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Rule Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Always use strict mode"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as RuleCategory)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of what this rule does"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Rule Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="The instruction that will be injected into the AI prompt..."
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => canSave && onSave(name.trim(), description.trim(), content.trim(), category)}
          disabled={!canSave}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}

interface ToggleSwitchProps {
  enabled: boolean
  onToggle: () => void
}

function ToggleSwitch({ enabled, onToggle }: ToggleSwitchProps) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-blue-500' : 'bg-zinc-600'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  )
}

function CategoryHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      <span className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
      <div className="flex-1 border-t border-zinc-800" />
    </div>
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
  const [showContent, setShowContent] = useState(false)

  return (
    <div>
      <div className="flex items-start gap-3 py-1.5">
        <div className="pt-0.5">
          <ToggleSwitch enabled={rule.enabled} onToggle={onToggle} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-zinc-200">{rule.name}</span>
          {rule.description && (
            <p className="text-xs text-zinc-500 mt-0.5">{rule.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowContent((prev) => !prev)}
            className={`p-1 rounded hover:bg-zinc-700 transition-colors ${
              showContent ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title="View injected prompt text"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {rule.isCustom && onEdit && (
            <button
              onClick={onEdit}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Edit rule"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {rule.isCustom && onDelete && (
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-colors"
              title="Delete rule"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {showContent && (
        <div className="ml-12 mb-2">
          <pre className="bg-zinc-900 border border-zinc-600 rounded p-2 text-xs text-zinc-300 font-mono whitespace-pre-wrap">
            {rule.ruleContent}
          </pre>
        </div>
      )}
    </div>
  )
}

export function SettingsModal({ onClose }: SettingsModalProps) {
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-6">
            {/* SSH Connections Section */}
            <div>
              <h3 className="text-sm font-medium text-zinc-300 mb-3">SSH Connections</h3>
              <p className="text-xs text-zinc-500 mb-4">
                Manage SSH connections. Once added, they'll appear in terminal shell dropdowns.
              </p>
              <SSHConnectionsList />
            </div>

            {/* Divider */}
            <div className="border-t border-zinc-800" />

            {/* Global AI Rules Section */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-medium text-zinc-300">Global AI Rules</h3>
              </div>
              <p className="text-xs text-zinc-500 mb-4">
                Rules applied to all AI agents across all projects
              </p>

              {!initialized ? (
                <p className="text-xs text-zinc-500">Loading rules...</p>
              ) : (
                <div className="space-y-4">
                  {/* Preset rules by category */}
                  {(['safety', 'quality', 'workflow'] as RuleCategory[]).map((category) => {
                    const categoryRules = rulesByCategory(category)
                    if (categoryRules.length === 0) return null
                    return (
                      <div key={category}>
                        <CategoryHeader label={CATEGORY_LABELS[category]} />
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

                  {/* Separator */}
                  <div className="border-t border-zinc-800" />

                  {/* Custom Rules Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
                        Custom Rules
                      </h4>
                      {!showAddEditor && (
                        <button
                          onClick={() => setShowAddEditor(true)}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          Add Custom Rule
                        </button>
                      )}
                    </div>

                    {/* Warning Banner */}
                    <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-md px-3 py-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-200">
                        Custom rules should be hyper-generic. Avoid context-specific instructions as
                        they apply to all agents across all projects.
                      </p>
                    </div>

                    {/* Custom Rules List */}
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
                      <p className="text-xs text-zinc-600 italic">No custom rules yet.</p>
                    )}

                    {/* Add Custom Rule Editor */}
                    {showAddEditor && (
                      <CustomRuleEditor
                        onSave={handleAddCustomRule}
                        onCancel={() => setShowAddEditor(false)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
