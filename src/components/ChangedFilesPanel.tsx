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

  return (
    <Sheet open={isOpen} onOpenChange={(open: boolean) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-[520px] p-0">
        <div className="h-full bg-zinc-950 border-l border-zinc-800 flex flex-col">
          <SheetHeader className="px-4 py-3">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2 text-sm">
                <GitBranch className="w-4 h-4 text-zinc-400" />
                Git Changes
              </SheetTitle>
              {projectGitInfo.branch && (
                <Badge variant="secondary" className="text-[10px]">
                  {projectGitInfo.branch}
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
              <div className="w-[220px] border-r border-zinc-800 flex flex-col min-h-0">
                <div className="px-3 py-3">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{changedFiles.length} files</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleRefreshGitInfo}
                      title="Refresh"
                    >
                      <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStageAll}
                      disabled={unstagedCount === 0}
                      className="flex-1 text-[10px]"
                    >
                      Stage All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnstageAll}
                      disabled={stagedCount === 0}
                      className="flex-1 text-[10px]"
                    >
                      Unstage All
                    </Button>
                  </div>
                </div>

                <Separator />

                <ScrollArea className="flex-1">
                  {changedFiles.length === 0 ? (
                    <div className="text-xs text-zinc-600 px-3 py-4">Working tree clean</div>
                  ) : (
                    <ul className="py-2">
                      {changedFiles.map((file) => {
                        const { Icon, color } = getFileStatusIcon(file.status)
                        const isSelected = file.path === selectedFilePath
                        return (
                          <li key={`${file.path}-${file.staged ? 'staged' : 'unstaged'}`}>
                            <button
                              onClick={() => handleSelectFile(file)}
                              className={cn(
                                'w-full flex items-center gap-2 px-3 py-2 text-xs text-left',
                                isSelected
                                  ? 'bg-zinc-800 text-zinc-100'
                                  : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                              )}
                            >
                              <Icon className={cn('w-3.5 h-3.5', color)} />
                              <span className="truncate flex-1">{file.path}</span>
                              {file.staged && (
                                <Badge variant="secondary" className="text-[9px]">
                                  staged
                                </Badge>
                              )}
                            </button>
                            <div className="px-3 pb-2 flex items-center gap-1">
                              {!file.staged ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => handleStageFile(file.path, e)}
                                  className="h-6 w-6 text-emerald-400"
                                  title="Stage"
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => handleUnstageFile(file.path, e)}
                                  className="h-6 w-6 text-amber-400"
                                  title="Unstage"
                                >
                                  <Minus className="w-3 h-3" />
                                </Button>
                              )}
                              {pendingDiscardFile === file.path ? (
                                <div className="flex items-center gap-1 text-[10px]">
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={(e) => confirmDiscardFile(file.path, e)}
                                    className="h-6 px-2"
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={cancelDiscardFile}
                                    className="h-6 px-2"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => handleDiscardFile(file.path, e)}
                                  className="h-6 w-6 text-red-400"
                                  title="Discard"
                                >
                                  <Undo2 className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </ScrollArea>

                <Separator />

                <div className="p-3 space-y-2">
                  <textarea
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message"
                    className="w-full min-h-[72px] rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
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
                      size="sm"
                      onClick={handlePull}
                      disabled={isPulling}
                      className="flex-1 text-xs"
                    >
                      <ArrowDown className="w-3 h-3" />
                      {isPulling ? 'Pulling...' : 'Pull'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePush}
                      disabled={isPushing}
                      className="flex-1 text-xs"
                    >
                      <ArrowUp className="w-3 h-3" />
                      {isPushing ? 'Pushing...' : 'Push'}
                    </Button>
                  </div>
                  {unstagedCount > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDiscardAll}
                      className="w-full text-xs"
                    >
                      <Undo2 className="w-3 h-3" />
                      Discard All
                    </Button>
                  )}
                  {pendingDiscardAll && (
                    <div className="flex items-center gap-2 text-[10px]">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={confirmDiscardAll}
                        className="flex-1"
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
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
      </SheetContent>
    </Sheet>
  )
}
