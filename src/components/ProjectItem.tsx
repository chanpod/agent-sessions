import { ChevronRight, Terminal, X, Server, GitBranch, Plus, Folder, Play, Square, Command, RefreshCw, Check, Cloud, GripVertical, Pencil, FileCode, FileText, FilePlus, FileMinus, FileQuestion, FileSymlink, ExternalLink } from 'lucide-react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore, TerminalSession } from '../stores/terminal-store'
import { useServerStore, ServerInstance } from '../stores/server-store'
import { useGridStore } from '../stores/grid-store'
import { ActivityIndicator } from './ActivityIndicator'
import { FileBrowser } from './FileBrowser'
import { cn } from '../lib/utils'
import { useState, useEffect, useRef } from 'react'
import type { ChangedFile } from '../types/electron'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { useFileViewerStore } from '../stores/file-viewer-store'

interface ShellInfo {
  name: string
  path: string
}

interface ScriptInfo {
  name: string
  command: string
}

interface ProjectItemProps {
  project: Project
  shells: ShellInfo[]
  onCreateTerminal: (projectId: string, shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onRestartServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

export function ProjectItem({
  project,
  shells,
  onCreateTerminal,
  onCloseTerminal,
  onStartServer,
  onStopServer,
  onRestartServer,
  onDeleteServer,
}: ProjectItemProps) {
  const { toggleProjectExpanded, activeProjectId, setActiveProject } = useProjectStore()
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
  const { servers } = useServerStore()
  const { openFile } = useFileViewerStore()

  const [showShellMenu, setShowShellMenu] = useState(false)
  const [showServerMenu, setShowServerMenu] = useState(false)
  const [scripts, setScripts] = useState<ScriptInfo[]>([])
  const [packageManager, setPackageManager] = useState('npm')
  const [showCustomCommand, setShowCustomCommand] = useState(false)
  const [customCommand, setCustomCommand] = useState('')
  const [customName, setCustomName] = useState('')
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [gitHasChanges, setGitHasChanges] = useState(false)
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [localBranches, setLocalBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])
  const [showChangedFilesMenu, setShowChangedFilesMenu] = useState(false)

  // Filter out server terminals from regular terminal list (they have shell: '')
  const projectSessions = sessions.filter((s) => s.projectId === project.id && s.shell !== '')
  const projectServers = servers.filter((s) => s.projectId === project.id)
  const isActive = activeProjectId === project.id

  // Check if this project contains the active/focused terminal
  const hasFocusedTerminal = activeSessionId &&
    sessions.some(s => s.id === activeSessionId && s.projectId === project.id)

  // Fetch git info and watch for changes
  useEffect(() => {
    if (!window.electron) return

    const fetchGitInfo = async () => {
      const result = await window.electron!.git.getInfo(project.path)
      if (result.isGitRepo) {
        setGitBranch(result.branch || null)
        setGitHasChanges(result.hasChanges || false)
        // Fetch changed files if there are changes
        if (result.hasChanges) {
          const filesResult = await window.electron!.git.getChangedFiles(project.path)
          if (filesResult.success && filesResult.files) {
            setChangedFiles(filesResult.files)
          }
        } else {
          setChangedFiles([])
        }
      } else {
        setGitBranch(null)
        setGitHasChanges(false)
        setChangedFiles([])
      }
    }

    // Initial fetch
    fetchGitInfo()

    // Start watching for git changes
    window.electron.git.watch(project.path)

    // Listen for changes from file watcher
    const unsubscribe = window.electron.git.onChanged((changedPath) => {
      if (changedPath === project.path) {
        fetchGitInfo()
      }
    })

    return () => {
      unsubscribe()
      window.electron?.git.unwatch(project.path)
    }
  }, [project.path])

  // Fetch scripts when project is expanded
  useEffect(() => {
    if (project.isExpanded && window.electron) {
      window.electron.project.getScripts(project.path).then((result) => {
        if (result.hasPackageJson) {
          setScripts(result.scripts)
          setPackageManager(result.packageManager || 'npm')
        } else {
          setScripts([])
        }
      })
    }
  }, [project.isExpanded, project.path])

  const handleShellSelect = (shell: ShellInfo) => {
    onCreateTerminal(project.id, shell)
    setShowShellMenu(false)
  }

  const handleScriptSelect = (script: ScriptInfo) => {
    const command = `${packageManager} run ${script.name}`
    onStartServer(project.id, script.name, command)
    setShowServerMenu(false)
  }

  const handleCustomCommand = () => {
    if (customCommand.trim()) {
      onStartServer(project.id, customName || 'custom', customCommand.trim())
      setCustomCommand('')
      setCustomName('')
      setShowCustomCommand(false)
      setShowServerMenu(false)
    }
  }

  const refreshGitInfo = async () => {
    if (!window.electron) return
    const result = await window.electron.git.getInfo(project.path)
    if (result.isGitRepo) {
      setGitBranch(result.branch || null)
      setGitHasChanges(result.hasChanges || false)
    }
  }

  const handleBranchClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron || !gitBranch) return

    setShowBranchMenu(!showBranchMenu)
    setShowShellMenu(false)
    setShowServerMenu(false)

    if (!showBranchMenu) {
      // Fetch branch list when opening menu
      const result = await window.electron.git.listBranches(project.path)
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
    }
  }

  const handleFetch = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron || isFetching) return

    setIsFetching(true)
    try {
      await window.electron.git.fetch(project.path)
      // Refresh branch list after fetch
      const result = await window.electron.git.listBranches(project.path)
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
    } finally {
      setIsFetching(false)
    }
  }

  const handleCheckout = async (branch: string) => {
    if (!window.electron || isCheckingOut) return

    setIsCheckingOut(true)
    try {
      const result = await window.electron.git.checkout(project.path, branch)
      if (result.success) {
        await refreshGitInfo()
        setShowBranchMenu(false)
      } else {
        console.error('Checkout failed:', result.error)
      }
    } finally {
      setIsCheckingOut(false)
    }
  }

  const handleChangedFilesClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowChangedFilesMenu(!showChangedFilesMenu)
    setShowBranchMenu(false)
    setShowShellMenu(false)
    setShowServerMenu(false)
  }

  const handleOpenInEditor = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron) return
    await window.electron.system.openInEditor(project.path)
  }

  const handleOpenChangedFile = async (filePath: string) => {
    if (!window.electron) return

    // Construct full path (handle both / and \ separators)
    const separator = project.path.includes('\\') ? '\\' : '/'
    const fullPath = `${project.path}${separator}${filePath}`.replace(/\/\//g, '/').replace(/\\\\/g, '\\')
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath

    // Read file content
    const result = await window.electron.fs.readFile(fullPath)
    if (result.success && result.content !== undefined) {
      openFile(fullPath, fileName, result.content, project.path)
      setShowChangedFilesMenu(false)
    }
  }

  // Group changed files by status
  const groupedFiles = {
    modified: changedFiles.filter((f) => f.status === 'modified'),
    added: changedFiles.filter((f) => f.status === 'added'),
    deleted: changedFiles.filter((f) => f.status === 'deleted'),
    untracked: changedFiles.filter((f) => f.status === 'untracked'),
    renamed: changedFiles.filter((f) => f.status === 'renamed'),
  }

  return (
    <div className="mb-1">
      {/* Project Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          setActiveProject(project.id)
          toggleProjectExpanded(project.id)
        }}
        onKeyDown={(e) => e.key === 'Enter' && toggleProjectExpanded(project.id)}
        className={cn(
          'w-full flex items-center gap-1 px-2 py-1.5 text-sm rounded-md transition-colors cursor-pointer group',
          isActive
            ? 'bg-zinc-800 text-white'
            : 'text-zinc-300 hover:bg-zinc-800/50',
          hasFocusedTerminal && 'ring-1 ring-green-500/50 bg-green-500/5'
        )}
      >
        <ChevronRight
          className={cn(
            'w-4 h-4 transition-transform flex-shrink-0',
            project.isExpanded && 'rotate-90'
          )}
        />
        <Folder className={cn('w-4 h-4 flex-shrink-0', hasFocusedTerminal ? 'text-green-400' : 'text-blue-400')} />
        <span className="truncate font-medium">{project.name}</span>
        {gitBranch && (
          <div className="relative">
            <button
              onClick={handleBranchClick}
              className={cn(
                'flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full transition-colors',
                gitHasChanges
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                  : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700'
              )}
            >
              <GitBranch className="w-3 h-3" />
              <span className="max-w-[80px] truncate">{gitBranch}</span>
              {gitHasChanges && <span className="text-amber-400">•</span>}
            </button>

            {showBranchMenu && (
              <div className="absolute left-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[200px] max-h-[400px] overflow-y-auto">
                {/* Fetch button */}
                <button
                  onClick={handleFetch}
                  disabled={isFetching}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left border-b border-zinc-700 mb-1"
                >
                  <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
                  {isFetching ? 'Fetching...' : 'Fetch from remote'}
                </button>

                {/* Local branches */}
                {localBranches.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">
                      Local branches
                    </div>
                    {localBranches.map((branch) => (
                      <button
                        key={branch}
                        onClick={() => handleCheckout(branch)}
                        disabled={isCheckingOut || branch === gitBranch}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                          branch === gitBranch
                            ? 'text-green-400 bg-green-500/10'
                            : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                        )}
                      >
                        {branch === gitBranch ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <GitBranch className="w-3 h-3" />
                        )}
                        <span className="truncate">{branch}</span>
                      </button>
                    ))}
                  </>
                )}

                {/* Remote branches */}
                {remoteBranches.length > 0 && (
                  <>
                    <div className="border-t border-zinc-700 my-1" />
                    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">
                      Remote branches
                    </div>
                    {remoteBranches.map((branch) => {
                      const localName = branch.split('/').slice(1).join('/')
                      const hasLocal = localBranches.includes(localName)
                      return (
                        <button
                          key={branch}
                          onClick={() => handleCheckout(branch)}
                          disabled={isCheckingOut || hasLocal}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                            hasLocal
                              ? 'text-zinc-600'
                              : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                          )}
                          title={hasLocal ? 'Already have local branch' : `Checkout ${branch}`}
                        >
                          <Cloud className="w-3 h-3" />
                          <span className="truncate">{branch}</span>
                        </button>
                      )
                    })}
                  </>
                )}

                {localBranches.length === 0 && remoteBranches.length === 0 && (
                  <div className="px-3 py-2 text-xs text-zinc-500">
                    No branches found
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Changed Files Badge */}
        {gitHasChanges && changedFiles.length > 0 && (
          <div className="relative">
            <button
              onClick={handleChangedFilesClick}
              className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full transition-colors bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
            >
              <FileText className="w-3 h-3" />
              <span>{changedFiles.length} {changedFiles.length === 1 ? 'file' : 'files'}</span>
            </button>

            {showChangedFilesMenu && (
              <div className="absolute left-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[250px] max-h-[400px] overflow-y-auto">
                {/* Modified files */}
                {groupedFiles.modified.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] text-amber-400 uppercase flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      Modified ({groupedFiles.modified.length})
                    </div>
                    {groupedFiles.modified.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleOpenChangedFile(file.path)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 text-left"
                      >
                        <FileText className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        <span className="truncate flex-1" title={file.path}>{file.path}</span>
                        {file.staged && <span className="text-[10px] text-green-400">staged</span>}
                      </button>
                    ))}
                  </>
                )}

                {/* Added files */}
                {groupedFiles.added.length > 0 && (
                  <>
                    {groupedFiles.modified.length > 0 && <div className="border-t border-zinc-700 my-1" />}
                    <div className="px-3 py-1 text-[10px] text-green-400 uppercase flex items-center gap-1">
                      <FilePlus className="w-3 h-3" />
                      Added ({groupedFiles.added.length})
                    </div>
                    {groupedFiles.added.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleOpenChangedFile(file.path)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 text-left"
                      >
                        <FilePlus className="w-3 h-3 text-green-400 flex-shrink-0" />
                        <span className="truncate flex-1" title={file.path}>{file.path}</span>
                        {file.staged && <span className="text-[10px] text-green-400">staged</span>}
                      </button>
                    ))}
                  </>
                )}

                {/* Deleted files */}
                {groupedFiles.deleted.length > 0 && (
                  <>
                    {(groupedFiles.modified.length > 0 || groupedFiles.added.length > 0) && <div className="border-t border-zinc-700 my-1" />}
                    <div className="px-3 py-1 text-[10px] text-red-400 uppercase flex items-center gap-1">
                      <FileMinus className="w-3 h-3" />
                      Deleted ({groupedFiles.deleted.length})
                    </div>
                    {groupedFiles.deleted.map((file) => (
                      <div
                        key={file.path}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500"
                        title="File deleted"
                      >
                        <FileMinus className="w-3 h-3 text-red-400 flex-shrink-0" />
                        <span className="truncate flex-1 line-through" title={file.path}>{file.path}</span>
                        {file.staged && <span className="text-[10px] text-green-400">staged</span>}
                      </div>
                    ))}
                  </>
                )}

                {/* Renamed files */}
                {groupedFiles.renamed.length > 0 && (
                  <>
                    {(groupedFiles.modified.length > 0 || groupedFiles.added.length > 0 || groupedFiles.deleted.length > 0) && <div className="border-t border-zinc-700 my-1" />}
                    <div className="px-3 py-1 text-[10px] text-blue-400 uppercase flex items-center gap-1">
                      <FileSymlink className="w-3 h-3" />
                      Renamed ({groupedFiles.renamed.length})
                    </div>
                    {groupedFiles.renamed.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleOpenChangedFile(file.path)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 text-left"
                      >
                        <FileSymlink className="w-3 h-3 text-blue-400 flex-shrink-0" />
                        <span className="truncate flex-1" title={file.path}>{file.path}</span>
                        {file.staged && <span className="text-[10px] text-green-400">staged</span>}
                      </button>
                    ))}
                  </>
                )}

                {/* Untracked files */}
                {groupedFiles.untracked.length > 0 && (
                  <>
                    {(groupedFiles.modified.length > 0 || groupedFiles.added.length > 0 || groupedFiles.deleted.length > 0 || groupedFiles.renamed.length > 0) && <div className="border-t border-zinc-700 my-1" />}
                    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                      <FileQuestion className="w-3 h-3" />
                      Untracked ({groupedFiles.untracked.length})
                    </div>
                    {groupedFiles.untracked.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleOpenChangedFile(file.path)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 text-left"
                      >
                        <FileQuestion className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                        <span className="truncate flex-1" title={file.path}>{file.path}</span>
                      </button>
                    ))}
                  </>
                )}

                {changedFiles.length === 0 && (
                  <div className="px-3 py-2 text-xs text-zinc-500">
                    No changes
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <span className="flex-1" />
        <button
          onClick={handleOpenInEditor}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
          title="Open in editor"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs text-zinc-600 opacity-0 group-hover:opacity-100">
          {projectSessions.length + projectServers.length}
        </span>
      </div>

      {/* Expanded Content */}
      {project.isExpanded && (
        <div className="ml-4 mt-1 space-y-1">
          {/* Terminals Section */}
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Terminals
              </span>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowShellMenu(!showShellMenu)
                    setShowServerMenu(false)
                  }}
                  className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {showShellMenu && (
                  <div className="absolute right-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[140px]">
                    {shells.map((shell) => (
                      <button
                        key={shell.path}
                        onClick={() => handleShellSelect(shell)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
                      >
                        <Terminal className="w-3 h-3" />
                        {shell.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {projectSessions.length === 0 ? (
              <p className="text-xs text-zinc-600 px-2 py-1">No terminals</p>
            ) : (
              <ul className="space-y-0.5">
                {projectSessions.map((session) => (
                  <DraggableTerminalItem
                    key={session.id}
                    terminalId={session.id}
                    terminalTitle={session.title}
                  >
                    <TerminalItem
                      session={session}
                      isActive={activeSessionId === session.id}
                      onSelect={() => setActiveSession(session.id)}
                      onClose={() => onCloseTerminal(session.id)}
                    />
                  </DraggableTerminalItem>
                ))}
              </ul>
            )}
          </div>

          {/* Servers Section */}
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Servers
              </span>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowServerMenu(!showServerMenu)
                    setShowShellMenu(false)
                    setShowCustomCommand(false)
                  }}
                  className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {showServerMenu && !showCustomCommand && (
                  <div className="absolute right-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[180px] max-h-[300px] overflow-y-auto">
                    {scripts.length > 0 ? (
                      <>
                        <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">
                          package.json scripts
                        </div>
                        {scripts.map((script) => (
                          <button
                            key={script.name}
                            onClick={() => handleScriptSelect(script)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
                            title={script.command}
                          >
                            <Play className="w-3 h-3 text-green-500" />
                            <span className="truncate">{script.name}</span>
                          </button>
                        ))}
                        <div className="border-t border-zinc-700 my-1" />
                      </>
                    ) : (
                      <div className="px-3 py-2 text-xs text-zinc-500">
                        No package.json found
                      </div>
                    )}
                    <button
                      onClick={() => setShowCustomCommand(true)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left"
                    >
                      <Command className="w-3 h-3 text-blue-400" />
                      Custom command...
                    </button>
                  </div>
                )}
                {showServerMenu && showCustomCommand && (
                  <div className="absolute right-0 top-full mt-1 p-2 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50 min-w-[240px]">
                    <div className="text-[10px] text-zinc-500 uppercase mb-2">
                      Custom Command
                    </div>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Name (e.g., dev-server)"
                      className="w-full px-2 py-1 mb-2 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={customCommand}
                      onChange={(e) => setCustomCommand(e.target.value)}
                      placeholder="Command (e.g., node server.js)"
                      className="w-full px-2 py-1 mb-2 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600"
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomCommand()}
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => setShowCustomCommand(false)}
                        className="flex-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCustomCommand}
                        disabled={!customCommand.trim()}
                        className="flex-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded"
                      >
                        Start
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {projectServers.length === 0 ? (
              <p className="text-xs text-zinc-600 px-2 py-1 flex items-center gap-1">
                <Server className="w-3 h-3" />
                None running
              </p>
            ) : (
              <ul className="space-y-0.5">
                {projectServers.map((server) => (
                  <ServerItem
                    key={server.id}
                    server={server}
                    isActive={activeSessionId === server.terminalId}
                    onSelect={() => setActiveSession(server.terminalId)}
                    onStop={() => onStopServer(server.id)}
                    onRestart={() => onRestartServer(server.id)}
                    onDelete={() => onDeleteServer(server.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Files Section */}
          <div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowFileBrowser(!showFileBrowser)
              }}
              className="w-full flex items-center justify-between px-2 py-1 hover:bg-zinc-800/30 rounded"
            >
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                <ChevronRight
                  className={cn(
                    'w-3 h-3 transition-transform',
                    showFileBrowser && 'rotate-90'
                  )}
                />
                Files
              </span>
              <FileCode className="w-3.5 h-3.5 text-zinc-600" />
            </button>
            {showFileBrowser && (
              <div className="max-h-[300px] overflow-y-auto">
                <FileBrowser rootPath={project.path} maxDepth={4} />
              </div>
            )}
          </div>

          {/* Worktrees Section (placeholder) */}
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Worktrees
              </span>
            </div>
            <p className="text-xs text-zinc-600 px-2 py-1 flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              Not detected
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

interface TerminalItemProps {
  session: TerminalSession
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  dragHandleProps?: Record<string, unknown>
}

function TerminalItem({ session, isActive, onSelect, onClose, dragHandleProps }: TerminalItemProps) {
  const { setFocusedTerminal, setActiveGrid } = useGridStore()
  const grid = useGridStore((state) => state.grids.find((g) => g.terminalIds.includes(session.id)))
  const { updateSessionTitle } = useTerminalStore()

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSelect = () => {
    if (isEditing) return
    onSelect()
    // If terminal is in a grid, make that grid active and focus the terminal
    if (grid) {
      setActiveGrid(grid.id)
      setFocusedTerminal(grid.id, session.id)
    }
  }

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(session.title)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (editValue.trim()) {
      updateSessionTitle(session.id, editValue.trim())
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={(e) => !isEditing && e.key === 'Enter' && handleSelect()}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors group',
          isActive
            ? 'ring-2 ring-green-500 bg-green-500/10 text-green-400'
            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <div
          className="active:cursor-grabbing touch-none p-0.5"
          {...dragHandleProps}
          style={{ cursor: 'grab' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4 flex-shrink-0 opacity-30 group-hover:opacity-70" />
        </div>
        <ActivityIndicator sessionId={session.id} className="w-2 h-2" />
        <Terminal className={cn('w-3 h-3 flex-shrink-0', isActive && 'text-green-400')} />

        {/* Terminal name - editable */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-zinc-800 text-zinc-200 px-1 rounded border border-zinc-600 outline-none focus:border-green-500 text-xs"
          />
        ) : (
          <span
            className="truncate flex-1 text-left"
            onDoubleClick={handleStartEdit}
            title="Double-click to rename"
          >
            {session.title}
          </span>
        )}

        {isActive && !isEditing && (
          <span className="text-[10px] text-green-400 font-medium">focused</span>
        )}
        {grid && grid.terminalIds.length > 1 && !isActive && !isEditing && (
          <span className="text-[10px] text-blue-400">+{grid.terminalIds.length - 1}</span>
        )}
        {session.status === 'exited' && !isEditing && (
          <span className="text-[10px] text-zinc-600">exited</span>
        )}

        {/* Edit button */}
        {!isEditing && (
          <button
            onClick={handleStartEdit}
            onPointerDown={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-300"
            title="Rename"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-700 rounded"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </li>
  )
}

interface ServerItemProps {
  server: ServerInstance
  isActive: boolean
  onSelect: () => void
  onStop: () => void
  onRestart: () => void
  onDelete: () => void
}

function ServerItem({ server, isActive, onSelect, onStop, onRestart, onDelete }: ServerItemProps) {
  const { setFocusedTerminal, setActiveGrid } = useGridStore()
  const grid = useGridStore((state) => state.grids.find((g) => g.terminalIds.includes(server.terminalId)))

  const statusColors = {
    starting: 'text-yellow-500',
    running: 'text-green-500',
    stopped: 'text-zinc-500',
    error: 'text-red-500',
  }

  const handleClick = () => {
    onSelect()
    // Also focus in grid and make it active
    if (grid) {
      setActiveGrid(grid.id)
      setFocusedTerminal(grid.id, server.terminalId)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors cursor-pointer group',
          isActive
            ? 'bg-green-600/20 text-green-400'
            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
        )}
      >
        <Server className={cn('w-3 h-3 flex-shrink-0', statusColors[server.status])} />
        <span className="truncate flex-1 text-left">{server.name}</span>
        <span className="text-[10px] text-zinc-600">{server.status}</span>

        {/* Action buttons - always visible on hover */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
          {/* Restart button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRestart()
            }}
            className="p-0.5 hover:bg-zinc-700 rounded text-blue-400 hover:text-blue-300"
            title="Restart server"
          >
            <RefreshCw className="w-3 h-3" />
          </button>

          {/* Stop button - only when running */}
          {server.status === 'running' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onStop()
              }}
              className="p-0.5 hover:bg-zinc-700 rounded text-yellow-400 hover:text-yellow-300"
              title="Stop server (keep logs)"
            >
              <Square className="w-3 h-3" />
            </button>
          )}

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-0.5 hover:bg-zinc-700 rounded text-red-400 hover:text-red-300"
            title="Delete server (close terminal)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </li>
  )
}
