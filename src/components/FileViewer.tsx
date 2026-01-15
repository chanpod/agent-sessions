import { useEffect, useRef, useCallback } from 'react'
import Editor, { loader, OnMount, DiffEditor } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { X, Save, Circle, GitCompare } from 'lucide-react'
import { useFileViewerStore, OpenFile } from '../stores/file-viewer-store'
import { cn } from '../lib/utils'

// Configure Monaco to use local instance instead of CDN (required for Electron)
loader.config({ monaco })

interface FileTabProps {
  file: OpenFile
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function FileTab({ file, isActive, onSelect, onClose }: FileTabProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-zinc-800 cursor-pointer group',
        isActive
          ? 'bg-zinc-900 text-white'
          : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-300'
      )}
      onClick={onSelect}
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

export function FileViewer() {
  const {
    openFiles,
    activeFilePath,
    isVisible,
    showDiff,
    setActiveFile,
    closeFile,
    updateFileContent,
    markFileSaved,
    setVisibility,
    toggleDiffMode,
    setGitContent,
  } = useFileViewerStore()

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activeFile = openFiles.find((f) => f.path === activeFilePath)

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

    const result = await window.electron.fs.writeFile(activeFile.path, activeFile.content)
    if (result.success) {
      markFileSaved(activeFile.path)
    } else {
      console.error('Failed to save file:', result.error)
    }
  }, [activeFile, markFileSaved])

  // Global keyboard shortcut for Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && isVisible && activeFile) {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, activeFile, handleSave])

  if (!isVisible || openFiles.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Tab bar */}
      <div className="flex items-center bg-zinc-950 border-b border-zinc-800 overflow-x-auto">
        <div className="flex flex-1 min-w-0">
          {openFiles.map((file) => (
            <FileTab
              key={file.path}
              file={file}
              isActive={file.path === activeFilePath}
              onSelect={() => setActiveFile(file.path)}
              onClose={() => closeFile(file.path)}
            />
          ))}
        </div>
        <div className="flex items-center px-2 gap-1">
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
    </div>
  )
}
