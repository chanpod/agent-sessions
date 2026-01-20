import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, File, Folder, FolderOpen, Search, X } from 'lucide-react'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { useFileCacheStore } from '../stores/file-cache-store'
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
  searchTerm?: string
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

// Simple substring match - case insensitive
function fuzzyMatch(searchTerm: string, text: string): boolean {
  if (!searchTerm) return true

  const search = searchTerm.toLowerCase()
  const target = text.toLowerCase()

  // Simple substring match only
  return target.includes(search)
}

function TreeNode({ projectId, entry, depth, maxDepth, rootPath, searchTerm = '' }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const { openFile } = useFileViewerStore()
  const { getCachedDir, setCachedDir, setLoading: setCacheLoading } = useFileCacheStore()

  const loadChildren = async (useCache = true) => {
    if (!window.electron || !entry.isDirectory) return

    // Check cache first
    if (useCache) {
      const cached = getCachedDir(entry.path)
      if (cached && cached.entries.length > 0) {
        setChildren(cached.entries)
        // If cache is fresh (< 5 seconds), don't refresh in background
        if (Date.now() - cached.timestamp < 5000) {
          return
        }
      }
    }

    setIsLoading(true)
    setCacheLoading(entry.path, true)
    const result = await window.electron.fs.listDir(entry.path, projectId)
    setIsLoading(false)

    if (result.success && result.items) {
      // Filter hidden entries
      const filtered = result.items.filter((item) => !HIDDEN_ENTRIES.has(item.name))
      setChildren(filtered)
      setCachedDir(entry.path, filtered)
    } else {
      setCachedDir(entry.path, [], result.error || 'Failed to load directory')
    }
  }

  // Check recursively if any descendant matches the search
  // This uses the cached/loaded children data
  const hasMatchingDescendant = useCallback((entries: DirEntry[], term: string): boolean => {
    if (!term) return true

    for (const child of entries) {
      // If file matches, we found a matching descendant
      if (child.isFile && fuzzyMatch(term, child.name)) {
        return true
      }

      // If directory name matches, we found a matching descendant
      if (child.isDirectory && fuzzyMatch(term, child.name)) {
        return true
      }

      // For directories, check if they might have matches
      // We can only check loaded children from cache
      if (child.isDirectory) {
        const cached = getCachedDir(child.path)
        if (cached && cached.entries.length > 0) {
          // Recursively check the cached children
          if (hasMatchingDescendant(cached.entries, term)) {
            return true
          }
        }
      }
    }

    return false
  }, [getCachedDir])

  // Load children automatically when searching
  useEffect(() => {
    if (searchTerm && entry.isDirectory && children.length === 0 && depth < maxDepth) {
      loadChildren()
    }
  }, [searchTerm])

  // Auto-expand when searching and children are loaded
  useEffect(() => {
    if (searchTerm && entry.isDirectory && children.length > 0) {
      setIsExpanded(true)
    }
  }, [searchTerm, children, entry.isDirectory])

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

  // Determine if this node should be visible when searching
  if (searchTerm) {
    const nodeMatches = fuzzyMatch(searchTerm, entry.name)

    // For files: only show if the file matches
    if (entry.isFile && !nodeMatches) {
      return null
    }

    // For directories: show if directory name matches OR it hasn't loaded yet OR has any matching descendants
    if (entry.isDirectory) {
      if (nodeMatches) {
        // Directory name matches, always show
        // Fall through to render
      } else {
        // Directory name doesn't match
        const hasLoadedChildren = children.length > 0

        if (!hasLoadedChildren) {
          // Children not loaded yet, show it (will auto-load)
          // Fall through to render
        } else {
          // Children are loaded - recursively check if any descendants match
          if (!hasMatchingDescendant(children, searchTerm)) {
            // No matching descendants - hide this directory
            return null
          }
          // Has matching descendants, show
          // Fall through to render
        }
      }
    }
  }

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
              searchTerm={searchTerm}
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
  const [searchTerm, setSearchTerm] = useState('')
  const { getCachedDir, setCachedDir, setLoading: setCacheLoading } = useFileCacheStore()

  useEffect(() => {
    const loadRoot = async () => {
      if (!window.electron) return

      // Check cache first
      const cached = getCachedDir(rootPath)
      if (cached) {
        if (cached.entries.length > 0) {
          setEntries(cached.entries)
          setError(null)
        } else if (cached.error) {
          setError(cached.error)
        }

        // If cache is fresh (< 5 seconds), skip refresh
        if (Date.now() - cached.timestamp < 5000) {
          return
        }

        // Otherwise, refresh in background without showing loading state
      } else {
        // No cache, show loading state
        setIsLoading(true)
      }

      setError(null)
      setCacheLoading(rootPath, true)

      const result = await window.electron.fs.listDir(rootPath, projectId)

      setIsLoading(false)

      if (result.success && result.items) {
        // Filter hidden entries
        const filtered = result.items.filter((item) => !HIDDEN_ENTRIES.has(item.name))
        setEntries(filtered)
        setCachedDir(rootPath, filtered)
      } else {
        const errorMsg = result.error || 'Failed to load directory'
        setError(errorMsg)
        setCachedDir(rootPath, [], errorMsg)
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
    <div>
      {/* Search input */}
      <div className="px-2 py-1.5 border-b border-zinc-800">
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
          <Search className="w-3 h-3 text-zinc-500 flex-shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search files..."
            className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* File tree */}
      <div className="py-1">
        {entries.map((entry) => (
          <TreeNode
            key={entry.path}
            projectId={projectId}
            entry={entry}
            depth={0}
            maxDepth={maxDepth}
            rootPath={rootPath}
            searchTerm={searchTerm}
          />
        ))}
      </div>
    </div>
  )
}
