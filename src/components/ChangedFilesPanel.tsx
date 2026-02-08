import { useState, useCallback, useEffect, useMemo } from 'react'
import { RefreshCw, Plus, Minus, Undo2, FileText, FilePlus, FileMinus, FileQuestion, ArrowUp, ArrowDown } from 'lucide-react'
import { diffLines, type Change } from 'diff'
import { useProjectStore } from '../stores/project-store'
import { useToastStore } from '../stores/toast-store'
import { useGitStore, type GitInfo } from '../stores/git-store'
import { cn, normalizeFilePath } from '../lib/utils'
import type { ChangedFile } from '../types/electron'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { Sheet, SheetContent } from './ui/sheet'
import { BranchSwitcher } from './BranchSwitcher'

interface ChangedFilesPanelProps {
  isOpen: boolean
  onClose: () => void
}

const EMPTY_GIT_INFO: GitInfo = {
  branch: null,
  branches: [],
  isGitRepo: false,
  hasChanges: false,
  ahead: 0,
  behind: 0,
  changedFiles: [],
}

function getFileStatusIcon(status: ChangedFile['status']) {
  switch (status) {
    case 'modified':
      return { Icon: FileText, color: 'text-yellow-400' }
    case 'added':
      return { Icon: FilePlus, color: 'text-green-400' }
    case 'deleted':
      return { Icon: FileMinus, color: 'text-red-400' }
    case 'untracked':
      return { Icon: FileQuestion, color: 'text-zinc-500' }
    default:
      return { Icon: FileText, color: 'text-zinc-400' }
  }
}

export function ChangedFilesPanel({ isOpen, onClose }: ChangedFilesPanelProps) {
  const { activeProjectId, projects } = useProjectStore()

  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null)
  const [diffParts, setDiffParts] = useState<Change[] | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(860)
  const [hasResized, setHasResized] = useState(false)
  const [isResizing, setIsResizing] = useState(false)

  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pendingDiscardFile, setPendingDiscardFile] = useState<string | null>(null)
  const [pendingDiscardAll, setPendingDiscardAll] = useState(false)

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null
  const projectPath = activeProject?.isSSHProject ? (activeProject.remotePath || activeProject.path) : activeProject?.path || ''

  const projectGitInfo = useGitStore((state) =>
    activeProjectId && state.gitInfo[activeProjectId]
      ? state.gitInfo[activeProjectId]
      : EMPTY_GIT_INFO
  )

  const selectedFilePath = selectedFile?.path || null
  const selectedFileLabel = selectedFilePath?.split('/').pop() || selectedFilePath?.split('\\').pop() || selectedFilePath

  const changedFiles = projectGitInfo.changedFiles
  const stagedCount = changedFiles.filter((file) => file.staged).length
  const unstagedCount = changedFiles.filter((file) => !file.staged).length

  useEffect(() => {
    if (!activeProjectId || !projectPath) return
    const { watchProject } = useGitStore.getState()
    watchProject(activeProjectId, projectPath)
  }, [activeProjectId, projectPath])

  useEffect(() => {
    setSelectedFile(null)
    setDiffParts(null)
    setDiffError(null)
  }, [activeProjectId])

  const getWidthBounds = useCallback(() => {
    if (typeof window === 'undefined') {
      return { min: 720, max: 1400 }
    }
    const max = Math.max(620, Math.min(1400, window.innerWidth - 72))
    const min = Math.min(720, max)
    return { min, max }
  }, [])

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    const { min, max } = getWidthBounds()
    const preferred = Math.round(window.innerWidth * 0.68)
    setDrawerWidth((prev) => {
      const next = hasResized ? prev : preferred
      return Math.max(min, Math.min(next, max))
    })
  }, [getWidthBounds, hasResized, isOpen])

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    const handleResize = () => {
      const { min, max } = getWidthBounds()
      setDrawerWidth((prev) => Math.max(min, Math.min(prev, max)))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [getWidthBounds, isOpen])

  useEffect(() => {
    if (!isResizing || typeof window === 'undefined') return
    const handleMouseMove = (event: MouseEvent) => {
      const { min, max } = getWidthBounds()
      const nextWidth = window.innerWidth - event.clientX
      setDrawerWidth(Math.max(min, Math.min(nextWidth, max)))
    }
    const handleMouseUp = () => {
      setIsResizing(false)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [getWidthBounds, isResizing])

  const handleRefreshGitInfo = async () => {
    if (!activeProjectId || !projectPath || !window.electron) return
    const { refreshGitInfo } = useGitStore.getState()
    setIsRefreshing(true)
    try {
      await window.electron.git.fetch(projectPath, activeProjectId ?? undefined)
      await refreshGitInfo(activeProjectId, projectPath)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handlePush = async () => {
    if (!window.electron || !projectPath) return
    setIsPushing(true)
    try {
      const result = await window.electron.git.push(projectPath, activeProjectId ?? undefined)
      if (result.success) {
        await handleRefreshGitInfo()
      } else {
        useToastStore.getState().addToast(result.error || 'Git push failed', 'error', 8000)
      }
    } finally {
      setIsPushing(false)
    }
  }

  const handlePull = async () => {
    if (!window.electron || !projectPath) return
    setIsPulling(true)
    try {
      const result = await window.electron.git.pull(projectPath, activeProjectId ?? undefined)
      if (result.success) {
        await handleRefreshGitInfo()
      } else {
        useToastStore.getState().addToast(result.error || 'Git pull failed', 'error', 8000)
      }
    } finally {
      setIsPulling(false)
    }
  }

  const handleStageFile = async (filePath: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!window.electron || !projectPath || !activeProjectId) return
    await window.electron.git.stageFile(projectPath, filePath)
    await handleRefreshGitInfo()
  }

  const handleUnstageFile = async (filePath: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!window.electron || !projectPath || !activeProjectId) return
    await window.electron.git.unstageFile(projectPath, filePath)
    await handleRefreshGitInfo()
  }

  const handleStageAll = async () => {
    if (!window.electron || !projectPath) return
    const unstagedFiles = projectGitInfo.changedFiles.filter(f => !f.staged)
    for (const file of unstagedFiles) {
      await window.electron.git.stageFile(projectPath, file.path)
    }
    await handleRefreshGitInfo()
  }

  const handleUnstageAll = async () => {
    if (!window.electron || !projectPath) return
    const stagedFiles = projectGitInfo.changedFiles.filter(f => f.staged)
    for (const file of stagedFiles) {
      await window.electron.git.unstageFile(projectPath, file.path)
    }
    await handleRefreshGitInfo()
  }

  const handleDiscardFile = async (filePath: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setPendingDiscardFile(filePath)
  }

  const confirmDiscardFile = async (filePath: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!window.electron || !projectPath || !activeProjectId) return
    await window.electron.git.discardFile(projectPath, filePath, activeProjectId)
    setPendingDiscardFile(null)
    await handleRefreshGitInfo()
  }

  const cancelDiscardFile = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setPendingDiscardFile(null)
  }

  const handleDiscardAll = () => {
    setPendingDiscardAll(true)
  }

  const confirmDiscardAll = async () => {
    if (!window.electron || !projectPath || !activeProjectId) return
    const filesToDiscard = projectGitInfo.changedFiles.filter(f => !f.staged)
    for (const file of filesToDiscard) {
      await window.electron.git.discardFile(projectPath, file.path, activeProjectId)
    }
    setPendingDiscardAll(false)
    await handleRefreshGitInfo()
  }

  const cancelDiscardAll = () => {
    setPendingDiscardAll(false)
  }

  const handleCommit = async () => {
    if (!window.electron || !commitMessage.trim() || !projectPath) return

    setIsCommitting(true)
    try {
      const result = await window.electron.git.commit(projectPath, commitMessage.trim())
      if (result.success) {
        setCommitMessage('')
        await handleRefreshGitInfo()
      }
    } finally {
      setIsCommitting(false)
    }
  }

  const loadDiffForFile = useCallback(async (file: ChangedFile) => {
    if (!window.electron || !projectPath || !activeProjectId) return

    setIsDiffLoading(true)
    setDiffError(null)

    try {
      const fullPath = normalizeFilePath(projectPath, file.path)
      const [workingResult, gitResult] = await Promise.all([
        window.electron.fs.readFile(fullPath),
        window.electron.git.getFileContent(projectPath, file.path, activeProjectId),
      ])

      const workingContent = workingResult.success && workingResult.content ? workingResult.content : ''
      const gitContent = gitResult.success && gitResult.content ? gitResult.content : ''

      const parts = diffLines(gitContent, workingContent)
      setDiffParts(parts)
    } catch (error) {
      setDiffError(String(error))
      setDiffParts(null)
    } finally {
      setIsDiffLoading(false)
    }
  }, [activeProjectId, projectPath])

  const handleSelectFile = (file: ChangedFile) => {
    setSelectedFile(file)
    loadDiffForFile(file)
  }

  const renderDiff = useMemo(() => {
    if (!selectedFile) {
      return (
        <div className="min-h-full flex items-center justify-center text-xs text-zinc-500">
          Select a file to view diff
        </div>
      )
    }

    if (isDiffLoading) {
      return (
        <div className="min-h-full flex items-center justify-center text-xs text-zinc-500">
          Loading diff...
        </div>
      )
    }

    if (diffError) {
      return (
        <div className="min-h-full flex items-center justify-center text-xs text-red-400">
          {diffError}
        </div>
      )
    }

    if (!diffParts) {
      return (
        <div className="min-h-full flex items-center justify-center text-xs text-zinc-500">
          Diff unavailable
        </div>
      )
    }

    return (
      <div className="min-h-full font-mono text-xs leading-5">
        {diffParts.map((part, partIndex) => {
          const lines = part.value.split('\n')
          return lines.map((line: string, lineIndex: number) => {
            if (lineIndex === lines.length - 1 && line === '') return null
            const prefix = part.added ? '+' : part.removed ? '-' : ' '
            return (
              <div
                key={`${partIndex}-${lineIndex}`}
                className={cn(
                  'px-3 py-0.5 whitespace-pre-wrap break-words',
                  part.added && 'bg-emerald-500/10 text-emerald-200',
                  part.removed && 'bg-rose-500/10 text-rose-200',
                  !part.added && !part.removed && 'text-zinc-400'
                )}
              >
                  <span className="select-none pr-2 text-zinc-500">{prefix}</span>
                  {line}
                </div>
            )
          })
        })}
      </div>
    )
  }, [selectedFile, isDiffLoading, diffError, diffParts])

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setHasResized(true)
    setIsResizing(true)
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open: boolean) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        className="p-0 max-w-none sm:max-w-none data-[side=right]:sm:max-w-none data-[side=right]:w-auto"
        style={{ width: drawerWidth, maxWidth: drawerWidth }}
      >
        <div
          className={cn(
            'relative h-full bg-zinc-950 text-zinc-100 border-l border-zinc-800/70 flex flex-col',
            'bg-[radial-gradient(900px_500px_at_100%_-10%,rgba(39,39,42,0.35),transparent)]',
            isResizing && 'cursor-col-resize'
          )}
        >
          <div
            className="absolute left-0 top-0 z-20 h-full w-4 cursor-col-resize group"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-label="Resize git drawer"
            aria-orientation="vertical"
          >
            <div
              className={cn(
                'absolute left-1/2 top-0 h-full w-px bg-zinc-800/90 transition-colors',
                isResizing ? 'bg-zinc-500' : 'group-hover:bg-zinc-600'
              )}
            />
            <div className="absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-800/80 bg-zinc-900/80 shadow-sm" />
          </div>
          <div className="flex h-full flex-col pl-3">
            <div className="px-8 py-5 pr-16 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  {activeProjectId && projectPath ? (
                    <BranchSwitcher projectId={activeProjectId} projectPath={projectPath} />
                  ) : (
                    <span className="text-xs text-zinc-500">No branch</span>
                  )}
                  {projectGitInfo.isGitRepo && changedFiles.length > 0 && (
                    <span className="text-[11px] text-zinc-500 shrink-0">
                      {changedFiles.length} changed
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRefreshGitInfo}
                  title="Fetch & refresh"
                  className="h-8 w-8 text-zinc-500 hover:text-zinc-300 shrink-0"
                >
                  <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePull}
                  disabled={isPulling}
                  className="flex-1 h-8 text-[11px] uppercase tracking-[0.15em] gap-1.5"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  {isPulling ? 'Pulling...' : 'Pull'}
                  {projectGitInfo.behind > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-semibold min-w-[18px] h-[18px] px-1">
                      {projectGitInfo.behind}
                    </span>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePush}
                  disabled={isPushing}
                  className="flex-1 h-8 text-[11px] uppercase tracking-[0.15em] gap-1.5"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  {isPushing ? 'Pushing...' : 'Push'}
                  {projectGitInfo.ahead > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold min-w-[18px] h-[18px] px-1">
                      {projectGitInfo.ahead}
                    </span>
                  )}
                </Button>
              </div>
            </div>

            <Separator className="bg-zinc-800/70" />

            {!projectGitInfo.isGitRepo ? (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
                Not a git repository
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex">
                <div className="w-[320px] min-w-[300px] border-r border-zinc-800/70 flex flex-col min-h-0">
                  <div className="px-6 py-5 space-y-4">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span className="uppercase tracking-[0.3em]">Changes</span>
                    <span>{changedFiles.length} files</span>
                  </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStageAll}
                        disabled={unstagedCount === 0}
                        className="flex-1 h-9 text-[11px] uppercase tracking-[0.2em]"
                      >
                        Stage all
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUnstageAll}
                        disabled={stagedCount === 0}
                        className="flex-1 h-9 text-[11px] uppercase tracking-[0.2em]"
                      >
                        Unstage all
                      </Button>
                    </div>
                  </div>

                  <Separator className="bg-zinc-800/70" />

                  <ScrollArea className="flex-1 min-h-0">
                    {changedFiles.length === 0 ? (
                      <div className="text-xs text-zinc-600 px-6 py-5">Working tree clean</div>
                    ) : (
                      <div className="px-3 py-3 space-y-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between px-1 text-[9px] uppercase tracking-[0.25em] text-emerald-300/90">
                            <span>Staged</span>
                            <span className="text-zinc-500">{stagedCount}</span>
                          </div>
                          <ul className="space-y-2">
                            {changedFiles.filter((file) => file.staged).map((file) => {
                              const { Icon, color } = getFileStatusIcon(file.status)
                              const isSelected = file.path === selectedFilePath
                              return (
                                <li key={`${file.path}-staged`}>
                                  <div
                                    className={cn(
                                      'group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-xs transition',
                                      isSelected
                                        ? 'border-zinc-700/80 bg-zinc-900/80 text-zinc-100'
                                        : 'text-zinc-400 hover:border-zinc-800/80 hover:bg-zinc-900/40 hover:text-zinc-200'
                                    )}
                                  >
                                    <button
                                      onClick={() => handleSelectFile(file)}
                                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                    >
                                      <Icon className={cn('w-4 h-4', color)} />
                                      <div className="min-w-0">
                                        <div className="truncate text-[13px] text-zinc-100">
                                          {file.path}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em]">
                                          <span
                                            className={cn(
                                              'rounded-full border px-2 py-0.5',
                                              file.status === 'modified' && 'border-sky-500/30 bg-sky-500/10 text-sky-300/90',
                                              file.status === 'added' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300/90',
                                              file.status === 'deleted' && 'border-rose-500/30 bg-rose-500/10 text-rose-300/90',
                                              file.status === 'untracked' && 'border-zinc-700/60 bg-zinc-900/60 text-zinc-400'
                                            )}
                                          >
                                            {file.status}
                                          </span>
                                        </div>
                                      </div>
                                    </button>
                                    <div className="flex items-center gap-1.5 shrink-0 opacity-0 transition group-hover:opacity-100">
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={(e) => handleUnstageFile(file.path, e)}
                                        className="text-amber-300"
                                        title="Unstage"
                                      >
                                        <Minus className="w-3 h-3" />
                                      </Button>
                                      {pendingDiscardFile === file.path ? (
                                        <div className="flex items-center gap-1 text-[10px]">
                                          <Button
                                            variant="destructive"
                                            size="xs"
                                            onClick={(e) => confirmDiscardFile(file.path, e)}
                                            className="h-6 px-2"
                                          >
                                            Confirm
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            onClick={cancelDiscardFile}
                                            className="h-6 px-2"
                                          >
                                            Cancel
                                          </Button>
                                        </div>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          size="icon-xs"
                                          onClick={(e) => handleDiscardFile(file.path, e)}
                                          className="text-red-300"
                                          title="Discard"
                                        >
                                          <Undo2 className="w-3 h-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </li>
                              )
                            })}
                            {stagedCount === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-600">No staged files</div>
                            )}
                          </ul>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between px-1 text-[9px] uppercase tracking-[0.25em] text-amber-300/90">
                            <span>Unstaged</span>
                            <span className="text-zinc-500">{unstagedCount}</span>
                          </div>
                          <ul className="space-y-2">
                            {changedFiles.filter((file) => !file.staged).map((file) => {
                              const { Icon, color } = getFileStatusIcon(file.status)
                              const isSelected = file.path === selectedFilePath
                              return (
                                <li key={`${file.path}-unstaged`}>
                                  <div
                                    className={cn(
                                      'group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-xs transition',
                                      isSelected
                                        ? 'border-zinc-700/80 bg-zinc-900/80 text-zinc-100'
                                        : 'text-zinc-400 hover:border-zinc-800/80 hover:bg-zinc-900/40 hover:text-zinc-200'
                                    )}
                                  >
                                    <button
                                      onClick={() => handleSelectFile(file)}
                                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                    >
                                      <Icon className={cn('w-4 h-4', color)} />
                                      <div className="min-w-0">
                                        <div className="truncate text-[13px] text-zinc-100">
                                          {file.path}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em]">
                                          <span
                                            className={cn(
                                              'rounded-full border px-2 py-0.5',
                                              file.status === 'modified' && 'border-sky-500/30 bg-sky-500/10 text-sky-300/90',
                                              file.status === 'added' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300/90',
                                              file.status === 'deleted' && 'border-rose-500/30 bg-rose-500/10 text-rose-300/90',
                                              file.status === 'untracked' && 'border-zinc-700/60 bg-zinc-900/60 text-zinc-400'
                                            )}
                                          >
                                            {file.status}
                                          </span>
                                        </div>
                                      </div>
                                    </button>
                                    <div className="flex items-center gap-1.5 shrink-0 opacity-0 transition group-hover:opacity-100">
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={(e) => handleStageFile(file.path, e)}
                                        className="text-emerald-300"
                                        title="Stage"
                                      >
                                        <Plus className="w-3 h-3" />
                                      </Button>
                                      {pendingDiscardFile === file.path ? (
                                        <div className="flex items-center gap-1 text-[10px]">
                                          <Button
                                            variant="destructive"
                                            size="xs"
                                            onClick={(e) => confirmDiscardFile(file.path, e)}
                                            className="h-6 px-2"
                                          >
                                            Confirm
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            onClick={cancelDiscardFile}
                                            className="h-6 px-2"
                                          >
                                            Cancel
                                          </Button>
                                        </div>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          size="icon-xs"
                                          onClick={(e) => handleDiscardFile(file.path, e)}
                                          className="text-red-300"
                                          title="Discard"
                                        >
                                          <Undo2 className="w-3 h-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </li>
                              )
                            })}
                            {unstagedCount === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-600">No unstaged files</div>
                            )}
                          </ul>
                        </div>
                      </div>
                    )}
                  </ScrollArea>

                  <Separator className="bg-zinc-800/70" />

                  <div className="px-6 py-4 space-y-3">
                    <textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message..."
                      className="w-full min-h-[80px] rounded-lg border border-zinc-800/80 bg-zinc-900/70 px-3 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-700"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handleCommit}
                        disabled={!commitMessage.trim() || isCommitting || stagedCount === 0}
                        className="flex-1 h-8 text-[11px] uppercase tracking-[0.15em]"
                      >
                        {isCommitting ? 'Committing...' : `Commit${stagedCount > 0 ? ` (${stagedCount})` : ''}`}
                      </Button>
                      {unstagedCount > 0 && !pendingDiscardAll && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleDiscardAll}
                          className="h-8 px-2.5 text-[11px] text-red-400/80 hover:text-red-300 hover:bg-red-500/10"
                          title="Discard all unstaged changes"
                        >
                          <Undo2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    {pendingDiscardAll && (
                      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                        <span className="flex-1 text-[11px] text-red-300/90">Discard all unstaged?</span>
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={confirmDiscardAll}
                          className="h-6 px-2.5 text-[10px]"
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={cancelDiscardAll}
                          className="h-6 px-2.5 text-[10px]"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="border-b border-zinc-800/70 px-8 py-4">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Diff</div>
                    <div className="mt-2 text-sm text-zinc-200">
                      {selectedFileLabel || 'Select a file to review changes'}
                    </div>
                  </div>
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="px-6 py-4">{renderDiff}</div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
