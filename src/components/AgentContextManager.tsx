import { useState, useEffect, useCallback } from 'react'
import { FileText, Edit2, Trash2, Star, Plus, X, ArrowLeft } from 'lucide-react'
import { useAgentContextStore } from '../stores/agent-context-store'

interface AgentContextManagerProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName: string
}

const AGENT_OPTIONS = [
  { value: '', label: 'Any Agent' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'codex', label: 'Codex' },
]

type Mode = 'list' | 'edit'

function AgentContextManager({ isOpen, onClose, projectId, projectName }: AgentContextManagerProps) {
  const { contexts, loadContexts, addContext, updateContext, removeContext } = useAgentContextStore()

  const [mode, setMode] = useState<Mode>('list')
  const [editingContextId, setEditingContextId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [agentId, setAgentId] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // TODO: defaultContextId should be persisted in the store (e.g., add a defaultContextId field per project).
  // For now, this is tracked in local component state and will reset on remount.
  const [defaultContextId, setDefaultContextId] = useState<string | null>(null)

  const projectContexts = contexts.filter((c) => c.projectId === projectId)
  const isValid = name.trim().length > 0 && content.trim().length > 0

  useEffect(() => {
    if (isOpen && projectId) {
      loadContexts(projectId)
    }
  }, [isOpen, projectId, loadContexts])

  useEffect(() => {
    if (isOpen) {
      setMode('list')
      setEditingContextId(null)
      resetForm()
    }
  }, [isOpen])

  const resetForm = useCallback(() => {
    setName('')
    setContent('')
    setAgentId('')
    setShowDeleteConfirm(false)
  }, [])

  const handleNewContext = useCallback(() => {
    setEditingContextId(null)
    resetForm()
    setMode('edit')
  }, [resetForm])

  const handleEditContext = useCallback(
    (contextId: string) => {
      const ctx = contexts.find((c) => c.id === contextId)
      if (!ctx) return
      setEditingContextId(contextId)
      setName(ctx.name)
      setContent(ctx.content)
      setAgentId(ctx.agentId ?? '')
      setShowDeleteConfirm(false)
      setMode('edit')
    },
    [contexts]
  )

  const handleBackToList = useCallback(() => {
    setMode('list')
    setEditingContextId(null)
    resetForm()
  }, [resetForm])

  const handleSave = useCallback(async () => {
    if (!isValid) return
    const trimmedName = name.trim()
    const trimmedContent = content.trim()
    const contextAgentId = agentId || undefined

    if (editingContextId) {
      await updateContext(editingContextId, {
        name: trimmedName,
        content: trimmedContent,
        agentId: contextAgentId,
      })
    } else {
      await addContext({
        projectId,
        name: trimmedName,
        content: trimmedContent,
        agentId: contextAgentId,
      })
    }
    handleBackToList()
  }, [isValid, name, content, agentId, editingContextId, projectId, updateContext, addContext, handleBackToList])

  const handleDelete = useCallback(async () => {
    if (!editingContextId) return
    if (defaultContextId === editingContextId) {
      setDefaultContextId(null)
    }
    await removeContext(editingContextId)
    handleBackToList()
  }, [editingContextId, defaultContextId, removeContext, handleBackToList])

  const handleSetDefault = useCallback(
    (contextId: string) => {
      setDefaultContextId(defaultContextId === contextId ? null : contextId)
    },
    [defaultContextId]
  )

  const getAgentLabel = (agentIdValue?: string) => {
    if (!agentIdValue) return null
    const option = AGENT_OPTIONS.find((o) => o.value === agentIdValue)
    return option?.label ?? agentIdValue
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            {mode === 'edit' && (
              <button
                onClick={handleBackToList}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="text-sm font-semibold text-zinc-200">
                {mode === 'list'
                  ? 'Agent Contexts'
                  : editingContextId
                    ? 'Edit Context'
                    : 'New Context'}
              </h2>
              {mode === 'list' && (
                <p className="text-xs text-zinc-500">Manage contexts for {projectName}</p>
              )}
            </div>
            {mode === 'list' && projectContexts.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded">
                {projectContexts.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'list' ? (
            <ListMode
              contexts={projectContexts}
              defaultContextId={defaultContextId}
              onEdit={handleEditContext}
              onSetDefault={handleSetDefault}
              onNew={handleNewContext}
              getAgentLabel={getAgentLabel}
            />
          ) : (
            <EditMode
              name={name}
              content={content}
              agentId={agentId}
              isEditing={!!editingContextId}
              showDeleteConfirm={showDeleteConfirm}
              onNameChange={setName}
              onContentChange={setContent}
              onAgentIdChange={setAgentId}
              onShowDeleteConfirm={setShowDeleteConfirm}
              onDelete={handleDelete}
            />
          )}
        </div>

        {/* Footer */}
        {mode === 'edit' && (
          <div className="flex justify-between items-center px-4 py-3 border-t border-zinc-800">
            <div>
              {editingContextId && !showDeleteConfirm && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleBackToList}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!isValid}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-md"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {mode === 'list' && (
          <div className="flex justify-end px-4 py-3 border-t border-zinc-800">
            <button
              onClick={handleNewContext}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md"
            >
              <Plus className="w-3.5 h-3.5" />
              New Context
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* List Mode                                                          */
/* ------------------------------------------------------------------ */

interface ListModeProps {
  contexts: Array<{
    id: string
    name: string
    content: string
    agentId?: string
  }>
  defaultContextId: string | null
  onEdit: (id: string) => void
  onSetDefault: (id: string) => void
  onNew: () => void
  getAgentLabel: (agentId?: string) => string | null
}

function ListMode({ contexts, defaultContextId, onEdit, onSetDefault, getAgentLabel }: ListModeProps) {
  if (contexts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FileText className="w-8 h-8 text-zinc-600 mb-3" />
        <p className="text-sm text-zinc-400 mb-1">No contexts yet</p>
        <p className="text-xs text-zinc-600">
          Create a context to provide instructions for your agents.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {contexts.map((ctx) => {
        const agentLabel = getAgentLabel(ctx.agentId)
        const isDefault = defaultContextId === ctx.id
        const preview = ctx.content.length > 50 ? ctx.content.slice(0, 50) + '...' : ctx.content

        return (
          <div
            key={ctx.id}
            className="flex items-start gap-3 p-3 bg-zinc-800/50 border border-zinc-800 rounded-md hover:border-zinc-700 group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-200 truncate">{ctx.name}</span>
                {agentLabel && (
                  <span className="px-1.5 py-0.5 text-xs bg-zinc-700 text-zinc-400 rounded">
                    {agentLabel}
                  </span>
                )}
                {isDefault && (
                  <span className="px-1.5 py-0.5 text-xs bg-yellow-600/20 text-yellow-500 rounded">
                    Default
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-1 truncate">{preview}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onSetDefault(ctx.id)}
                className={`p-1.5 rounded hover:bg-zinc-700 ${
                  isDefault ? 'text-yellow-500' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title={isDefault ? 'Remove as default' : 'Set as default'}
              >
                <Star className={`w-3.5 h-3.5 ${isDefault ? 'fill-current' : ''}`} />
              </button>
              <button
                onClick={() => onEdit(ctx.id)}
                className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                title="Edit"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Edit Mode                                                          */
/* ------------------------------------------------------------------ */

interface EditModeProps {
  name: string
  content: string
  agentId: string
  isEditing: boolean
  showDeleteConfirm: boolean
  onNameChange: (v: string) => void
  onContentChange: (v: string) => void
  onAgentIdChange: (v: string) => void
  onShowDeleteConfirm: (v: boolean) => void
  onDelete: () => void
}

function EditMode({
  name,
  content,
  agentId,
  isEditing,
  showDeleteConfirm,
  onNameChange,
  onContentChange,
  onAgentIdChange,
  onShowDeleteConfirm,
  onDelete,
}: EditModeProps) {
  return (
    <div className="space-y-4">
      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="flex items-center justify-between p-3 bg-red-500/10 border border-red-500/20 rounded-md">
          <span className="text-xs text-red-400">Delete this context? This cannot be undone.</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onShowDeleteConfirm(false)}
              className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., Code Review Guidelines"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Agent selector */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Agent</label>
        <select
          value={agentId}
          onChange={(e) => onAgentIdChange(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {AGENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-600 mt-1">
          Restrict this context to a specific agent, or use with any agent.
        </p>
      </div>

      {/* Content */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Content</label>
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="Provide instructions, rules, or context for the agent..."
          rows={10}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
        />
      </div>

      {isEditing && !showDeleteConfirm && (
        <p className="text-xs text-zinc-600">
          Editing an existing context. Changes are saved when you click Save.
        </p>
      )}
    </div>
  )
}

export default AgentContextManager
