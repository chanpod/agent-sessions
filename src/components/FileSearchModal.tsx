import { useEffect, useRef, useCallback } from 'react'
import { Search, File, Folder } from 'lucide-react'
import { useFileSearchStore } from '../stores/file-search-store'
import { useProjectStore } from '../stores/project-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { useTerminalStore } from '../stores/terminal-store'

export function FileSearchModal() {
  const { isOpen, query, filteredFiles, selectedIndex, closeSearch, setQuery, selectNext, selectPrevious, setFiles } = useFileSearchStore()
  const { projects, activeProjectId } = useProjectStore()
  const { activeSessionId, sessions } = useTerminalStore()
  const { openFile } = useFileViewerStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Get the active project - either explicitly selected or based on active terminal
  const getActiveProject = useCallback(() => {
    // First, try to use explicitly selected project
    if (activeProjectId) {
      return projects.find(p => p.id === activeProjectId)
    }

    // Otherwise, use the project that contains the active terminal
    if (activeSessionId) {
      const activeSession = sessions.find(s => s.id === activeSessionId)
      if (activeSession) {
        return projects.find(p => p.id === activeSession.projectId)
      }
    }

    return null
  }, [activeProjectId, activeSessionId, projects, sessions])

  // Recursively load all files from the project directory
  const loadProjectFiles = useCallback(async (rootPath: string) => {
    const files: string[] = []
    const maxFiles = 10000 // Limit to prevent performance issues
    const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.vscode', '.idea'])

    const walkDir = async (dirPath: string, depth = 0): Promise<void> => {
      if (files.length >= maxFiles || depth > 20) return

      try {
        const result = await window.electron?.fs.listDir(dirPath)
        if (!result?.success || !result.items) return

        for (const entry of result.items) {
          // Skip ignored directories
          if (entry.isDirectory && ignoredDirs.has(entry.name)) {
            continue
          }

          if (entry.isFile) {
            // Store relative path from project root
            const relativePath = entry.path.replace(rootPath, '').replace(/^[/\\]/, '')
            files.push(relativePath)
          } else if (entry.isDirectory) {
            await walkDir(entry.path, depth + 1)
          }
        }
      } catch (error) {
        console.error('Error walking directory:', error)
      }
    }

    await walkDir(rootPath)
    return files
  }, [])

  // Load files when modal opens
  useEffect(() => {
    if (isOpen) {
      const activeProject = getActiveProject()
      if (activeProject?.path) {
        loadProjectFiles(activeProject.path).then(files => {
          if (files) {
            setFiles(files)
          }
        })
      }
      // Focus input when modal opens
      inputRef.current?.focus()
    }
  }, [isOpen, getActiveProject, loadProjectFiles, setFiles])

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeSearch()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectNext()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectPrevious()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selectedFile = filteredFiles[selectedIndex]
        if (selectedFile) {
          handleSelectFile(selectedFile)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeSearch, selectNext, selectPrevious, filteredFiles, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedIndex])

  const handleSelectFile = async (relativePath: string) => {
    const activeProject = getActiveProject()
    if (!activeProject?.path) return

    const fullPath = `${activeProject.path}/${relativePath}`.replace(/\\/g, '/')

    try {
      const result = await window.electron?.fs.readFile(fullPath)
      if (result?.success && result.content !== undefined) {
        openFile(fullPath, result.content)
        closeSearch()
      } else {
        console.error('Failed to read file:', result?.error)
      }
    } catch (error) {
      console.error('Error opening file:', error)
    }
  }

  if (!isOpen) return null

  const activeProject = getActiveProject()
  const displayLimit = 100 // Only show first 100 results for performance

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-20"
      onClick={closeSearch}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={activeProject ? `Search files in ${activeProject.name}...` : 'No active project'}
            className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-200 placeholder-zinc-600"
            disabled={!activeProject}
          />
          {filteredFiles.length > 0 && (
            <span className="text-xs text-zinc-500">
              {filteredFiles.length > displayLimit ? `${displayLimit}+` : filteredFiles.length} files
            </span>
          )}
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto"
        >
          {filteredFiles.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              {query ? 'No files found' : 'Type to search files...'}
            </div>
          ) : (
            filteredFiles.slice(0, displayLimit).map((file, index) => {
              const isSelected = index === selectedIndex
              const fileName = file.split(/[/\\]/).pop() || file
              const dirPath = file.substring(0, file.length - fileName.length)

              return (
                <div
                  key={file}
                  className={`flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                  onClick={() => handleSelectFile(file)}
                  onMouseEnter={() => useFileSearchStore.getState().setSelectedIndex(index)}
                >
                  <File className="w-4 h-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium truncate">{fileName}</span>
                      {dirPath && (
                        <>
                          <span className={isSelected ? 'text-blue-200' : 'text-zinc-500'}>•</span>
                          <span className={`text-xs truncate ${isSelected ? 'text-blue-200' : 'text-zinc-500'}`}>
                            {dirPath}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500">
          <div className="flex items-center gap-4">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>Esc Close</span>
          </div>
          {activeProject && (
            <div className="flex items-center gap-1">
              <Folder className="w-3 h-3" />
              <span>{activeProject.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
