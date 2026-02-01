import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import Editor, { loader, OnMount, DiffEditor } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { X, Save, Circle, GitCompare, Search, CaseSensitive, Regex, WholeWord } from 'lucide-react'
import { useFileViewerStore, OpenFile } from '../stores/file-viewer-store'
import { useProjectStore } from '../stores/project-store'
import { cn } from '../lib/utils'

// Configure Monaco to use local instance instead of CDN (required for Electron)
loader.config({ monaco })

interface FileTabProps {
  file: OpenFile
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function FileTab({ file, isActive, onSelect, onClose, onContextMenu }: FileTabProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-zinc-800 cursor-pointer group',
        isActive
          ? 'bg-zinc-900 text-white'
          : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-300'
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {file.isDirty && (
        <Circle className="w-2 h-2 fill-amber-400 text-amber-400" />
      )}
      <span className="truncate max-w-[120px]" title={file.path}>
        {file.name}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={cn(
          'p-0.5 rounded hover:bg-zinc-700',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

interface SearchBarProps {
  onClose: () => void
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>
}

function SearchBar({ onClose, editorRef }: SearchBarProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus input when search bar opens
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!editorRef.current) return

    const editor = editorRef.current
    const findController = editor.getContribution('editor.contrib.findController') as any

    if (findController) {
      // Update find state when options change
      findController.getState().change({
        searchString: searchTerm,
        isRegex: useRegex,
        matchCase: matchCase,
        wholeWord: wholeWord,
      }, false)

      if (searchTerm) {
        findController.start({
          forceRevealReplace: false,
          seedSearchStringFromSelection: 'none',
          seedSearchStringFromNonEmptySelection: false,
          shouldFocus: 0, // Don't focus find widget
          shouldAnimate: true,
        })
      }
    }
  }, [searchTerm, matchCase, wholeWord, useRegex, editorRef])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      if (!editorRef.current) return
      const findController = editorRef.current.getContribution('editor.contrib.findController') as any
      if (findController) {
        if (e.shiftKey) {
          findController.moveToPrevMatch()
        } else {
          findController.moveToNextMatch()
        }
      }
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
      <div className="flex items-center gap-1 flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1">
        <Search className="w-3.5 h-3.5 text-zinc-500" />
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find"
          className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
        />
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setMatchCase(!matchCase)}
          className={cn(
            'p-1 rounded hover:bg-zinc-800 transition-colors',
            matchCase ? 'text-blue-400 bg-blue-500/20' : 'text-zinc-500 hover:text-zinc-300'
          )}
          title="Match Case"
        >
          <CaseSensitive className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setWholeWord(!wholeWord)}
          className={cn(
            'p-1 rounded hover:bg-zinc-800 transition-colors',
            wholeWord ? 'text-blue-400 bg-blue-500/20' : 'text-zinc-500 hover:text-zinc-300'
          )}
          title="Match Whole Word"
        >
          <WholeWord className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setUseRegex(!useRegex)}
          className={cn(
            'p-1 rounded hover:bg-zinc-800 transition-colors',
            useRegex ? 'text-blue-400 bg-blue-500/20' : 'text-zinc-500 hover:text-zinc-300'
          )}
          title="Use Regular Expression"
        >
          <Regex className="w-3.5 h-3.5" />
        </button>
      </div>

      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
        title="Close (Esc)"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function FileViewer() {
  const {
    openFiles,
    activeFilePath,
    isVisible,
    showDiff,
    setActiveFile,
    closeFile,
    closeOtherFiles,
    closeAllFiles,
    closeFilesToRight,
    closeFilesToLeft,
    updateFileContent,
    markFileSaved,
    setVisibility,
    toggleDiffMode,
    setGitContent,
  } = useFileViewerStore()

  // Get active project to scope tabs
  const { projects, activeProjectId } = useProjectStore()
  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const [showSearch, setShowSearch] = useState(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    filePath: string
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Filter files to only show tabs for the active project
  const displayedFiles = useMemo(() => {
    if (!activeProject) return openFiles
    return openFiles.filter((f) => f.projectPath === activeProject.path)
  }, [openFiles, activeProject])

  // When switching projects, update the active file to one from that project (or null)
  useEffect(() => {
    if (!activeProject) return

    // Check if current active file belongs to the new project
    const activeFileInProject = activeFilePath
      ? openFiles.some((f) => f.path === activeFilePath && f.projectPath === activeProject.path)
      : false

    if (!activeFileInProject) {
      // Find the first file from this project, or null
      const firstFileInProject = openFiles.find((f) => f.projectPath === activeProject.path)
      setActiveFile(firstFileInProject?.path ?? null)
    }
  }, [activeProject?.path, openFiles, activeFilePath, setActiveFile])

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [contextMenu])

  // Load git content when diff mode is enabled
  useEffect(() => {
    if (!showDiff || !activeFile || !window.electron) return
    if (activeFile.gitContentLoaded) return
    if (!activeFile.projectPath) return

    const loadGitContent = async () => {
      // Get relative path from project path
      const projectPath = activeFile.projectPath!
      const relativePath = activeFile.path.replace(projectPath + '/', '').replace(projectPath + '\\', '')

      const result = await window.electron!.git.getFileContent(
        projectPath,
        relativePath
      )

      if (result.success && result.content !== undefined) {
        setGitContent(activeFile.path, result.content)
      } else {
        // File is new or not in git, set empty content for diff
        setGitContent(activeFile.path, '')
      }
    }

    loadGitContent()
  }, [showDiff, activeFile, setGitContent])

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor

    // Add keyboard shortcut for save (Ctrl+S / Cmd+S)
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        handleSave()
      }
    )
  }

  const handleSave = useCallback(async () => {
    if (!activeFile || !window.electron) return

    const result = await window.electron.fs.writeFile(activeFile.path, activeFile.content, activeFile.projectId)
    if (result.success) {
      markFileSaved(activeFile.path)
    } else {
      console.error('Failed to save file:', result.error)
    }
  }, [activeFile, markFileSaved])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible || !activeFile) return

      // Ctrl+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }

      // Ctrl+F to open Monaco's built-in find widget
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !showDiff && editorRef.current) {
        e.preventDefault()
        const action = editorRef.current.getAction('actions.find')
        if (action) {
          action.run()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, activeFile, handleSave, showDiff])

  if (!isVisible || openFiles.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Tab bar */}
      <div className="flex items-center bg-zinc-950 border-b border-zinc-800 overflow-x-auto">
        <div className="flex flex-1 min-w-0">
          {displayedFiles.map((file) => (
            <FileTab
              key={file.path}
              file={file}
              isActive={file.path === activeFilePath}
              onSelect={() => setActiveFile(file.path)}
              onClose={() => closeFile(file.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path })
              }}
            />
          ))}
        </div>
        <div className="flex items-center px-2 gap-1">
          {!showDiff && (
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={cn(
                'p-1 rounded hover:bg-zinc-800',
                showSearch ? 'text-blue-400 bg-blue-500/20' : 'text-zinc-400 hover:text-white'
              )}
              title="Find (Ctrl+F)"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
          {activeFile?.projectPath && (
            <button
              onClick={toggleDiffMode}
              className={cn(
                'p-1 rounded hover:bg-zinc-800',
                showDiff ? 'text-blue-400 bg-blue-500/20' : 'text-zinc-400 hover:text-white'
              )}
              title={showDiff ? 'Hide diff (compare with git HEAD)' : 'Show diff (compare with git HEAD)'}
            >
              <GitCompare className="w-4 h-4" />
            </button>
          )}
          {activeFile?.isDirty && (
            <button
              onClick={handleSave}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
              title="Save (Ctrl+S)"
            >
              <Save className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setVisibility(false)}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
            title="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && !showDiff && (
        <SearchBar
          onClose={() => setShowSearch(false)}
          editorRef={editorRef}
        />
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {activeFile && showDiff && activeFile.gitContentLoaded ? (
          <DiffEditor
            height="100%"
            language={activeFile.language}
            original={activeFile.gitContent || ''}
            modified={activeFile.content}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              renderWhitespace: 'selection',
              renderSideBySide: true,
              readOnly: false,
              originalEditable: false,
            }}
            onMount={(editor) => {
              // Get the modified editor for making changes
              const modifiedEditor = editor.getModifiedEditor()
              modifiedEditor.onDidChangeModelContent(() => {
                const value = modifiedEditor.getValue()
                if (value !== undefined) {
                  updateFileContent(activeFile.path, value)
                }
              })
            }}
          />
        ) : activeFile ? (
          <Editor
            height="100%"
            language={activeFile.language}
            value={activeFile.content}
            theme="vs-dark"
            onMount={handleEditorMount}
            onChange={(value) => {
              if (value !== undefined) {
                updateFileContent(activeFile.path, value)
              }
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              tabSize: 2,
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              padding: { top: 8 },
            }}
          />
        ) : null}
      </div>

      {/* Status bar */}
      {activeFile && (
        <div className="flex items-center justify-between px-3 py-1 bg-zinc-900 border-t border-zinc-800 text-[11px] text-zinc-500">
          <span className="truncate">{activeFile.path}</span>
          <span>{activeFile.language}</span>
        </div>
      )}

      {/* Tab Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed py-1 bg-[#2d2d2d] border border-gray-700 rounded shadow-lg z-[100] min-w-[160px]"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
          }}
        >
          <button
            onClick={() => {
              closeFile(contextMenu.filePath)
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
          >
            <X className="w-3 h-3" />
            Close
          </button>
          <button
            onClick={() => {
              closeOtherFiles(contextMenu.filePath)
              setContextMenu(null)
            }}
            disabled={openFiles.length <= 1}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-300"
          >
            Close Others
          </button>
          <button
            onClick={() => {
              closeAllFiles()
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
          >
            Close All
          </button>
          <div className="border-t border-zinc-700 my-1" />
          <button
            onClick={() => {
              closeFilesToLeft(contextMenu.filePath)
              setContextMenu(null)
            }}
            disabled={openFiles.findIndex((f) => f.path === contextMenu.filePath) === 0}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-300"
          >
            Close to the Left
          </button>
          <button
            onClick={() => {
              closeFilesToRight(contextMenu.filePath)
              setContextMenu(null)
            }}
            disabled={openFiles.findIndex((f) => f.path === contextMenu.filePath) === openFiles.length - 1}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-300"
          >
            Close to the Right
          </button>
        </div>
      )}
    </div>
  )
}
