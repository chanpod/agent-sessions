import { GitBranch, RefreshCw, Check, Plus, Minus, Undo2, FileText, FilePlus, FileMinus, FileQuestion, Cloud, ArrowUp, ArrowDown, Search, Sparkles, Loader2, XCircle } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ChangedFile } from '../types/electron'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { useReviewStore } from '../stores/review-store'
import { cn, normalizeFilePath } from '../lib/utils'
import { generateFileId, generateCacheKey } from '../lib/file-id'

interface GitTabProps {
  projectPath: string
  gitBranch: string | null
  gitHasChanges: boolean
  changedFiles: ChangedFile[]
  ahead: number
  behind: number
  onRefreshGitInfo: () => Promise<void>
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

export function GitTab({ projectPath, gitBranch, gitHasChanges, changedFiles, ahead, behind, onRefreshGitInfo }: GitTabProps) {
  const { openFile, setShowDiff } = useFileViewerStore()

  // Use selectors to properly track changes
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

  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [localBranches, setLocalBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [branchFilter, setBranchFilter] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null)
  // NEW: FileId-based metadata tracking (replaces currentFileHashes)
  const [fileMetadata, setFileMetadata] = useState<Map<string, { fileId: string; hash: string; relativePath: string }>>(new Map())

  const branchBtnRef = useRef<HTMLButtonElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const [branchMenuPos, setBranchMenuPos] = useState<{ top: number; left: number } | null>(null)

  // Load cache from storage on mount
  useEffect(() => {
    loadCacheFromStorage()
  }, [loadCacheFromStorage])

  // Fetch branches when branch menu opens
  useEffect(() => {
    if (!showBranchMenu || !window.electron || !gitBranch) return

    const fetchBranches = async () => {
      const result = await window.electron!.git.listBranches(projectPath)
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
    }

    fetchBranches()
  }, [showBranchMenu, projectPath, gitBranch])

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        branchMenuRef.current &&
        !branchMenuRef.current.contains(event.target as Node) &&
        branchBtnRef.current &&
        !branchBtnRef.current.contains(event.target as Node)
      ) {
        setShowBranchMenu(false)
        setBranchFilter('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Listen for review events (multi-stage review)
  useEffect(() => {
    if (!window.electron) return

    const unsubClassifications = window.electron.review.onClassifications((event) => {
      console.log('[GitTab] Classifications received:', event)

      // IMPORTANT: Merge new classifications with existing cached ones
      const existingReview = useReviewStore.getState().reviews.get(event.reviewId)
      const existingClassifications = existingReview?.classifications || []
      const mergedClassifications = [...existingClassifications, ...event.classifications]

      setClassifications(event.reviewId, mergedClassifications)

      // Cache each new classification using FileId
      event.classifications.forEach((classification: any) => {
        // Use fileId from classification or generate from file path
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
            findings: [], // Findings will be added later
            reviewedAt: Date.now(),
            projectId: projectPath,
          })
        }
      })
    })

    const unsubLowRisk = window.electron.review.onLowRiskFindings((event) => {
      console.log('[GitTab] Low-risk findings received:', event)

      // Ensure all findings have fileId set
      const findingsWithFileId = event.findings.map((finding: any) => ({
        ...finding,
        fileId: finding.fileId || generateFileId(projectPath, finding.file)
      }))

      setLowRiskFindings(event.reviewId, findingsWithFileId)

      // Cache findings grouped by FileId (NOT by file path)
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
          // Get existing cache to preserve classification
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
      console.log('[GitTab] High-risk status:', event)
      updateHighRiskStatus(event.reviewId, event.status)
    })

    const unsubHighRiskFindings = window.electron.review.onHighRiskFindings((event) => {
      console.log('[GitTab] High-risk findings:', event)

      // Ensure all findings have fileId set
      const findingsWithFileId = event.findings.map((finding: any) => ({
        ...finding,
        fileId: finding.fileId || generateFileId(projectPath, finding.file)
      }))

      addHighRiskFindings(event.reviewId, findingsWithFileId)

      // Cache findings grouped by FileId (NOT by file path)
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
          // Get existing cache to preserve classification
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
      console.error('[GitTab] Review failed:', reviewId, error)
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

  // Watch for review completion to reset isReviewing state
  useEffect(() => {
    if (activeReview && (activeReview.status === 'completed' || activeReview.status === 'failed' || activeReview.status === 'cancelled')) {
      setIsReviewing(false)
    }
  }, [activeReview?.status])

  const handleStartReview = async () => {
    if (!window.electron || changedFiles.length === 0) return

    setIsReviewing(true)

    // Get files to review (all changed files)
    const filesToReview = changedFiles.map(f => f.path)

    // Generate reviewId on frontend
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    console.log('[GitTab] Starting review with FileId-based cache checking for', filesToReview.length, 'files')

    // Step 1: Generate hashes for all files
    const hashResult = await window.electron.review.generateFileHashes(projectPath, filesToReview)
    if (!hashResult.success || !hashResult.hashes) {
      console.error('[GitTab] Failed to generate file hashes:', hashResult.error)
      setIsReviewing(false)
      return
    }

    const fileHashes = hashResult.hashes
    console.log('[GitTab] Generated hashes for', Object.keys(fileHashes).length, 'files')

    // Step 2: Build FileId-based metadata for all files
    const newMetadata = new Map<string, { fileId: string; hash: string; relativePath: string }>()
    const fileIdList: string[] = []

    for (const file of filesToReview) {
      const hash = fileHashes[file]
      if (!hash) continue

      const fileId = generateFileId(projectPath, file)
      newMetadata.set(fileId, { fileId, hash, relativePath: file })
      fileIdList.push(fileId)
    }

    // If "Review Again", clear cache for all FileIds (clears ALL versions!)
    if (activeReview && activeReview.status === 'completed') {
      console.log('[GitTab] Review Again - clearing ALL cached versions for', fileIdList.length, 'files')
      clearCacheForFiles(fileIdList)
    }

    // Store metadata for event listeners
    setFileMetadata(newMetadata)
    setCurrentReviewId(reviewId)

    // Step 3: Check cache for each file using FileId
    const cachedFiles: string[] = []
    const uncachedFiles: string[] = []
    const cachedClassifications: any[] = []
    const cachedFindings: any[] = []

    for (const [fileId, metadata] of newMetadata.entries()) {
      const cached = getCachedFileReview(fileId, metadata.hash)
      if (cached) {
        console.log(`[GitTab] Cache HIT for ${fileId} (hash: ${metadata.hash.slice(0, 8)}...)`)
        cachedFiles.push(metadata.relativePath)

        // Collect cached classification (ensure it has fileId)
        if (cached.classification) {
          cachedClassifications.push({
            ...cached.classification,
            fileId
          })
        }

        // Collect cached findings (mark as cached, ensure fileId is set)
        const findingsWithCacheFlag = cached.findings.map(f => ({
          ...f,
          isCached: true,
          fileId: f.fileId || fileId // Ensure fileId is always present
        }))
        cachedFindings.push(...findingsWithCacheFlag)
      } else {
        console.log(`[GitTab] Cache MISS for ${fileId} (hash: ${metadata.hash.slice(0, 8)}...)`)
        uncachedFiles.push(metadata.relativePath)
      }
    }

    console.log(`[GitTab] Cache summary: ${cachedFiles.length} cached, ${uncachedFiles.length} need review`)

    // Start review in store FIRST (this opens the dialog immediately)
    startReview(projectPath, filesToReview, reviewId)

    // Open review panel immediately
    setVisibility(true)

    // Step 3: If all files are cached, skip classification and go straight to results
    if (uncachedFiles.length === 0) {
      console.log('[GitTab] All files cached! Showing cached results')

      // Immediately set classifications from cache
      setClassifications(reviewId, cachedClassifications)

      // Skip to results stage with cached findings
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

      // Move to appropriate stage
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

    // Step 4: Only review uncached files
    console.log('[GitTab] Reviewing uncached files:', uncachedFiles)
    const result = await window.electron.review.start(projectPath, uncachedFiles, reviewId)

    if (!result.success) {
      console.error('Failed to start review:', result.error)
      setIsReviewing(false)
      // TODO: Show error in UI
      return
    }

    // Step 5: Merge cached classifications with new ones when they arrive
    // This will be handled by the event listeners below
    console.log('[GitTab] Review started, will merge cached data with new results')
  }

  const handleCancelReview = async () => {
    if (!activeReviewId) return

    console.log('[GitTab] Cancelling review:', activeReviewId)

    // Cancel on backend
    if (window.electron) {
      await window.electron.review.cancel(activeReviewId)
    }

    // Cancel on frontend
    cancelReview(activeReviewId)
    setIsReviewing(false)
  }

  const handleBranchClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newShowState = !showBranchMenu
    setShowBranchMenu(newShowState)

    if (newShowState && branchBtnRef.current) {
      const rect = branchBtnRef.current.getBoundingClientRect()
      setBranchMenuPos({ top: rect.bottom + 4, left: rect.left })
    } else {
      // Clear filter when closing menu
      setBranchFilter('')
    }
  }

  const handleFetch = async () => {
    if (!window.electron) return
    setIsFetching(true)
    try {
      await window.electron.git.fetch(projectPath)
      const result = await window.electron.git.listBranches(projectPath)
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
    } finally {
      setIsFetching(false)
    }
  }

  const handleCheckout = async (branch: string) => {
    if (!window.electron) return
    setIsCheckingOut(true)
    try {
      const result = await window.electron.git.checkout(projectPath, branch)
      if (result.success) {
        await onRefreshGitInfo()
        setShowBranchMenu(false)
      } else {
        console.error('Checkout failed:', result.error)
      }
    } finally {
      setIsCheckingOut(false)
    }
  }

  const handleOpenChangedFile = async (filePath: string) => {
    console.log('[GitTab] Opening file:', filePath)
    console.log('[GitTab] window.electron available:', !!window.electron)

    if (!window.electron) {
      console.error('[GitTab] window.electron is not available!')
      return
    }

    const fullPath = normalizeFilePath(projectPath, filePath)
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath

    console.log('[GitTab] Reading file from:', fullPath)
    const result = await window.electron.fs.readFile(fullPath)
    console.log('[GitTab] Read result:', result)

    if (result.success && result.content !== undefined) {
      openFile(fullPath, fileName, result.content, projectPath)
      // Enable diff view to show changes compared to git HEAD
      setShowDiff(true)
    } else {
      console.error('[GitTab] Failed to read file:', result.error)
    }
  }

  const handleStageFile = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron) return
    await window.electron.git.stageFile(projectPath, filePath)
    await onRefreshGitInfo()
  }

  const handleUnstageFile = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.electron) return
    await window.electron.git.unstageFile(projectPath, filePath)
    await onRefreshGitInfo()
  }

  const handleStageAll = async () => {
    if (!window.electron) return
    const unstagedFiles = changedFiles.filter(f => !f.staged)
    for (const file of unstagedFiles) {
      await window.electron.git.stageFile(projectPath, file.path)
    }
    await onRefreshGitInfo()
  }

  const handleUnstageAll = async () => {
    if (!window.electron) return
    const stagedFiles = changedFiles.filter(f => f.staged)
    for (const file of stagedFiles) {
      await window.electron.git.unstageFile(projectPath, file.path)
    }
    await onRefreshGitInfo()
  }

  const handleDiscardFile = async (filePath: string) => {
    if (!window.electron) return
    await window.electron.git.discardFile(projectPath, filePath)
    setConfirmDiscard(null)
    await onRefreshGitInfo()
  }

  const handleCommit = async () => {
    if (!window.electron || !commitMessage.trim()) return

    setIsCommitting(true)
    try {
      const result = await window.electron.git.commit(projectPath, commitMessage.trim())
      if (result.success) {
        setCommitMessage('')
        await onRefreshGitInfo()
      } else {
        console.error('Commit failed:', result.error)
      }
    } finally {
      setIsCommitting(false)
    }
  }

  const handlePush = async () => {
    if (!window.electron) return
    setIsPushing(true)
    try {
      const result = await window.electron.git.push(projectPath)
      if (result.success) {
        await onRefreshGitInfo()
      } else {
        console.error('Push failed:', result.error)
      }
    } finally {
      setIsPushing(false)
    }
  }

  const handlePull = async () => {
    if (!window.electron) return
    setIsPulling(true)
    try {
      const result = await window.electron.git.pull(projectPath)
      if (result.success) {
        await onRefreshGitInfo()
      } else {
        console.error('Pull failed:', result.error)
      }
    } finally {
      setIsPulling(false)
    }
  }

  const handleRefresh = async () => {
    if (!window.electron) return
    setIsRefreshing(true)
    try {
      // Fetch from remote to update refs without merging
      await window.electron.git.fetch(projectPath)
      await onRefreshGitInfo()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Filter branches based on search input
  const filterText = branchFilter.toLowerCase().trim()
  const filteredLocalBranches = filterText
    ? localBranches.filter(b => b.toLowerCase().includes(filterText))
    : localBranches
  const filteredRemoteBranches = filterText
    ? remoteBranches.filter(b => b.toLowerCase().includes(filterText))
    : remoteBranches

  // Group files by staged/unstaged
  const stagedFiles = changedFiles.filter(f => f.staged)
  const unstagedFiles = changedFiles.filter(f => !f.staged)

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
            <>
              <button
                onClick={(e) => handleStageFile(file.path, e)}
                className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-green-400"
                title="Stage"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDiscard(file.path) }}
                className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400"
                title={isDeleted ? 'Restore file' : 'Discard changes'}
              >
                <Undo2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Branch Section */}
      <div>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Branch
          </span>
        </div>
        {gitBranch ? (
          <div className="px-2 py-1">
            <div className="flex items-center gap-1">
              <button
                ref={branchBtnRef}
                onClick={handleBranchClick}
                className={cn(
                  'flex items-center gap-2 text-sm px-2 py-1.5 rounded transition-colors flex-1',
                  gitHasChanges
                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                    : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700'
                )}
              >
                <GitBranch className="w-4 h-4" />
                <span className="flex-1 text-left">{gitBranch}</span>
                {gitHasChanges && <span className="text-amber-400">•</span>}
              </button>

              <button
                onClick={handleRefresh}
                disabled={isRefreshing || isPushing || isPulling}
                className="p-1.5 rounded bg-zinc-700/50 hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Refresh (Fetch from remote)"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
              </button>

              <button
                onClick={handlePull}
                disabled={isPulling || isRefreshing}
                className="relative p-1.5 rounded bg-zinc-700/50 hover:bg-zinc-700 text-zinc-400 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={`Pull from remote${behind > 0 ? ` (${behind} commit${behind !== 1 ? 's' : ''} behind)` : ''}`}
              >
                <ArrowDown className="w-3.5 h-3.5" />
                {behind > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 text-[9px] font-medium bg-blue-500 text-white rounded-full">
                    {behind}
                  </span>
                )}
              </button>

              <button
                onClick={handlePush}
                disabled={isPushing || isRefreshing}
                className="relative p-1.5 rounded bg-zinc-700/50 hover:bg-zinc-700 text-zinc-400 hover:text-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={`Push to remote${ahead > 0 ? ` (${ahead} commit${ahead !== 1 ? 's' : ''} ahead)` : ''}`}
              >
                <ArrowUp className="w-3.5 h-3.5" />
                {ahead > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 text-[9px] font-medium bg-green-500 text-white rounded-full">
                    {ahead}
                  </span>
                )}
              </button>
            </div>

            {showBranchMenu && branchMenuPos && createPortal(
              <div
                ref={branchMenuRef}
                className="fixed py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg min-w-[200px] max-h-[400px] overflow-y-auto"
                style={{ top: branchMenuPos.top, left: branchMenuPos.left, zIndex: 9999 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={handleFetch}
                  disabled={isFetching}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left border-b border-zinc-700 mb-1"
                >
                  <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
                  {isFetching ? 'Fetching...' : 'Fetch from remote'}
                </button>

                {/* Filter Input */}
                <div className="px-2 py-1.5 border-b border-zinc-700">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
                    <input
                      type="text"
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                      placeholder="Filter branches..."
                      className="w-full pl-7 pr-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                      autoFocus
                    />
                  </div>
                </div>

                {filteredLocalBranches.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">
                      Local branches
                    </div>
                    {filteredLocalBranches.map((branch) => (
                      <button
                        key={branch}
                        onClick={() => handleCheckout(branch)}
                        disabled={isCheckingOut || branch === gitBranch}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                          branch === gitBranch
                            ? 'bg-zinc-700 text-white'
                            : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                        )}
                      >
                        <GitBranch className="w-3 h-3" />
                        <span className="truncate">{branch}</span>
                        {branch === gitBranch && <Check className="w-3 h-3 ml-auto" />}
                      </button>
                    ))}
                  </>
                )}

                {filteredRemoteBranches.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase border-t border-zinc-700 mt-1 pt-2">
                      Remote branches
                    </div>
                    {filteredRemoteBranches.map((branch) => {
                      const hasLocal = localBranches.includes(branch)
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

                {filteredLocalBranches.length === 0 && filteredRemoteBranches.length === 0 && (
                  <div className="px-3 py-2 text-xs text-zinc-500">
                    {localBranches.length === 0 && remoteBranches.length === 0
                      ? 'No branches found'
                      : 'No branches match filter'}
                  </div>
                )}
              </div>,
              document.body
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-600 px-2 py-1">Not a git repository</p>
        )}
      </div>

      {/* Changes Section */}
      {gitBranch && changedFiles.length > 0 && (
        <div>
          {/* Review Button */}
          <div className="px-2 mb-3 flex gap-2">
            {/* Show "Review Complete" when done, otherwise show review button */}
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
                  Review Again
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleStartReview}
                  disabled={isReviewing || changedFiles.length === 0}
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
                      Review ({changedFiles.length})
                    </>
                  )}
                </button>
                {/* Cancel button - only show when actively reviewing */}
                {isReviewing && activeReviewId && (
                  <button
                    onClick={handleCancelReview}
                    className="px-3 py-2 text-xs rounded bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/30 transition-colors flex items-center gap-1.5"
                    title="Cancel review"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                )}
              </>
            )}
            {/* Show Results button when there's a review */}
            {activeReviewId && activeReview && (
              <button
                onClick={() => setVisibility(true)}
                className="px-3 py-2 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                title="View review results"
              >
                {(() => {
                  const review = activeReview
                  if (review?.status === 'completed') {
                    const count = review.findings.length
                    return count > 0 ? `${count} issues` : '✓ Clean'
                  }
                  if (review?.status === 'failed') return 'Failed'
                  if (review?.status === 'running') return '...'
                  return 'View'
                })()}
              </button>
            )}
          </div>

          {/* Staged Changes */}
          {stagedFiles.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Staged Changes ({stagedFiles.length})
                </span>
                <button
                  onClick={handleUnstageAll}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase"
                  title="Unstage all changes"
                >
                  Unstage All
                </button>
              </div>
              <div className="px-2 space-y-0.5">
                {stagedFiles.map(file => (
                  <FileItem key={`staged-${file.path}`} file={file} isStaged={true} />
                ))}
              </div>
            </div>
          )}

          {/* Unstaged Changes */}
          {unstagedFiles.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Changes ({unstagedFiles.length})
                </span>
                <button
                  onClick={handleStageAll}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase"
                  title="Stage all changes"
                >
                  Stage All
                </button>
              </div>
              <div className="px-2 space-y-0.5">
                {unstagedFiles.map(file => (
                  <FileItem key={`unstaged-${file.path}`} file={file} isStaged={false} />
                ))}
              </div>
            </div>
          )}

          {/* Commit UI */}
          {stagedFiles.length > 0 && (
            <div className="mt-3 px-2">
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
        </div>
      )}

      {gitBranch && changedFiles.length === 0 && (
        <p className="text-xs text-zinc-600 px-2 py-1">No changes</p>
      )}

      {/* Confirm discard dialog */}
      {confirmDiscard && createPortal(
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center"
          style={{ zIndex: 9999 }}
          onClick={() => setConfirmDiscard(null)}
        >
          <div
            className="bg-zinc-800 border border-zinc-700 rounded-md p-4 min-w-[300px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm text-red-400 mb-2">
              Discard changes to <span className="font-medium">{confirmDiscard.split('/').pop()}</span>?
            </div>
            <div className="text-xs text-zinc-500 mb-4">
              This cannot be undone.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDiscard(null)}
                className="flex-1 px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700 rounded border border-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDiscardFile(confirmDiscard)}
                className="flex-1 px-3 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded"
              >
                Discard
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
