import { useState, useEffect, useCallback, useRef } from 'react'
import { Settings, FolderPlus } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { ProjectItem } from './ProjectItem'
import { NewProjectModal } from './NewProjectModal'

interface ShellInfo {
  name: string
  path: string
}

interface SidebarProps {
  onCreateTerminal: (projectId: string, shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onRestartServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

const MIN_WIDTH = 180
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 256

export function Sidebar({ onCreateTerminal, onCloseTerminal, onStartServer, onStopServer, onRestartServer, onDeleteServer }: SidebarProps) {
  const { projects } = useProjectStore()
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width')
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing && sidebarRef.current) {
      const newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
        localStorage.setItem('sidebar-width', String(newWidth))
      }
    }
  }, [isResizing])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize)
      window.addEventListener('mouseup', stopResizing)
    }
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing, resize, stopResizing])

  useEffect(() => {
    async function loadShells() {
      if (!window.electron) return
      try {
        const availableShells = await window.electron.system.getShells()
        setShells(availableShells)
      } catch (err) {
        console.error('Failed to load shells:', err)
      }
    }
    loadShells()
  }, [])

  return (
    <>
      <aside
        ref={sidebarRef}
        style={{ width }}
        className={`flex-shrink-0 bg-zinc-900/50 border-r border-zinc-800 flex flex-col relative z-20 ${isResizing ? 'select-none' : ''}`}
      >
        {/* Header - draggable region for window */}
        <div className="h-12 flex items-center px-4 border-b border-zinc-800 app-drag-region">
          <h1 className="text-sm font-semibold text-zinc-300">Agent Sessions</h1>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-2 mb-2">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Projects
            </h2>
            <button
              onClick={() => setShowNewProject(true)}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="New Project"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <p className="text-xs text-zinc-600 mb-2">No projects yet</p>
              <button
                onClick={() => setShowNewProject(true)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Create your first project
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {projects.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  shells={shells}
                  onCreateTerminal={onCreateTerminal}
                  onCloseTerminal={onCloseTerminal}
                  onStartServer={onStartServer}
                  onStopServer={onStopServer}
                  onRestartServer={onRestartServer}
                  onDeleteServer={onDeleteServer}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800">
          <button className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors">
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors ${isResizing ? 'bg-blue-500' : ''}`}
        />
      </aside>

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} />
      )}
    </>
  )
}
