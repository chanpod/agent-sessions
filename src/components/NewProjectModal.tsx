import { useState } from 'react'
import { X, Folder } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { useSSHStore } from '../stores/ssh-store'

interface NewProjectModalProps {
  onClose: () => void
}

export function NewProjectModal({ onClose }: NewProjectModalProps) {
  const { addProject } = useProjectStore()
  const { connections } = useSSHStore()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [isSSHProject, setIsSSHProject] = useState(false)
  const [sshConnectionId, setSshConnectionId] = useState('')
  const [remotePath, setRemotePath] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    // Validate SSH project requirements
    if (isSSHProject && !sshConnectionId) {
      alert('Please select an SSH connection')
      return
    }

    addProject({
      name: name.trim(),
      path: isSSHProject ? '' : path.trim(),
      isSSHProject,
      sshConnectionId: isSSHProject ? sshConnectionId : undefined,
      remotePath: isSSHProject ? remotePath.trim() : undefined,
    })
    onClose()
  }

  const handleBrowse = async () => {
    if (!window.electron?.dialog) return

    if (isSSHProject) {
      // SSH browsing not yet implemented - input is for manual entry
      return
    }

    // Local browsing
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

          {/* SSH Project Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ssh-project"
              checked={isSSHProject}
              onChange={(e) => setIsSSHProject(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor="ssh-project" className="text-sm text-zinc-300 cursor-pointer">
              SSH Project
            </label>
          </div>

          {isSSHProject ? (
            <>
              {/* SSH Connection Selector */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  SSH Connection
                </label>
                <select
                  value={sshConnectionId}
                  onChange={(e) => setSshConnectionId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select SSH connection...</option>
                  {connections.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name} ({conn.username}@{conn.host})
                    </option>
                  ))}
                </select>
                {connections.length === 0 && (
                  <p className="mt-1 text-xs text-amber-500">
                    No SSH connections configured. Go to Settings to add one.
                  </p>
                )}
              </div>

              {/* Remote Path */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Remote Path (Optional)
                </label>
                <input
                  type="text"
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  placeholder="/home/user/my-project"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-zinc-600">
                  Type the remote directory path. Leave empty to use home directory.
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Local Path */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Project Path (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/path/to/project"
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
                  Default working directory for terminals. Leave empty to use shell defaults.
                </p>
              </div>
            </>
          )}

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
