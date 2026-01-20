import { useState, useEffect } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { cn } from '../lib/utils'
import type { DirEntry } from '../types/electron'

interface FileBrowserProps {
  projectId: string
  rootPath: string
  maxDepth?: number
}

interface TreeNodeProps {
  projectId: string
  entry: DirEntry
  depth: number
  maxDepth: number
  rootPath: string
}

// Files/folders to hide
const HIDDEN_ENTRIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
])

function TreeNode({ projectId, entry, depth, maxDepth, rootPath }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const { openFile } = useFileViewerStore()

  const loadChildren = async () => {
    if (!window.electron || !entry.isDirectory) return

    setIsLoading(true)
    const result = await window.electron.fs.listDir(entry.path, projectId)
    setIsLoading(false)

    if (result.success && result.items) {
      // Filter hidden entries
      const filtered = result.items.filter((item) => !HIDDEN_ENTRIES.has(item.name))
      setChildren(filtered)
    }
  }

  const handleClick = async () => {
    if (entry.isDirectory) {
      if (!isExpanded && children.length === 0) {
        await loadChildren()
      }
      setIsExpanded(!isExpanded)
    } else {
      // Open file
      if (!window.electron) return
      const result = await window.electron.fs.readFile(entry.path, projectId)
      if (result.success && result.content !== undefined) {
        openFile(entry.path, entry.name, result.content, rootPath)
      }
    }
  }

  const canExpand = entry.isDirectory && depth < maxDepth

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        className={cn(
          'flex items-center gap-1 px-1 py-0.5 text-xs rounded cursor-pointer',
          'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300',
          entry.isFile && 'hover:text-blue-400'
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {entry.isDirectory && canExpand && (
          <ChevronRight
            className={cn(
              'w-3 h-3 flex-shrink-0 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        )}
        {entry.isDirectory && !canExpand && <span className="w-3" />}
        {entry.isFile && <span className="w-3" />}

        {entry.isDirectory ? (
          isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
          ) : (
            <Folder className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
          )
        ) : (
          <FileIcon filename={entry.name} />
        )}

        <span className="truncate">{entry.name}</span>
        {isLoading && <span className="text-[10px] text-zinc-600">...</span>}
      </div>

      {isExpanded && canExpand && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              projectId={projectId}
              entry={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              rootPath={rootPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  // Color based on file type
  const colorClass = (() => {
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'text-blue-400'
      case 'js':
      case 'jsx':
        return 'text-yellow-400'
      case 'json':
        return 'text-yellow-600'
      case 'css':
      case 'scss':
      case 'less':
        return 'text-purple-400'
      case 'html':
        return 'text-orange-400'
      case 'md':
        return 'text-zinc-400'
      case 'py':
        return 'text-green-400'
      case 'go':
        return 'text-cyan-400'
      case 'rs':
        return 'text-orange-500'
      default:
        return 'text-zinc-500'
    }
  })()

  return <File className={cn('w-3.5 h-3.5 flex-shrink-0', colorClass)} />
}

export function FileBrowser({ projectId, rootPath, maxDepth = 4 }: FileBrowserProps) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadRoot = async () => {
      if (!window.electron) return

      setIsLoading(true)
      setError(null)

      const result = await window.electron.fs.listDir(rootPath, projectId)

      setIsLoading(false)

      if (result.success && result.items) {
        // Filter hidden entries
        const filtered = result.items.filter((item) => !HIDDEN_ENTRIES.has(item.name))
        setEntries(filtered)
      } else {
        setError(result.error || 'Failed to load directory')
      }
    }

    loadRoot()
  }, [projectId, rootPath])

  if (isLoading) {
    return <div className="px-2 py-1 text-xs text-zinc-600">Loading...</div>
  }

  if (error) {
    return <div className="px-2 py-1 text-xs text-red-400">{error}</div>
  }

  if (entries.length === 0) {
    return <div className="px-2 py-1 text-xs text-zinc-600">Empty directory</div>
  }

  return (
    <div className="py-1">
      {entries.map((entry) => (
        <TreeNode key={entry.path} projectId={projectId} entry={entry} depth={0} maxDepth={maxDepth} rootPath={rootPath} />
      ))}
    </div>
  )
}
