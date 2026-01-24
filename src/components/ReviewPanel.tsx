import { X, Loader2, CheckCircle2, AlertTriangle, FileCode, Check, XCircle, Copy, Wrench, ExternalLink, RotateCcw, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useReviewStore, type ReviewFinding } from '../stores/review-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { cn } from '../lib/utils'

interface ReviewPanelProps {
  projectPath: string
}

// Helper function to group findings by file
function groupFindingsByFile(findings: ReviewFinding[]): Map<string, ReviewFinding[]> {
  const grouped = new Map<string, ReviewFinding[]>()
  for (const finding of findings) {
    const file = finding.file
    if (!grouped.has(file)) {
      grouped.set(file, [])
    }
    grouped.get(file)!.push(finding)
  }
  return grouped
}

export function ReviewPanel({ projectPath }: ReviewPanelProps) {
  const isVisible = useReviewStore((state) => state.isVisible)
  const activeReviewId = useReviewStore((state) => state.activeReviewId)
  const progress = useReviewStore((state) => state.progress)

  const review = useReviewStore(
    (state) => (state.activeReviewId ? state.reviews.get(state.activeReviewId) : null),
    (a, b) => {
      if (a === null || b === null) return a === b
      return (
        a.stage === b.stage &&
        a.status === b.status &&
        a.lowRiskFindings.length === b.lowRiskFindings.length &&
        a.highRiskFindings.length === b.highRiskFindings.length &&
        a.currentHighRiskFileIndex === b.currentHighRiskFileIndex
      )
    }
  )

  const setVisibility = useReviewStore((state) => state.setVisibility)
  const applyFinding = useReviewStore((state) => state.applyFinding)
  const dismissFinding = useReviewStore((state) => state.dismissFinding)
  const cancelReview = useReviewStore((state) => state.cancelReview)
  const clearCacheForFiles = useReviewStore((state) => state.clearCacheForFiles)

  const handleCancelReview = async () => {
    if (!activeReviewId) return

    if (window.electron) {
      await window.electron.review.cancel(activeReviewId)
    }

    cancelReview(activeReviewId)
    setVisibility(false)
  }

  const handleStartOver = async () => {
    if (!activeReviewId || !review) return

    if (review.status === 'running') {
      if (window.electron) {
        await window.electron.review.cancel(activeReviewId)
      }
    }

    const allFiles = review.files || []
    if (allFiles.length > 0) {
      console.log('[ReviewPanel] Clearing cache for', allFiles.length, 'files')
      clearCacheForFiles(projectPath, allFiles)
    }

    setVisibility(false)
    cancelReview(activeReviewId)

    setTimeout(() => {
      console.log('[ReviewPanel] Ready for fresh review')
    }, 100)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && review?.status === 'running') {
        e.preventDefault()
        handleCancelReview()
      }
    }

    if (isVisible) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isVisible, review?.status, handleCancelReview])

  if (!isVisible || !activeReviewId || !review) return null

  // Determine what stage to show
  const isLoading = ['classifying', 'classification-review', 'reviewing-low-risk', 'reviewing-high-risk'].includes(review.stage) &&
    review.lowRiskFindings.length === 0 &&
    review.highRiskFindings.length === 0
  const hasResults = review.lowRiskFindings.length > 0 || review.highRiskFindings.length > 0
  const isCompleted = review.stage === 'completed'
  const isFailed = review.status === 'failed'

  return createPortal(
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[95vw] h-[90vh] flex flex-col">
        {/* Header - Simplified */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700 bg-zinc-800/50">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-white">Code Review</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartOver}
              className="px-3 py-1.5 rounded bg-orange-600/10 hover:bg-orange-600/20 text-orange-400 border border-orange-600/30 transition-colors flex items-center gap-2 text-sm font-medium"
              title="Start over with fresh review (clears cache)"
            >
              <RotateCcw className="w-4 h-4" />
              Start Over
            </button>
            {review.status === 'running' && (
              <button
                onClick={handleCancelReview}
                className="px-3 py-1.5 rounded bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/30 transition-colors flex items-center gap-2 text-sm font-medium"
                title="Cancel review and clean up"
              >
                <XCircle className="w-4 h-4" />
                Cancel
              </button>
            )}
            <button
              onClick={() => setVisibility(false)}
              className="p-2 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
              title="Close panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {isFailed && <FailedStage error={review.error || 'Unknown error'} />}
          {!isFailed && isLoading && <LoadingStage />}
          {!isFailed && !isLoading && hasResults && !isCompleted && (
            <UnifiedResultsStage
              lowRiskFindings={review.lowRiskFindings}
              highRiskFindings={review.highRiskFindings}
              projectPath={projectPath}
              projectId={review.projectId}
              reviewId={activeReviewId}
              onApply={applyFinding}
              onDismiss={dismissFinding}
            />
          )}
          {!isFailed && isCompleted && (
            <CompletedStage
              review={review}
              onClose={() => setVisibility(false)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// Simple unified loading stage
function LoadingStage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-400">
      <Loader2 className="w-12 h-12 animate-spin mb-6 text-purple-400" />
      <p className="text-lg text-zinc-300">Reviewing your changes...</p>
    </div>
  )
}

// Unified Results Stage - Shows both Critical Issues and Quick Fixes
function UnifiedResultsStage({
  lowRiskFindings,
  highRiskFindings,
  projectPath,
  projectId,
  reviewId,
  onApply,
  onDismiss,
}: {
  lowRiskFindings: ReviewFinding[]
  highRiskFindings: ReviewFinding[]
  projectPath: string
  projectId?: string
  reviewId: string
  onApply: (reviewId: string, findingId: string) => Promise<void>
  onDismiss: (reviewId: string, findingId: string) => void
}) {
  const [quickFixesExpanded, setQuickFixesExpanded] = useState(false)
  const [expandedCriticalFiles, setExpandedCriticalFiles] = useState<Set<string>>(new Set())
  const [expandedQuickFixFiles, setExpandedQuickFixFiles] = useState<Set<string>>(new Set())

  // Get escalation function and state from store
  const escalateToDeepReview = useReviewStore((state) => state.escalateToDeepReview)
  const escalatingFile = useReviewStore((state) => {
    const review = state.activeReviewId ? state.reviews.get(state.activeReviewId) : null
    return review?.escalatingFile
  })

  // Filter out applied/dismissed findings
  const visibleCriticalFindings = highRiskFindings.filter((f) => !f.isApplied && !f.isDismissed)
  const visibleQuickFixFindings = lowRiskFindings.filter((f) => !f.isApplied && !f.isDismissed)

  // Group by file
  const criticalByFile = groupFindingsByFile(visibleCriticalFindings)
  const quickFixByFile = groupFindingsByFile(visibleQuickFixFindings)

  const toggleCriticalFile = (file: string) => {
    setExpandedCriticalFiles((prev) => {
      const next = new Set(prev)
      if (next.has(file)) {
        next.delete(file)
      } else {
        next.add(file)
      }
      return next
    })
  }

  const toggleQuickFixFile = (file: string) => {
    setExpandedQuickFixFiles((prev) => {
      const next = new Set(prev)
      if (next.has(file)) {
        next.delete(file)
      } else {
        next.add(file)
      }
      return next
    })
  }

  // Batch actions for Quick Fixes
  const handleFixAll = async () => {
    for (const finding of visibleQuickFixFindings) {
      await onApply(reviewId, finding.id)
    }
  }

  const handleDismissAll = () => {
    for (const finding of visibleQuickFixFindings) {
      onDismiss(reviewId, finding.id)
    }
  }

  // Initialize all critical files as expanded
  useEffect(() => {
    const allCriticalFiles = Array.from(criticalByFile.keys())
    setExpandedCriticalFiles(new Set(allCriticalFiles))
  }, [highRiskFindings.length])

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* TIER 1: Critical Issues - Always visible, not collapsible */}
        {visibleCriticalFindings.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h3 className="text-lg font-semibold text-red-400">
                Critical Issues ({visibleCriticalFindings.length})
              </h3>
            </div>
            <p className="text-sm text-zinc-400">
              These issues require your attention and may cause bugs or security problems.
            </p>

            <div className="space-y-3">
              {Array.from(criticalByFile.entries()).map(([file, findings]) => (
                <CriticalFileGroup
                  key={file}
                  file={file}
                  findings={findings}
                  isExpanded={expandedCriticalFiles.has(file)}
                  onToggle={() => toggleCriticalFile(file)}
                  projectPath={projectPath}
                  projectId={projectId}
                  reviewId={reviewId}
                  onApply={onApply}
                  onDismiss={onDismiss}
                />
              ))}
            </div>
          </div>
        )}

        {visibleCriticalFindings.length === 0 && visibleQuickFixFindings.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <CheckCircle2 className="w-12 h-12 mb-4 text-green-400" />
            <p className="text-lg text-zinc-300">No issues found!</p>
            <p className="text-sm">Your code looks good.</p>
          </div>
        )}

        {/* TIER 2: Quick Fixes - Collapsible */}
        {visibleQuickFixFindings.length > 0 && (
          <div className="border border-zinc-700 rounded-lg bg-zinc-800/50">
            {/* Header with expand/collapse and batch actions */}
            <button
              onClick={() => setQuickFixesExpanded(!quickFixesExpanded)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-700/30 transition-colors rounded-t-lg"
            >
              <div className="flex items-center gap-3">
                {quickFixesExpanded ? (
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                )}
                <span className="text-sm font-medium text-zinc-300">
                  Quick Fixes
                </span>
                <span className="text-sm text-zinc-500">
                  {visibleQuickFixFindings.length} minor issue{visibleQuickFixFindings.length !== 1 ? 's' : ''} found
                </span>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={handleFixAll}
                  className="text-xs px-3 py-1.5 rounded bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/30 transition-colors font-medium"
                >
                  Fix All
                </button>
                <button
                  onClick={handleDismissAll}
                  className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                >
                  Dismiss All
                </button>
              </div>
            </button>

            {/* Expanded content */}
            {quickFixesExpanded && (
              <div className="p-4 border-t border-zinc-700 space-y-3">
                {Array.from(quickFixByFile.entries()).map(([file, findings]) => (
                  <QuickFixFileGroup
                    key={file}
                    file={file}
                    findings={findings}
                    isExpanded={expandedQuickFixFiles.has(file)}
                    onToggle={() => toggleQuickFixFile(file)}
                    projectPath={projectPath}
                    projectId={projectId}
                    reviewId={reviewId}
                    onApply={onApply}
                    onDismiss={onDismiss}
                    onEscalate={() => escalateToDeepReview(reviewId, file)}
                    isEscalating={escalatingFile === file}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Critical Issues File Group
function CriticalFileGroup({
  file,
  findings,
  isExpanded,
  onToggle,
  projectPath,
  projectId,
  reviewId,
  onApply,
  onDismiss,
}: {
  file: string
  findings: ReviewFinding[]
  isExpanded: boolean
  onToggle: () => void
  projectPath: string
  projectId?: string
  reviewId: string
  onApply: (reviewId: string, findingId: string) => Promise<void>
  onDismiss: (reviewId: string, findingId: string) => void
}) {
  return (
    <div className="border border-red-500/20 rounded-lg bg-red-500/5">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-red-500/10 transition-colors rounded-t-lg"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-red-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-red-400" />
        )}
        <FileCode className="w-4 h-4 text-red-400" />
        <span className="text-sm font-medium text-red-400 truncate flex-1 text-left">{file}</span>
        <span className="text-xs text-red-400/70 px-2 py-0.5 bg-red-500/10 rounded">
          {findings.length} issue{findings.length !== 1 ? 's' : ''}
        </span>
      </button>

      {isExpanded && (
        <div className="p-4 border-t border-red-500/20 space-y-3">
          {findings.map((finding) => (
            <CriticalFindingCard
              key={finding.id}
              finding={finding}
              projectPath={projectPath}
              projectId={projectId}
              onApply={() => onApply(reviewId, finding.id)}
              onDismiss={() => onDismiss(reviewId, finding.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Quick Fix File Group
function QuickFixFileGroup({
  file,
  findings,
  isExpanded,
  onToggle,
  projectPath,
  projectId,
  reviewId,
  onApply,
  onDismiss,
  onEscalate,
  isEscalating,
}: {
  file: string
  findings: ReviewFinding[]
  isExpanded: boolean
  onToggle: () => void
  projectPath: string
  projectId?: string
  reviewId: string
  onApply: (reviewId: string, findingId: string) => Promise<void>
  onDismiss: (reviewId: string, findingId: string) => void
  onEscalate: () => void
  isEscalating: boolean
}) {
  return (
    <div className="border border-zinc-700 rounded-lg bg-zinc-800/50">
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex-1 px-4 py-3 flex items-center gap-3 hover:bg-zinc-700/30 transition-colors rounded-tl-lg"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          )}
          <FileCode className="w-4 h-4 text-zinc-500" />
          <span className="text-sm text-zinc-400 truncate flex-1 text-left">{file}</span>
          <span className="text-xs text-zinc-500 px-2 py-0.5 bg-zinc-700 rounded">
            {findings.length} issue{findings.length !== 1 ? 's' : ''}
          </span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEscalate()
          }}
          disabled={isEscalating}
          className="px-3 py-2 mr-2 text-xs rounded bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 border border-purple-600/30 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Run deep multi-agent review on this file"
        >
          {isEscalating ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Reviewing...
            </>
          ) : (
            <>
              <Search className="w-3 h-3" />
              Deep Review
            </>
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="p-4 border-t border-zinc-700 space-y-3">
          {findings.map((finding) => (
            <QuickFixFindingCard
              key={finding.id}
              finding={finding}
              projectPath={projectPath}
              projectId={projectId}
              onApply={() => onApply(reviewId, finding.id)}
              onDismiss={() => onDismiss(reviewId, finding.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Critical Finding Card
function CriticalFindingCard({
  finding,
  projectPath,
  projectId,
  onApply,
  onDismiss,
}: {
  finding: ReviewFinding
  projectPath: string
  projectId?: string
  onApply: () => void
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)
  const { openFile } = useFileViewerStore()

  const handleCopyPrompt = () => {
    if (finding.aiPrompt) {
      navigator.clipboard.writeText(finding.aiPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenFile = async () => {
    if (!window.electron) return

    const fullPath = `${projectPath}/${finding.file}`
    const result = await window.electron.git.getFileContent(projectPath, finding.file)

    if (result.success && result.content) {
      openFile(fullPath, finding.file, result.content, projectPath, projectId)
    }
  }

  return (
    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-red-300">{finding.title}</h4>
            {finding.isCached && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Cached
              </span>
            )}
          </div>
          <button
            onClick={handleOpenFile}
            className="flex items-center gap-1.5 group hover:bg-zinc-700/50 rounded px-1.5 py-0.5 -ml-1.5 transition-colors"
          >
            <span className="text-xs text-zinc-500 group-hover:text-red-400 group-hover:underline transition-colors">
              {finding.line && `Line ${finding.line}`}
              {finding.endLine && finding.endLine !== finding.line && `-${finding.endLine}`}
            </span>
            <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all" />
          </button>
        </div>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded flex-shrink-0',
            finding.severity === 'critical' && 'bg-red-500/20 text-red-400',
            finding.severity === 'warning' && 'bg-yellow-500/20 text-yellow-400',
            finding.severity === 'info' && 'bg-blue-500/20 text-blue-400',
            finding.severity === 'suggestion' && 'bg-green-500/20 text-green-400'
          )}
        >
          {finding.severity}
        </span>
      </div>

      <p className="text-sm text-zinc-400 mb-3">{finding.description}</p>

      {finding.suggestion && (
        <div className="bg-zinc-900 border border-green-500/30 rounded p-2 mb-3">
          <p className="text-xs text-green-400">{finding.suggestion}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        {finding.codeChange && (
          <button
            onClick={onApply}
            className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white transition-colors font-medium flex items-center gap-1.5"
          >
            <Wrench className="w-3 h-3" />
            Apply
          </button>
        )}
        {finding.aiPrompt && (
          <button
            onClick={handleCopyPrompt}
            className="text-xs px-3 py-1.5 rounded bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 border border-purple-600/30 transition-colors flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy Prompt
              </>
            )}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

// Quick Fix Finding Card
function QuickFixFindingCard({
  finding,
  projectPath,
  projectId,
  onApply,
  onDismiss,
}: {
  finding: ReviewFinding
  projectPath: string
  projectId?: string
  onApply: () => void
  onDismiss: () => void
}) {
  const { openFile } = useFileViewerStore()

  const handleOpenFile = async () => {
    if (!window.electron) return

    const fullPath = `${projectPath}/${finding.file}`
    const result = await window.electron.git.getFileContent(projectPath, finding.file)

    if (result.success && result.content) {
      openFile(fullPath, finding.file, result.content, projectPath, projectId)
    }
  }

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-zinc-300">{finding.title}</h4>
            {finding.isCached && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Cached
              </span>
            )}
          </div>
          <button
            onClick={handleOpenFile}
            className="flex items-center gap-1.5 group hover:bg-zinc-700/50 rounded px-1.5 py-0.5 -ml-1.5 transition-colors"
          >
            <span className="text-xs text-zinc-500 group-hover:text-zinc-300 group-hover:underline transition-colors">
              {finding.line && `Line ${finding.line}`}
              {finding.endLine && finding.endLine !== finding.line && `-${finding.endLine}`}
            </span>
            <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all" />
          </button>
        </div>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded flex-shrink-0',
            finding.severity === 'critical' && 'bg-red-500/20 text-red-400',
            finding.severity === 'warning' && 'bg-yellow-500/20 text-yellow-400',
            finding.severity === 'info' && 'bg-blue-500/20 text-blue-400',
            finding.severity === 'suggestion' && 'bg-green-500/20 text-green-400'
          )}
        >
          {finding.severity}
        </span>
      </div>

      <p className="text-sm text-zinc-400 mb-3">{finding.description}</p>

      {finding.suggestion && (
        <div className="bg-zinc-900 border border-zinc-700 rounded p-2 mb-3">
          <p className="text-xs text-zinc-400">{finding.suggestion}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onApply}
          className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white transition-colors font-medium"
        >
          Apply
        </button>
        <button
          onClick={onDismiss}
          className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

// Completed Stage
function CompletedStage({ review, onClose }: { review: any; onClose: () => void }) {
  const allFindings = [...review.lowRiskFindings, ...review.highRiskFindings]
  const totalFindings = allFindings.length
  const appliedFindings = allFindings.filter((f: ReviewFinding) => f.isApplied).length
  const dismissedFindings = allFindings.filter((f: ReviewFinding) => f.isDismissed).length

  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-400">
      <CheckCircle2 className="w-16 h-16 mb-6 text-green-400" />
      <h3 className="text-2xl font-medium text-white mb-2">Review Complete!</h3>
      <p className="text-sm text-zinc-400 mb-6">
        Reviewed {review.files.length} files | {totalFindings} findings | {appliedFindings} applied | {dismissedFindings} dismissed
      </p>
      <button
        onClick={onClose}
        className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-medium transition-colors"
      >
        Close
      </button>
    </div>
  )
}

// Failed Stage
function FailedStage({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-400">
      <AlertTriangle className="w-16 h-16 mb-6 text-red-400" />
      <h3 className="text-2xl font-medium text-white mb-2">Review Failed</h3>
      <p className="text-sm text-zinc-400 max-w-md text-center">{error}</p>
    </div>
  )
}
