import { useState, useEffect } from 'react'
import { X, Trash2 } from 'lucide-react'
import { useAgentContextStore } from '../stores/agent-context-store'

interface AgentContextEditorProps {
  projectId: string
  contextId?: string  // If provided, editing existing; otherwise creating new
  onClose: () => void
  onSave?: () => void  // Optional callback after save
}

const AGENT_OPTIONS = [
  { value: '', label: 'Any Agent' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'codex', label: 'Codex' },
]

export function AgentContextEditor({ projectId, contextId, onClose, onSave }: AgentContextEditorProps) {
  const { contexts, addContext, updateContext, removeContext } = useAgentContextStore()

  const existingContext = contextId ? contexts.find(c => c.id === contextId) : null
  const isEditMode = !!existingContext

  const [name, setName] = useState(existingContext?.name || '')
  const [content, setContent] = useState(existingContext?.content || '')
  const [agentId, setAgentId] = useState(existingContext?.agentId || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Update state when context changes (for edit mode)
  useEffect(() => {
    if (existingContext) {
      setName(existingContext.name)
      setContent(existingContext.content)
      setAgentId(existingContext.agentId || '')
    }
  }, [existingContext])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim() || !content.trim()) return

    if (isEditMode && contextId) {
      await updateContext(contextId, {
        name: name.trim(),
        content: content.trim(),
        agentId: agentId || undefined,
      })
    } else {
      await addContext({
        projectId,
        name: name.trim(),
        content: content.trim(),
        agentId: agentId || undefined,
      })
    }

    onSave?.()
    onClose()
  }

  const handleDelete = async () => {
    if (contextId) {
      await removeContext(contextId)
      onClose()
    }
  }

  const isValid = name.trim().length > 0 && content.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">
            {isEditMode ? 'Edit Context' : 'New Context'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Name Input */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Context Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Default Context, Code Review"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Agent Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Agent (Optional)
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {AGENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-600">
              Lock this context to a specific agent, or leave as "Any Agent" for universal use.
            </p>
          </div>

          {/* Content Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-zinc-400">
                Context Content
              </label>
              <span className="text-xs text-zinc-600">
                {content.length.toLocaleString()} characters
              </span>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter the context/prompt content to inject when this context is active..."
              rows={12}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y min-h-[200px]"
            />
          </div>
        </form>

        {/* Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
          <div>
            {isEditMode && !showDeleteConfirm && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
            {isEditMode && showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Delete this context?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                >
                  Yes, Delete
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={!isValid}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-md transition-colors"
            >
              {isEditMode ? 'Save Changes' : 'Create Context'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
