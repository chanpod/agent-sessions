import { X, Loader2, CheckCircle2, AlertTriangle, FileCode, ArrowRight, Check, XCircle, Copy, Wrench, ExternalLink, RotateCcw } from 'lucide-react'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useReviewStore, type FileClassification, type ReviewFinding, type FileRiskLevel } from '../stores/review-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { cn } from '../lib/utils'
import { generateFileId } from '../lib/file-id'

interface ReviewPanelProps {
  projectPath: string
}

export function ReviewPanel({ projectPath }: ReviewPanelProps) {
  const isVisible = useReviewStore((state) => state.isVisible)
  const activeReviewId = useReviewStore((state) => state.activeReviewId)
  const progress = useReviewStore((state) => state.progress)

  // IMPORTANT: Select the specific review object, not the entire Map
  // This ensures re-renders when the review updates
  // We need to use a custom equality function to ensure Zustand detects changes
  const review = useReviewStore(
    (state) => (state.activeReviewId ? state.reviews.get(state.activeReviewId) : null),
    (a, b) => {
      // Custom equality: force re-render if either is null or if they're different objects
      if (a === null || b === null) return a === b
      // Deep comparison of key properties that change during the review
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
  const updateClassification = useReviewStore((state) => state.updateClassification)
  const confirmClassifications = useReviewStore((state) => state.confirmClassifications)
  const toggleFindingSelection = useReviewStore((state) => state.toggleFindingSelection)
  const selectAllFindings = useReviewStore((state) => state.selectAllFindings)
  const applySelectedFindings = useReviewStore((state) => state.applySelectedFindings)
  const applyFinding = useReviewStore((state) => state.applyFinding)
  const dismissFinding = useReviewStore((state) => state.dismissFinding)
  const advanceToNextHighRiskFile = useReviewStore((state) => state.advanceToNextHighRiskFile)
  const cancelReview = useReviewStore((state) => state.cancelReview)
  const clearCacheForFiles = useReviewStore((state) => state.clearCacheForFiles)

  const handleCancelReview = async () => {
    if (!activeReviewId) return

    // Cancel on backend
    if (window.electron) {
      await window.electron.review.cancel(activeReviewId)
    }

    // Cancel on frontend
    cancelReview(activeReviewId)
    setVisibility(false)
  }

  const handleStartOver = async () => {
    if (!activeReviewId || !review) return

    // Cancel current review if running
    if (review.status === 'running') {
      if (window.electron) {
        await window.electron.review.cancel(activeReviewId)
      }
    }

    // Clear cache for all files in this review
    const allFiles = review.files || []
    if (allFiles.length > 0) {
      console.log('[ReviewPanel] Clearing cache for', allFiles.length, 'files')
      clearCacheForFiles(projectPath, allFiles)
    }

    // Close panel and allow user to start a fresh review
    setVisibility(false)
    cancelReview(activeReviewId)

    // Small delay to let state settle before starting a new review
    setTimeout(() => {
      console.log('[ReviewPanel] Ready for fresh review')
    }, 100)
  }

  // Add keyboard shortcut for cancelling (Escape key)
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

  return createPortal(
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[95vw] h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700 bg-zinc-800/50">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-white">Code Review</h2>
            <StageIndicator stage={review.stage} />
          </div>
          <div className="flex items-center gap-2">
            {/* Show start over button */}
            <button
              onClick={handleStartOver}
              className="px-3 py-1.5 rounded bg-orange-600/10 hover:bg-orange-600/20 text-orange-400 border border-orange-600/30 transition-colors flex items-center gap-2 text-sm font-medium"
              title="Start over with fresh review (clears cache)"
            >
              <RotateCcw className="w-4 h-4" />
              Start Over
            </button>
            {/* Show cancel button only when review is running */}
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
          {review.stage === 'classifying' && <ClassifyingStage progress={progress} />}
          {review.stage === 'classification-review' && (
            <ClassificationReviewStage
              classifications={review.classifications || []}
              onUpdateClassification={(file, riskLevel) => updateClassification(activeReviewId, file, riskLevel)}
              onConfirm={() => confirmClassifications(activeReviewId)}
            />
          )}
          {review.stage === 'reviewing-low-risk' && review.lowRiskFindings.length === 0 && (
            <ReviewingLowRiskStage progress={progress} fileCount={review.lowRiskFiles.length} />
          )}
          {review.stage === 'reviewing-low-risk' && review.lowRiskFindings.length > 0 && (
            <LowRiskResultsStage
              findings={review.lowRiskFindings}
              projectPath={projectPath}
              onToggleSelection={(id) => toggleFindingSelection(activeReviewId, id)}
              onSelectAll={(selected) => selectAllFindings(activeReviewId, selected)}
              onApplySelected={() => applySelectedFindings(activeReviewId)}
              onApply={(id) => applyFinding(activeReviewId, id)}
              onDismiss={(id) => dismissFinding(activeReviewId, id)}
              onContinue={() => {
                // Move to high-risk review
                useReviewStore.getState().setReviewStage(activeReviewId, 'reviewing-high-risk')
              }}
            />
          )}
          {review.stage === 'reviewing-high-risk' && (
            <HighRiskReviewStage
              review={review}
              projectPath={projectPath}
              onNext={() => advanceToNextHighRiskFile(activeReviewId)}
            />
          )}
          {review.stage === 'completed' && (
            <CompletedStage
              review={review}
              onClose={() => setVisibility(false)}
            />
          )}
          {review.status === 'failed' && (
            <FailedStage error={review.error || 'Unknown error'} />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// Stage Indicator Component
function StageIndicator({ stage }: { stage: string }) {
  const stages = [
    { id: 'classifying', label: 'Classifying' },
    { id: 'classification-review', label: 'Review Classification' },
    { id: 'reviewing-low-risk', label: 'Low-Risk Review' },
    { id: 'reviewing-high-risk', label: 'High-Risk Review' },
    { id: 'completed', label: 'Complete' },
  ]

  const currentIndex = stages.findIndex((s) => s.id === stage)

  return (
    <div className="flex items-center gap-2">
      {stages.map((s, idx) => {
        const isActive = idx === currentIndex
        const isCompleted = idx < currentIndex
        return (
          <div key={s.id} className="flex items-center gap-2">
            {idx > 0 && (
              <ArrowRight className={cn('w-3 h-3', isCompleted ? 'text-green-400' : 'text-zinc-600')} />
            )}
            <div
              className={cn(
                'px-2 py-1 rounded text-xs font-medium transition-colors',
                isActive && 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
                isCompleted && 'bg-green-500/10 text-green-400',
                !isActive && !isCompleted && 'text-zinc-500'
              )}
            >
              {s.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Stage 1: Classifying Files
function ClassifyingStage({ progress }: { progress: any }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-400">
      <Loader2 className="w-12 h-12 animate-spin mb-6 text-purple-400" />
      <p className="text-lg text-zinc-300 mb-2">Analyzing files...</p>
      <p className="text-sm">{progress?.message || 'Classifying files by risk level'}</p>
    </div>
  )
}

// Stage 2: Classification Review (User confirms/adjusts)
function ClassificationReviewStage({
  classifications,
  onUpdateClassification,
  onConfirm,
}: {
  classifications: FileClassification[]
  onUpdateClassification: (file: string, riskLevel: FileRiskLevel) => void
  onConfirm: () => void
}) {
  const lowRiskFiles = classifications.filter((c) => (c.userOverride || c.riskLevel) === 'low-risk')
  const highRiskFiles = classifications.filter((c) => (c.userOverride || c.riskLevel) === 'high-risk')

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-700">
        <h3 className="text-lg font-medium text-white mb-2">Review File Classifications</h3>
        <p className="text-sm text-zinc-400">
          We've analyzed your changes and classified files by risk. Review and adjust as needed.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-6">
          {/* Low-Risk Files */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              Low Risk ({lowRiskFiles.length})
            </h4>
            <p className="text-xs text-zinc-500 mb-4">
              These files will be reviewed quickly in bulk. Low risk of bugs or security issues.
            </p>
            <div className="space-y-2">
              {lowRiskFiles.map((c) => (
                <FileClassificationCard
                  key={c.file}
                  classification={c}
                  onChangeRisk={(risk) => onUpdateClassification(c.file, risk)}
                />
              ))}
            </div>
          </div>

          {/* High-Risk Files */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              High-Risk ({highRiskFiles.length})
            </h4>
            <p className="text-xs text-zinc-500 mb-4">
              These files will be reviewed one-by-one with detailed analysis. Higher risk of bugs or security issues.
            </p>
            <div className="space-y-2">
              {highRiskFiles.map((c) => (
                <FileClassificationCard
                  key={c.file}
                  classification={c}
                  onChangeRisk={(risk) => onUpdateClassification(c.file, risk)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-zinc-700 bg-zinc-800/50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-xs text-zinc-500">
            {classifications.length} files classified • {lowRiskFiles.length} low-risk • {highRiskFiles.length}{' '}
            high-risk
          </p>
        </div>
        <button
          onClick={onConfirm}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-medium transition-colors flex items-center gap-2"
        >
          Continue to Review
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function FileClassificationCard({
  classification,
  onChangeRisk,
}: {
  classification: FileClassification
  onChangeRisk: (risk: FileRiskLevel) => void
}) {
  const currentRisk = classification.userOverride || classification.riskLevel

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileCode className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <span className="text-sm text-zinc-300 truncate" title={classification.file}>
            {classification.file}
          </span>
        </div>
        <button
          onClick={() =>
            onChangeRisk(currentRisk === 'low-risk' ? 'high-risk' : 'low-risk')
          }
          className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors flex-shrink-0"
          title="Switch classification"
        >
          Switch
        </button>
      </div>
      <p className="text-xs text-zinc-500 line-clamp-2">{classification.reasoning}</p>
    </div>
  )
}

// Stage 3: Reviewing Low-Risk Files (Loading)
function ReviewingLowRiskStage({ progress, fileCount }: { progress: any; fileCount: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-400">
      <Loader2 className="w-12 h-12 animate-spin mb-6 text-purple-400" />
      <p className="text-lg text-zinc-300 mb-2">Reviewing low-risk files in parallel...</p>
      <p className="text-sm">{fileCount} files being analyzed by multiple agents</p>
    </div>
  )
}

// Stage 4: Low-Risk Results (Bulk Apply/Dismiss)
function LowRiskResultsStage({
  findings,
  projectPath,
  onToggleSelection,
  onSelectAll,
  onApplySelected,
  onApply,
  onDismiss,
  onContinue,
}: {
  findings: ReviewFinding[]
  projectPath: string
  onToggleSelection: (id: string) => void
  onSelectAll: (selected: boolean) => void
  onApplySelected: () => void
  onApply: (id: string) => Promise<void>
  onDismiss: (id: string) => void
  onContinue: () => void
}) {
  const visibleFindings = findings.filter((f) => !f.isApplied && !f.isDismissed)
  const selectedCount = visibleFindings.filter((f) => f.isSelected).length
  const allSelected = visibleFindings.length > 0 && selectedCount === visibleFindings.length
  const cachedCount = visibleFindings.filter((f) => f.isCached).length

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-700">
        <h3 className="text-lg font-medium text-white mb-2">Low-Risk Review Results</h3>
        <p className="text-sm text-zinc-400">
          {visibleFindings.length} suggestion{visibleFindings.length !== 1 ? 's' : ''} found. Select and apply changes
          in bulk.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {visibleFindings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <CheckCircle2 className="w-12 h-12 mb-4 text-green-400" />
            <p className="text-lg text-zinc-300">No issues found!</p>
            <p className="text-sm">All low-risk files look good.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleFindings.map((finding) => (
              <LowRiskFindingCard
                key={finding.id}
                finding={finding}
                projectPath={projectPath}
                onToggleSelection={() => onToggleSelection(finding.id)}
                onApply={() => onApply(finding.id)}
                onDismiss={() => onDismiss(finding.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-zinc-700 bg-zinc-800/50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => onSelectAll(!allSelected)}
            className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          {selectedCount > 0 && (
            <button
              onClick={onApplySelected}
              className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white transition-colors font-medium"
            >
              Apply Selected ({selectedCount})
            </button>
          )}
          {cachedCount > 0 && (
            <span className="text-xs text-blue-400">
              {cachedCount} cached
            </span>
          )}
        </div>
        <button
          onClick={onContinue}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-medium transition-colors flex items-center gap-2"
        >
          Continue to High-Risk Review
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function LowRiskFindingCard({
  finding,
  onToggleSelection,
  onApply,
  onDismiss,
  projectPath,
}: {
  finding: ReviewFinding
  onToggleSelection: () => void
  onApply: () => void
  onDismiss: () => void
  projectPath: string
}) {
  const { openFile } = useFileViewerStore()

  const handleOpenFile = async () => {
    if (!window.electron) return

    const fullPath = `${projectPath}/${finding.file}`
    const result = await window.electron.git.getFileContent(projectPath, finding.file)

    if (result.success && result.content) {
      openFile(fullPath, finding.file, result.content, projectPath)
    }
  }

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-start gap-3">
        {/* Custom checkbox with visible checkmark */}
        <button
          onClick={onToggleSelection}
          className={cn(
            "mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0",
            finding.isSelected
              ? "bg-purple-600 border-purple-600"
              : "bg-zinc-700 border-zinc-600 hover:border-purple-500"
          )}
        >
          {finding.isSelected && <Check className="w-3.5 h-3.5 text-white" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-zinc-200">{finding.title}</h4>
                {finding.isCached && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    Cached
                  </span>
                )}
              </div>
              {/* Clickable file path */}
              <button
                onClick={handleOpenFile}
                className="flex items-center gap-1.5 mt-1 group hover:bg-zinc-700/50 rounded px-1.5 py-0.5 -ml-1.5 transition-colors"
              >
                <FileCode className="w-3 h-3 text-zinc-500 group-hover:text-purple-400 transition-colors" />
                <span className="text-xs text-zinc-500 group-hover:text-purple-400 group-hover:underline transition-colors">
                  {finding.file}
                  {finding.line && `:${finding.line}`}
                </span>
                <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-purple-400 opacity-0 group-hover:opacity-100 transition-all" />
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
          <p className="text-sm text-zinc-400 mb-2">{finding.description}</p>
          {finding.suggestion && (
            <div className="bg-zinc-900 border border-zinc-700 rounded p-2 mb-3">
              <p className="text-xs text-green-400">💡 {finding.suggestion}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onApply}
              className="text-xs px-3 py-1 rounded bg-green-600 hover:bg-green-500 text-white transition-colors"
            >
              Apply
            </button>
            <button
              onClick={onDismiss}
              className="text-xs px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Stage 5: High-Risk Review (Sequential, one file at a time with multi-agent verification)
function HighRiskReviewStage({ review, projectPath, onNext }: { review: any; projectPath: string; onNext: () => void }) {
  const currentFile = review.highRiskFiles[review.currentHighRiskFileIndex]
  // Use FileId for comparison to avoid duplicates from path variations
  const currentFileId = review.highRiskFiles[review.currentHighRiskFileIndex]
    ? (review.highRiskFindings.find(f => f.file === currentFile)?.fileId || currentFile)
    : currentFile
  const currentFindings = review.highRiskFindings.filter((f: ReviewFinding) =>
    f.fileId ? f.fileId === currentFileId : f.file === currentFile
  )
  const coordinatorStatus = review.currentFileCoordinatorStatus
  const verifiedFindings = currentFindings.filter((f: ReviewFinding) => f.verificationStatus === 'verified')
  const isComplete = coordinatorStatus === 'complete'

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-medium text-white">High-Risk File Review</h3>
          <span className="text-sm text-zinc-400">
            {review.currentHighRiskFileIndex + 1} of {review.highRiskFiles.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-orange-400" />
          <span className="text-sm text-zinc-300">{currentFile}</span>
        </div>
      </div>

      {/* Multi-Agent Progress Indicator */}
      {coordinatorStatus && coordinatorStatus !== 'complete' && (
        <div className="px-6 py-3 bg-purple-500/10 border-b border-purple-500/20">
          <MultiAgentProgress status={coordinatorStatus} subAgentCount={review.currentFileSubAgentReviews?.length || 0} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {!isComplete ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Loader2 className="w-12 h-12 animate-spin mb-4 text-purple-400" />
            <p className="text-lg text-zinc-300 mb-2">
              {coordinatorStatus === 'reviewing' && 'Running 3 independent reviews...'}
              {coordinatorStatus === 'coordinating' && 'Coordinator analyzing findings...'}
              {coordinatorStatus === 'verifying' && 'Accuracy checkers validating findings...'}
            </p>
            <p className="text-xs text-zinc-500">Multi-agent verification in progress</p>
          </div>
        ) : verifiedFindings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <CheckCircle2 className="w-12 h-12 mb-4 text-green-400" />
            <p className="text-lg text-zinc-300">No verified issues found!</p>
            <p className="text-sm">All sub-agents agree this file looks good.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {verifiedFindings.map((finding: ReviewFinding) => (
              <HighRiskFindingCard key={finding.id} finding={finding} projectPath={projectPath} />
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-zinc-700 bg-zinc-800/50 flex items-center justify-between">
        <div className="text-xs text-zinc-500">
          {isComplete && (
            <>
              {verifiedFindings.length} verified finding{verifiedFindings.length !== 1 ? 's' : ''} •{' '}
              Reviewed by 3 agents + verification
            </>
          )}
        </div>
        <button
          onClick={onNext}
          disabled={!isComplete}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded font-medium transition-colors flex items-center gap-2"
        >
          {review.currentHighRiskFileIndex + 1 === review.highRiskFiles.length ? 'Complete Review' : 'Next File'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// Multi-Agent Progress Component
function MultiAgentProgress({ status, subAgentCount }: { status: string; subAgentCount: number }) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <div className={cn(
          'w-2 h-2 rounded-full',
          status === 'reviewing' ? 'bg-purple-400 animate-pulse' : 'bg-green-400'
        )} />
        <span className="text-xs text-zinc-300">Sub-Agents ({subAgentCount}/3)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className={cn(
          'w-2 h-2 rounded-full',
          status === 'coordinating' ? 'bg-purple-400 animate-pulse' : status === 'verifying' || status === 'complete' ? 'bg-green-400' : 'bg-zinc-600'
        )} />
        <span className="text-xs text-zinc-300">Coordinator</span>
      </div>
      <div className="flex items-center gap-2">
        <div className={cn(
          'w-2 h-2 rounded-full',
          status === 'verifying' ? 'bg-purple-400 animate-pulse' : status === 'complete' ? 'bg-green-400' : 'bg-zinc-600'
        )} />
        <span className="text-xs text-zinc-300">Accuracy Checkers</span>
      </div>
    </div>
  )
}

function HighRiskFindingCard({ finding, projectPath }: { finding: ReviewFinding; projectPath: string }) {
  const confidencePercent = Math.round((finding.confidence || 0) * 100)
  const sourceAgentCount = finding.sourceAgents?.length || 1
  const [copied, setCopied] = useState(false)
  const applyFinding = useReviewStore((state) => state.applyFinding)
  const activeReviewId = useReviewStore((state) => state.activeReviewId)
  const { openFile } = useFileViewerStore()

  const handleCopyPrompt = () => {
    if (finding.aiPrompt) {
      navigator.clipboard.writeText(finding.aiPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleFixNow = async () => {
    if (activeReviewId && finding.codeChange) {
      await applyFinding(activeReviewId, finding.id)
    }
  }

  const handleOpenFile = async () => {
    if (!window.electron) return

    const fullPath = `${projectPath}/${finding.file}`
    const result = await window.electron.git.getFileContent(projectPath, finding.file)

    if (result.success && result.content) {
      openFile(fullPath, finding.file, result.content, projectPath)
    }
  }

  return (
    <div className={cn(
      "bg-zinc-800/50 border-2 rounded-lg p-4",
      finding.isApplied ? "border-green-500/50 bg-green-500/5" : "border-orange-500/30"
    )}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-base font-medium text-zinc-200">{finding.title}</h4>
            {finding.isCached && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Cached
              </span>
            )}
            {finding.isApplied && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Applied
              </span>
            )}
          </div>
          {/* Verification Badge */}
          <div className="flex items-center gap-2">
            {!finding.isCached && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Verified
              </span>
            )}
            {finding.confidence && (
              <span className="text-xs text-zinc-500">
                {confidencePercent}% confidence
              </span>
            )}
            {sourceAgentCount > 1 && (
              <span className="text-xs text-zinc-500">
                • Found by {sourceAgentCount} agents
              </span>
            )}
          </div>
        </div>
        <span
          className={cn(
            'text-xs px-2 py-1 rounded font-medium flex-shrink-0',
            finding.severity === 'critical' && 'bg-red-500/20 text-red-400 border border-red-500/30',
            finding.severity === 'warning' && 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
            finding.severity === 'info' && 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
            finding.severity === 'suggestion' && 'bg-green-500/20 text-green-400 border border-green-500/30'
          )}
        >
          {finding.severity}
        </span>
      </div>
      <p className="text-sm text-zinc-300 mb-3 leading-relaxed">{finding.description}</p>
      {/* Clickable file path with line number */}
      <button
        onClick={handleOpenFile}
        className="flex items-center gap-1.5 mb-3 group hover:bg-zinc-700/50 rounded px-2 py-1 -ml-2 transition-colors"
      >
        <FileCode className="w-3.5 h-3.5 text-zinc-500 group-hover:text-orange-400 transition-colors" />
        <span className="text-xs text-zinc-500 group-hover:text-orange-400 group-hover:underline transition-colors">
          {finding.file}
          {finding.line && `:${finding.line}`}
          {finding.endLine && finding.endLine !== finding.line && `-${finding.endLine}`}
        </span>
        <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-orange-400 opacity-0 group-hover:opacity-100 transition-all" />
      </button>
      {finding.suggestion && (
        <div className="bg-zinc-900 border border-green-500/30 rounded p-3 mb-3">
          <p className="text-xs text-zinc-400 mb-1 font-medium">Suggested Fix:</p>
          <p className="text-sm text-green-400">{finding.suggestion}</p>
        </div>
      )}

      {/* AI Prompt & Fix Actions (CodeRabbit-style) */}
      {(finding.aiPrompt || finding.codeChange) && !finding.isApplied && (
        <div className="flex items-center gap-2 mt-3">
          {finding.aiPrompt && (
            <button
              onClick={handleCopyPrompt}
              className="flex-1 text-xs px-3 py-2 rounded bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 border border-purple-600/30 transition-colors flex items-center justify-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy AI Prompt
                </>
              )}
            </button>
          )}
          {finding.codeChange && (
            <button
              onClick={handleFixNow}
              className="flex-1 text-xs px-3 py-2 rounded bg-green-600 hover:bg-green-500 text-white transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <Wrench className="w-3.5 h-3.5" />
              Fix Now
            </button>
          )}
        </div>
      )}

      {/* Verification Details (expandable) */}
      {finding.verificationResult && (
        <details className="text-xs mt-3">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-400 mb-2">
            View verification details
          </summary>
          <div className="bg-zinc-900/50 rounded p-3 space-y-1 text-zinc-400">
            <p><span className="text-zinc-500">Verifier:</span> {finding.verificationResult.verifierId}</p>
            <p><span className="text-zinc-500">Reasoning:</span> {finding.verificationResult.reasoning}</p>
          </div>
        </details>
      )}
    </div>
  )
}

// Stage 6: Completed
function CompletedStage({ review, onClose }: { review: any; onClose: () => void }) {
  const totalFindings = review.findings.length
  const appliedFindings = review.findings.filter((f: ReviewFinding) => f.isApplied).length

  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-400">
      <CheckCircle2 className="w-16 h-16 mb-6 text-green-400" />
      <h3 className="text-2xl font-medium text-white mb-2">Review Complete!</h3>
      <p className="text-sm text-zinc-400 mb-6">
        Reviewed {review.files.length} files • {totalFindings} findings • {appliedFindings} applied
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
