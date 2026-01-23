import { useRef, useState, useCallback, useEffect } from 'react'
import { GitBranch, RefreshCw, Check, Plus, Minus, Undo2, FileText, FilePlus, FileMinus, FileQuestion, ArrowUp, ArrowDown, Sparkles, Loader2, XCircle, Folder, Search } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { useGitStore, type GitInfo } from '../stores/git-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { useReviewStore } from '../stores/review-store'
import { FileBrowser } from './FileBrowser'
import { SearchTab } from './SearchTab'
import { cn, normalizeFilePath } from '../lib/utils'
import { generateFileId, generateCacheKey } from '../lib/file-id'
import type { ChangedFile } from '../types/electron'

const MIN_WIDTH = 200
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 350

// Stable empty git info object to prevent infinite render loops
const EMPTY_GIT_INFO: GitInfo = {
  branch: null,
  branches: [],
  isGitRepo: false,
  hasChanges: false,
  ahead: 0,
  behind: 0,
  changedFiles: [],
}

// Helper function to get file status icon and color
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

export function ChangedFilesPanel() {
  const { activeProjectId, projects } = useProjectStore()
  const { openFile, setShowDiff } = useFileViewerStore()

  const activeReviewId = useReviewStore((state) => state.activeReviewId)
  const activeReview = useReviewStore((state) =>
    state.activeReviewId ? state.reviews.get(state.activeReviewId) : null
  )
  const startReview = useReviewStore((state) => state.startReview)
  const setClassifications = useReviewStore((state) => state.setClassifications)
  const setLowRiskFindings = useReviewStore((state) => state.setLowRiskFindings)
  const addHighRiskFindings = useReviewStore((state) => state.addHighRiskFindings)
  const updateHighRiskStatus = useReviewStore((state) => state.updateHighRiskStatus)
  const setVisibility = useReviewStore((state) => state.setVisibility)
  const getCachedFileReview = useReviewStore((state) => state.getCachedFileReview)
  const setCachedFileReview = useReviewStore((state) => state.setCachedFileReview)
  const clearCacheForFiles = useReviewStore((state) => state.clearCacheForFiles)
  const loadCacheFromStorage = useReviewStore((state) => state.loadCacheFromStorage)
  const setReviewStage = useReviewStore((state) => state.setReviewStage)
  const failReview = useReviewStore((state) => state.failReview)
  const cancelReview = useReviewStore((state) => state.cancelReview)

  const [activeTab, setActiveTab] = useState<'files' | 'git' | 'search'>('git') // Default to git tab
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('changed-files-panel-width')
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLElement>(null)

  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [fileMetadata, setFileMetadata] = useState<Map<string, { fileId: string; hash: string; relativePath: string }>>(new Map())

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null
  const projectPath = activeProject?.isSSHProject ? (activeProject.remotePath || activeProject.path) : activeProject?.path || ''

  // Use selector to only subscribe to the active project's git info
  // Use stable EMPTY_GIT_INFO to prevent infinite render loops
  const projectGitInfo = useGitStore((state) =>
    activeProjectId && state.gitInfo[activeProjectId]
      ? state.gitInfo[activeProjectId]
      : EMPTY_GIT_INFO
  )

  // Resizing logic
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing && panelRef.current) {
      const newWidth = panelRef.current.getBoundingClientRect().right - e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
        localStorage.setItem('changed-files-panel-width', String(newWidth))
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

  // Load cache from storage on mount
  useEffect(() => {
    loadCacheFromStorage()
  }, [loadCacheFromStorage])

  // Watch active project for git changes
  useEffect(() => {
    if (!activeProjectId || !projectPath) return

    const { watchProject } = useGitStore.getState()

    // Start watching this project (idempotent - safe to call multiple times)
    watchProject(activeProjectId, projectPath)

    // No cleanup - keep watching even when component unmounts or switches
    // The ProjectHeader manages the overall watch lifecycle
  }, [activeProjectId, projectPath])

  // Listen for review events
  useEffect(() => {
    if (!window.electron) return

    const unsubClassifications = window.electron.review.onClassifications((event) => {
      const existingReview = useReviewStore.getState().reviews.get(event.reviewId)
      const existingClassifications = existingReview?.classifications || []
      const mergedClassifications = [...existingClassifications, ...event.classifications]

      setClassifications(event.reviewId, mergedClassifications)

      event.classifications.forEach((classification: any) => {
        const fileId = classification.fileId || generateFileId(projectPath, classification.file)
        const metadata = Array.from(fileMetadata.values()).find(m => m.fileId === fileId)

        if (metadata) {
          const cacheKey = generateCacheKey(fileId, metadata.hash)
          setCachedFileReview({
            cacheKey,
            fileId,
            file: classification.file,
            contentHash: metadata.hash,
            classification,
            findings: [],
            reviewedAt: Date.now(),
            projectId: projectPath,
          })
        }
      })
    })

    const unsubLowRisk = window.electron.review.onLowRiskFindings((event) => {
      const findingsWithFileId = event.findings.map((finding: any) => ({
        ...finding,
        fileId: finding.fileId || generateFileId(projectPath, finding.file)
      }))

      setLowRiskFindings(event.reviewId, findingsWithFileId)

      const findingsByFileId = new Map<string, any[]>()
      findingsWithFileId.forEach((finding: any) => {
        const existing = findingsByFileId.get(finding.fileId) || []
        existing.push(finding)
        findingsByFileId.set(finding.fileId, existing)
      })

      findingsByFileId.forEach((findings, fileId) => {
        const metadata = Array.from(fileMetadata.values()).find(m => m.fileId === fileId)
        if (metadata) {
          const cacheKey = generateCacheKey(fileId, metadata.hash)
          const existing = getCachedFileReview(fileId, metadata.hash)
          setCachedFileReview({
            cacheKey,
            fileId,
            file: metadata.relativePath,
            contentHash: metadata.hash,
            classification: existing?.classification,
            findings,
            reviewedAt: Date.now(),
            projectId: projectPath,
          })
        }
      })
    })

    const unsubHighRiskStatus = window.electron.review.onHighRiskStatus((event) => {
      updateHighRiskStatus(event.reviewId, event.status)
    })

    const unsubHighRiskFindings = window.electron.review.onHighRiskFindings((event) => {
      const findingsWithFileId = event.findings.map((finding: any) => ({
        ...finding,
        fileId: finding.fileId || generateFileId(projectPath, finding.file)
      }))

      addHighRiskFindings(event.reviewId, findingsWithFileId)

      const findingsByFileId = new Map<string, any[]>()
      findingsWithFileId.forEach((finding: any) => {
        const existing = findingsByFileId.get(finding.fileId) || []
        existing.push(finding)
        findingsByFileId.set(finding.fileId, existing)
      })

      findingsByFileId.forEach((findings, fileId) => {
        const metadata = Array.from(fileMetadata.values()).find(m => m.fileId === fileId)
        if (metadata) {
          const cacheKey = generateCacheKey(fileId, metadata.hash)
          const existing = getCachedFileReview(fileId, metadata.hash)
          setCachedFileReview({
            cacheKey,
            fileId,
            file: metadata.relativePath,
            contentHash: metadata.hash,
            classification: existing?.classification,
            findings,
            reviewedAt: Date.now(),
            projectId: projectPath,
          })
        }
      })
    })

    const unsubFailed = window.electron.review.onFailed((reviewId: string, error: string) => {
      failReview(reviewId, error)
      setIsReviewing(false)
    })

    return () => {
      unsubClassifications()
      unsubLowRisk()
      unsubHighRiskStatus()
      unsubHighRiskFindings()
      unsubFailed()
    }
  }, [setClassifications, setLowRiskFindings, updateHighRiskStatus, addHighRiskFindings, failReview, fileMetadata, projectPath, getCachedFileReview, setCachedFileReview])

  // Watch for review completion
  useEffect(() => {
    if (activeReview && (activeReview.status === 'completed' || activeReview.status === 'failed' || activeReview.status === 'cancelled')) {
      setIsReviewing(false)
    }
  }, [activeReview?.status])

  const handleRefreshGitInfo = async () => {
    if (!activeProjectId || !projectPath || !window.electron) return
    const { refreshGitInfo } = useGitStore.getState()
    setIsRefreshing(true)
    try {
      await window.electron.git.fetch(projectPath, activeProjectId)
      await refreshGitInfo(activeProjectId, projectPath)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handlePush = async () => {
    if (!window.electron || !projectPath) return
    setIsPushing(true)
    try {
      const result = await window.electron.git.push(projectPath, activeProjectId)
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
      const result = await window.electron.git.pull(projectPath, activeProjectId)
      if (result.success) {
        await handleRefreshGitInfo()
      }
    } finally {
      setIsPulling(false)
    }
  }

  const handleOpenChangedFile = async (filePath: string) => {
    if (!window.electron || !projectPath) return

    const fullPath = normalizeFilePath(projectPath, filePath)
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath

    const result = await window.electron.fs.readFile(fullPath)

    if (result.success && result.content !== undefined) {
      openFile(fullPath, fileName, result.content, projectPath, activeProjectId)
      setShowDiff(true)
    }
  }

  const handleStageFile = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron || !projectPath || !activeProjectId) return
    await window.electron.git.stageFile(projectPath, filePath)
    await handleRefreshGitInfo()
  }

  const handleUnstageFile = async (filePath: string, e: React.MouseEvent) => {
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

  const handleStartReview = async () => {
    if (!window.electron || projectGitInfo.changedFiles.length === 0 || !projectPath) return

    setIsReviewing(true)

    const filesToReview = projectGitInfo.changedFiles.map(f => f.path)
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const hashResult = await window.electron.review.generateFileHashes(projectPath, filesToReview)
    if (!hashResult.success || !hashResult.hashes) {
      setIsReviewing(false)
      return
    }

    const fileHashes = hashResult.hashes
    const newMetadata = new Map<string, { fileId: string; hash: string; relativePath: string }>()
    const fileIdList: string[] = []

    for (const file of filesToReview) {
      const hash = fileHashes[file]
      if (!hash) continue

      const fileId = generateFileId(projectPath, file)
      newMetadata.set(fileId, { fileId, hash, relativePath: file })
      fileIdList.push(fileId)
    }

    if (activeReview && activeReview.status === 'completed') {
      clearCacheForFiles(fileIdList)
    }

    setFileMetadata(newMetadata)

    const cachedFiles: string[] = []
    const uncachedFiles: string[] = []
    const cachedClassifications: any[] = []
    const cachedFindings: any[] = []

    for (const [fileId, metadata] of newMetadata.entries()) {
      const cached = getCachedFileReview(fileId, metadata.hash)
      if (cached) {
        cachedFiles.push(metadata.relativePath)
        if (cached.classification) {
          cachedClassifications.push({ ...cached.classification, fileId })
        }
        const findingsWithCacheFlag = cached.findings.map(f => ({
          ...f,
          isCached: true,
          fileId: f.fileId || fileId
        }))
        cachedFindings.push(...findingsWithCacheFlag)
      } else {
        uncachedFiles.push(metadata.relativePath)
      }
    }

    startReview(projectPath, filesToReview, reviewId)
    setVisibility(true)

    if (uncachedFiles.length === 0) {
      setClassifications(reviewId, cachedClassifications)
      const lowRiskClassifications = cachedClassifications.filter(c => c.riskLevel === 'low-risk')
      const highRiskClassifications = cachedClassifications.filter(c => c.riskLevel === 'high-risk')
      const lowRiskFindings = cachedFindings.filter(f =>
        lowRiskClassifications.some(c => c.file === f.file)
      )
      const highRiskFindings = cachedFindings.filter(f =>
        highRiskClassifications.some(c => c.file === f.file)
      )
      setLowRiskFindings(reviewId, lowRiskFindings)
      addHighRiskFindings(reviewId, highRiskFindings)
      if (lowRiskFindings.length > 0) {
        setReviewStage(reviewId, 'reviewing-low-risk')
      } else if (highRiskFindings.length > 0) {
        setReviewStage(reviewId, 'reviewing-high-risk')
      } else {
        setReviewStage(reviewId, 'completed')
      }
      setIsReviewing(false)
      return
    }

    const result = await window.electron.review.start(projectPath, uncachedFiles, reviewId)
    if (!result.success) {
      setIsReviewing(false)
    }
  }

  const handleCancelReview = async () => {
    if (!activeReviewId) return
    if (window.electron) {
      await window.electron.review.cancel(activeReviewId)
    }
    cancelReview(activeReviewId)
    setIsReviewing(false)
  }

  // Group files by staged/unstaged
  const stagedFiles = projectGitInfo.changedFiles.filter(f => f.staged)
  const unstagedFiles = projectGitInfo.changedFiles.filter(f => !f.staged)

  // File rendering component
  const FileItem = ({ file, isStaged }: { file: ChangedFile; isStaged: boolean }) => {
    const { Icon, color } = getFileStatusIcon(file.status)
    const isDeleted = file.status === 'deleted'

    return (
      <div className="flex items-center gap-1 py-1 text-xs group">
        <button
          onClick={() => !isDeleted && handleOpenChangedFile(file.path)}
          className={cn(
            'flex items-center gap-2 flex-1 min-w-0 text-left',
            isDeleted ? 'text-zinc-500' : 'text-zinc-300 hover:text-white'
          )}
          disabled={isDeleted}
        >
          <Icon className={cn('w-3 h-3 flex-shrink-0', color)} />
          <span className={cn('truncate', isDeleted && 'line-through')} title={file.path}>
            {file.path}
          </span>
        </button>
        <div className="flex items-center gap-0.5">
          {isStaged ? (
            <button
              onClick={(e) => handleUnstageFile(file.path, e)}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-yellow-400"
              title="Unstage"
            >
              <Minus className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={(e) => handleStageFile(file.path, e)}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-green-400"
              title="Stage"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Don't show panel if no project selected
  if (!activeProject) {
    return null
  }

  return (
    <aside
      ref={panelRef}
      style={{ width }}
      className={`flex-shrink-0 bg-zinc-900/50 border-l border-zinc-800 flex flex-col relative z-20 ${isResizing ? 'select-none' : ''}`}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={startResizing}
        className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors ${isResizing ? 'bg-blue-500' : ''}`}
      />

      {/* Tabs */}
      <div className="flex items-center border-b border-zinc-800">
        <button
          onClick={() => setActiveTab('files')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors relative',
            activeTab === 'files'
              ? 'text-blue-400 border-b-2 border-blue-400 -mb-[1px]'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
          )}
        >
          <Folder className="w-3.5 h-3.5" />
          <span>Files</span>
        </button>
        <button
          onClick={() => setActiveTab('git')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors relative',
            activeTab === 'git'
              ? 'text-blue-400 border-b-2 border-blue-400 -mb-[1px]'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
          )}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>Git</span>
          {projectGitInfo.changedFiles.length > 0 && (
            <span
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-semibold rounded-full',
                activeTab === 'git'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-gray-700/50 text-gray-400'
              )}
            >
              {projectGitInfo.changedFiles.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors relative',
            activeTab === 'search'
              ? 'text-blue-400 border-b-2 border-blue-400 -mb-[1px]'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
          )}
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search</span>
        </button>
      </div>

      {/* Git Tab Header - only show when git tab is active */}
      {activeTab === 'git' && projectGitInfo.isGitRepo && (
        <div className="p-3 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-zinc-300">Changed Files</h2>
            <div className="flex items-center gap-1">
            <button
              onClick={handleRefreshGitInfo}
              disabled={isRefreshing || isPushing || isPulling}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
            </button>
            <button
              onClick={handlePull}
              disabled={isPulling || isRefreshing}
              className="relative p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-blue-400 disabled:opacity-50"
              title={`Pull${projectGitInfo.behind > 0 ? ` (${projectGitInfo.behind} behind)` : ''}`}
            >
              <ArrowDown className="w-3.5 h-3.5" />
              {projectGitInfo.behind > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[12px] h-[12px] px-0.5 text-[8px] font-medium bg-blue-500 text-white rounded-full">
                  {projectGitInfo.behind}
                </span>
              )}
            </button>
            <button
              onClick={handlePush}
              disabled={isPushing || isRefreshing}
              className="relative p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-green-400 disabled:opacity-50"
              title={`Push${projectGitInfo.ahead > 0 ? ` (${projectGitInfo.ahead} ahead)` : ''}`}
            >
              <ArrowUp className="w-3.5 h-3.5" />
              {projectGitInfo.ahead > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[12px] h-[12px] px-0.5 text-[8px] font-medium bg-green-500 text-white rounded-full">
                  {projectGitInfo.ahead}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Branch info */}
        {projectGitInfo.branch && (
          <div className={cn(
            'flex items-center gap-2 text-xs px-2 py-1.5 rounded',
            projectGitInfo.hasChanges
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-zinc-700/50 text-zinc-400'
          )}>
            <GitBranch className="w-3.5 h-3.5" />
            <span>{projectGitInfo.branch}</span>
            {projectGitInfo.hasChanges && <span className="text-amber-400">•</span>}
          </div>
        )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'files' && (
          <FileBrowser projectId={activeProject.id} rootPath={projectPath} maxDepth={4} />
        )}

        {activeTab === 'search' && (
          <SearchTab projectId={activeProject.id} projectPath={projectPath} />
        )}

        {activeTab === 'git' && !projectGitInfo.isGitRepo && (
          <p className="text-xs text-zinc-600 text-center py-4">Not a git repository</p>
        )}

        {activeTab === 'git' && projectGitInfo.isGitRepo && (projectGitInfo.changedFiles.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-4">No changes</p>
        ) : (
          <>
            {/* Review Button */}
            <div className="mb-3 flex gap-2">
              {activeReview && activeReview.status === 'completed' ? (
                <>
                  <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs rounded bg-green-600/20 text-green-400 border border-green-600/30">
                    <Check className="w-3.5 h-3.5" />
                    Review Complete
                  </div>
                  <button
                    onClick={handleStartReview}
                    className="px-3 py-2 text-xs rounded bg-purple-600 hover:bg-purple-500 text-white transition-colors flex items-center gap-1.5"
                    title="Start a fresh review (clears cache)"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Again
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleStartReview}
                    disabled={isReviewing || projectGitInfo.changedFiles.length === 0}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs rounded transition-colors',
                      isReviewing
                        ? 'bg-purple-600/50 text-purple-300 cursor-wait'
                        : 'bg-purple-600 hover:bg-purple-500 text-white'
                    )}
                  >
                    {isReviewing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Reviewing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Review ({projectGitInfo.changedFiles.length})
                      </>
                    )}
                  </button>
                  {isReviewing && activeReviewId && (
                    <button
                      onClick={handleCancelReview}
                      className="px-2 py-2 text-xs rounded bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/30 transition-colors"
                      title="Cancel review"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
              {activeReviewId && activeReview && (
                <button
                  onClick={() => setVisibility(true)}
                  className="px-2 py-2 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                  title="View review results"
                >
                  {(() => {
                    const review = activeReview
                    if (review?.status === 'completed') {
                      const count = review.findings.length
                      return count > 0 ? `${count}` : '✓'
                    }
                    if (review?.status === 'failed') return '!'
                    if (review?.status === 'running') return '...'
                    return '?'
                  })()}
                </button>
              )}
            </div>

            {/* Staged Changes */}
            {stagedFiles.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Staged ({stagedFiles.length})
                  </span>
                  <button
                    onClick={handleUnstageAll}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase"
                  >
                    Unstage All
                  </button>
                </div>
                <div className="space-y-0.5">
                  {stagedFiles.map(file => (
                    <FileItem key={`staged-${file.path}`} file={file} isStaged={true} />
                  ))}
                </div>
              </div>
            )}

            {/* Unstaged Changes */}
            {unstagedFiles.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Changes ({unstagedFiles.length})
                  </span>
                  <button
                    onClick={handleStageAll}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase"
                  >
                    Stage All
                  </button>
                </div>
                <div className="space-y-0.5">
                  {unstagedFiles.map(file => (
                    <FileItem key={`unstaged-${file.path}`} file={file} isStaged={false} />
                  ))}
                </div>
              </div>
            )}

            {/* Commit UI */}
            {stagedFiles.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] text-zinc-500 uppercase mb-2">
                  Commit Message
                </div>
                <textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Enter commit message..."
                  className="w-full px-2 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 resize-none"
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handleCommit()
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-zinc-600">
                    {stagedFiles.length} file(s) staged
                  </span>
                  <button
                    onClick={handleCommit}
                    disabled={!commitMessage.trim() || isCommitting}
                    className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded transition-colors"
                  >
                    {isCommitting ? 'Committing...' : 'Commit'}
                  </button>
                </div>
              </div>
            )}
          </>
        ))}
      </div>
    </aside>
  )
}
