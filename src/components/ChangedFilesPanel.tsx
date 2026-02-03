import { useState, useCallback, useEffect, useMemo } from 'react'
import { GitBranch, RefreshCw, Plus, Minus, Undo2, FileText, FilePlus, FileMinus, FileQuestion, ArrowUp, ArrowDown } from 'lucide-react'
import { diffLines, type Change } from 'diff'
import { useProjectStore } from '../stores/project-store'
import { useGitStore, type GitInfo } from '../stores/git-store'
import { cn, normalizeFilePath } from '../lib/utils'
import type { ChangedFile } from '../types/electron'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'

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
  const [drawerWidth, setDrawerWidth] = useState(720)
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
      return { min: 640, max: 1200 }
    }
    const max = Math.max(520, Math.min(1200, window.innerWidth - 64))
    const min = Math.min(640, max)
    return { min, max }
  }, [])

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    const { min, max } = getWidthBounds()
    const preferred = Math.round(window.innerWidth * 0.6)
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
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
          Select a file to view diff
        </div>
      )
    }

    if (isDiffLoading) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
          Loading diff...
        </div>
      )
    }

    if (diffError) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-red-400">
          {diffError}
        </div>
      )
    }

    if (!diffParts) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
          Diff unavailable
        </div>
      )
    }

    return (
      <div className="flex-1 overflow-auto font-mono text-xs leading-5">
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
        <div className={cn('relative h-full bg-zinc-950 border-l border-zinc-800 flex flex-col', isResizing && 'cursor-col-resize')}>
          <div
            className="absolute left-0 top-0 z-20 h-full w-3 cursor-col-resize group"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-label="Resize git drawer"
            aria-orientation="vertical"
          >
            <div className={cn('absolute left-1/2 top-0 h-full w-px bg-zinc-800/80 transition-colors', isResizing ? 'bg-zinc-500' : 'group-hover:bg-zinc-600')} />
          </div>
          <div className="flex h-full flex-col pl-2">
            <SheetHeader className="px-5 py-4 pr-14">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <SheetTitle className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
                    Git Workspace
                  </SheetTitle>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-zinc-200">
                      {projectGitInfo.branch || 'No branch'}
                    </span>
                    {projectGitInfo.isGitRepo && (
                      <>
                        <span className="text-zinc-600">·</span>
                        <span>{changedFiles.length} files</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={handleRefreshGitInfo}
                    title="Refresh"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <Badge variant="secondary" className="text-[10px]">
                  Staged {stagedCount}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  Unstaged {unstagedCount}
                </Badge>
                {projectGitInfo.ahead > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    <ArrowUp className="w-3 h-3" />
                    Ahead {projectGitInfo.ahead}
                  </Badge>
                )}
                {projectGitInfo.behind > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    <ArrowDown className="w-3 h-3" />
                    Behind {projectGitInfo.behind}
                  </Badge>
                )}
              </div>
            </SheetHeader>
            <Separator />

            {!projectGitInfo.isGitRepo ? (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
                Not a git repository
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex">
                <div className="w-[260px] border-r border-zinc-800 flex flex-col min-h-0">
                  <div className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="uppercase tracking-[0.2em]">Changes</span>
                      <span>{changedFiles.length} files</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={handleStageAll}
                        disabled={unstagedCount === 0}
                        className="flex-1"
                      >
                        Stage all
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={handleUnstageAll}
                        disabled={stagedCount === 0}
                        className="flex-1"
                      >
                        Unstage all
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <ScrollArea className="flex-1">
                    {changedFiles.length === 0 ? (
                      <div className="text-xs text-zinc-600 px-4 py-4">Working tree clean</div>
                    ) : (
                      <ul className="py-2">
                        {changedFiles.map((file) => {
                          const { Icon, color } = getFileStatusIcon(file.status)
                          const isSelected = file.path === selectedFilePath
                          return (
                            <li key={`${file.path}-${file.staged ? 'staged' : 'unstaged'}`}>
                              <div
                                className={cn(
                                  'flex items-center gap-2 px-4 py-2 text-xs',
                                  isSelected
                                    ? 'bg-zinc-800 text-zinc-100'
                                    : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                                )}
                              >
                                <button
                                  onClick={() => handleSelectFile(file)}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                  <Icon className={cn('w-3.5 h-3.5', color)} />
                                  <span className="truncate">{file.path}</span>
                                  {file.staged && (
                                    <Badge variant="secondary" className="text-[9px]">
                                      staged
                                    </Badge>
                                  )}
                                </button>
                                <div className="flex items-center gap-1 shrink-0">
                                  {!file.staged ? (
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      onClick={(e) => handleStageFile(file.path, e)}
                                      className="text-emerald-400"
                                      title="Stage"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      onClick={(e) => handleUnstageFile(file.path, e)}
                                      className="text-amber-400"
                                      title="Unstage"
                                    >
                                      <Minus className="w-3 h-3" />
                                    </Button>
                                  )}
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
                                      className="text-red-400"
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
                      </ul>
                    )}
                  </ScrollArea>

                  <Separator />

                  <div className="p-4 space-y-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Commit</div>
                    <textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message"
                      className="w-full min-h-[84px] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
                    />
                    <Button
                      onClick={handleCommit}
                      disabled={!commitMessage.trim() || isCommitting}
                      className="w-full text-xs"
                    >
                      {isCommitting ? 'Committing...' : 'Commit'}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={handlePull}
                        disabled={isPulling}
                        className="flex-1"
                      >
                        <ArrowDown className="w-3 h-3" />
                        {isPulling ? 'Pulling...' : 'Pull'}
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={handlePush}
                        disabled={isPushing}
                        className="flex-1"
                      >
                        <ArrowUp className="w-3 h-3" />
                        {isPushing ? 'Pushing...' : 'Push'}
                      </Button>
                    </div>
                    {unstagedCount > 0 && (
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={handleDiscardAll}
                        className="w-full"
                      >
                        <Undo2 className="w-3 h-3" />
                        Discard all
                      </Button>
                    )}
                    {pendingDiscardAll && (
                      <div className="flex items-center gap-2 text-[10px]">
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={confirmDiscardAll}
                          className="flex-1"
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={cancelDiscardAll}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500">
                    {selectedFileLabel || 'Diff'}
                  </div>
                  <ScrollArea className="flex-1">
                    {renderDiff}
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
