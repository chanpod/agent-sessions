import { useState } from 'react'
import { X, Folder } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'

interface NewProjectModalProps {
  onClose: () => void
}

export function NewProjectModal({ onClose }: NewProjectModalProps) {
  const { addProject } = useProjectStore()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    addProject({
      name: name.trim(),
      path: path.trim(), // Can be empty - will start in default location
    })
    onClose()
  }

  const handleBrowse = async () => {
    if (window.electron?.dialog) {
      const selectedPath = await window.electron.dialog.openDirectory()
      if (selectedPath) {
        setPath(selectedPath)
        if (!name) {
          // Extract folder name from path
          const folderName = selectedPath.split(/[/\\]/).pop() || 'project'
          setName(folderName)
        }
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">New Project</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Project Path (Optional)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/project or /home/user/remote-project"
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                <Folder className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              Default working directory for terminals. Leave empty to use SSH connections or shell defaults.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-md transition-colors"
            >
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
