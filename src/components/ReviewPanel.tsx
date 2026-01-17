import { X, AlertTriangle, AlertCircle, Info, Lightbulb, FileCode, ChevronDown, ChevronRight, Loader2, Terminal } from 'lucide-react'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useReviewStore, type ReviewFinding } from '../stores/review-store'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { cn } from '../lib/utils'

interface ReviewPanelProps {
  projectPath: string
}

function getSeverityIcon(severity: ReviewFinding['severity']) {
  switch (severity) {
    case 'critical':
      return { Icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' }
    case 'warning':
      return { Icon: AlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/10' }
    case 'info':
      return { Icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' }
    case 'suggestion':
      return { Icon: Lightbulb, color: 'text-green-400', bg: 'bg-green-500/10' }
  }
}


export function ReviewPanel({ projectPath }: ReviewPanelProps) {
  const { reviews, activeReviewId, isVisible, setVisibility, progress, setSelectedFinding, selectedFindingId } = useReviewStore()
  const { openFile, setShowDiff } = useFileViewerStore()
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Critical', 'Warning']))
  const [showRawOutput, setShowRawOutput] = useState(false)
  const [rawBuffer, setRawBuffer] = useState<string | null>(null)
  const [bufferLoading, setBufferLoading] = useState(false)

  // Fetch raw output when requested
  useEffect(() => {
    if (showRawOutput && activeReviewId && window.electron) {
      setBufferLoading(true)
      window.electron.review.getBuffer(activeReviewId).then((result) => {
        if (result.success && result.buffer) {
          setRawBuffer(result.buffer)
        } else {
          setRawBuffer(`Failed to get buffer: ${result.error || 'Unknown error'}`)
        }
        setBufferLoading(false)
      })
    }
  }, [showRawOutput, activeReviewId])

  if (!isVisible || !activeReviewId) return null

  const review = reviews.get(activeReviewId)
  if (!review) return null

  // Group findings by category
  const findingsByCategory = review.findings.reduce((acc, finding) => {
    const cat = finding.category || 'General'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(finding)
    return acc
  }, {} as Record<string, ReviewFinding[]>)

  // Sort categories by severity (critical first)
  const sortedCategories = Object.keys(findingsByCategory).sort((a, b) => {
    const aSeverity = findingsByCategory[a]?.[0]?.severity
    const bSeverity = findingsByCategory[b]?.[0]?.severity
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2, suggestion: 3 }
    return (aSeverity ? order[aSeverity] ?? 4 : 4) - (bSeverity ? order[bSeverity] ?? 4 : 4)
  })

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev)
      if (newSet.has(category)) {
        newSet.delete(category)
      } else {
        newSet.add(category)
      }
      return newSet
    })
  }

  const handleOpenFinding = async (finding: ReviewFinding) => {
    if (!window.electron) return

    setSelectedFinding(finding.id)

    const separator = projectPath.includes('\\') ? '\\' : '/'
    const fullPath = `${projectPath}${separator}${finding.file}`.replace(/\/\//g, '/').replace(/\\\\/g, '\\')
    const fileName = finding.file.split('/').pop() || finding.file

    const result = await window.electron.fs.readFile(fullPath)
    if (result.success && result.content !== undefined) {
      openFile(fullPath, fileName, result.content, projectPath)
      setShowDiff(true)
    }
  }

  // Count findings by severity
  const severityCounts = review.findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-[700px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-white">Code Review Results</h2>
            {review.status === 'running' && (
              <div className="flex items-center gap-2 text-xs text-purple-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                {progress?.message || 'Reviewing...'}
              </div>
            )}
            {review.status === 'completed' && (
              <div className="flex items-center gap-2">
                {severityCounts.critical && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">
                    {severityCounts.critical} critical
                  </span>
                )}
                {severityCounts.warning && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded">
                    {severityCounts.warning} warnings
                  </span>
                )}
                {severityCounts.info && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded">
                    {severityCounts.info} info
                  </span>
                )}
                {severityCounts.suggestion && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded">
                    {severityCounts.suggestion} suggestions
                  </span>
                )}
              </div>
            )}
            {review.status === 'failed' && (
              <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">
                Failed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRawOutput(!showRawOutput)}
              className={cn(
                'p-1 rounded text-zinc-400 hover:text-white transition-colors',
                showRawOutput ? 'bg-zinc-700 text-white' : 'hover:bg-zinc-700'
              )}
              title="Show raw terminal output"
            >
              <Terminal className="w-4 h-4" />
            </button>
            <button
              onClick={() => setVisibility(false)}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Raw Output View */}
          {showRawOutput && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500 uppercase">Raw Terminal Output</span>
                <button
                  onClick={() => setShowRawOutput(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Hide
                </button>
              </div>
              <div className="bg-black rounded-lg border border-zinc-700 p-3 max-h-[300px] overflow-auto">
                {bufferLoading ? (
                  <div className="flex items-center gap-2 text-zinc-500 text-xs">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading...
                  </div>
                ) : rawBuffer ? (
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono">
                    {rawBuffer}
                  </pre>
                ) : (
                  <p className="text-xs text-zinc-500">No output captured yet</p>
                )}
              </div>
            </div>
          )}

          {review.status === 'failed' && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{review.error || 'Review failed'}</p>
            </div>
          )}

          {review.status === 'running' && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-purple-400" />
              <p className="text-sm">Analyzing {review.files.length} file{review.files.length !== 1 ? 's' : ''}...</p>
              {progress && (
                <p className="text-xs mt-2 text-zinc-600">
                  {progress.currentFile && `Current: ${progress.currentFile}`}
                </p>
              )}
            </div>
          )}

          {review.status === 'completed' && review.findings.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                <Lightbulb className="w-6 h-6 text-green-400" />
              </div>
              <p className="text-sm text-zinc-300">No issues found!</p>
              <p className="text-xs mt-1">Your code looks good.</p>
            </div>
          )}

          {review.status === 'completed' && review.findings.length > 0 && (
            <div className="space-y-2">
              {sortedCategories.map(category => {
                const findings = findingsByCategory[category] || []
                if (findings.length === 0) return null
                const isExpanded = expandedCategories.has(category)
                const firstFinding = findings[0]
                const highestSeverity = firstFinding?.severity || 'info'

                return (
                  <div key={category} className="border border-zinc-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-zinc-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-zinc-500" />
                      )}
                      <span className="text-sm text-zinc-300 flex-1">{category}</span>
                      <span className={cn(
                        'text-xs px-1.5 py-0.5 rounded',
                        getSeverityIcon(highestSeverity).bg,
                        getSeverityIcon(highestSeverity).color
                      )}>
                        {findings.length}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="divide-y divide-zinc-700/50">
                        {findings.map(finding => {
                          const { Icon, color, bg } = getSeverityIcon(finding.severity)
                          const isSelected = selectedFindingId === finding.id

                          return (
                            <button
                              key={finding.id}
                              onClick={() => handleOpenFinding(finding)}
                              className={cn(
                                'w-full text-left px-3 py-2 hover:bg-zinc-800/50 transition-colors',
                                isSelected && 'bg-purple-500/10 border-l-2 border-purple-500'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <div className={cn('p-1 rounded mt-0.5', bg)}>
                                  <Icon className={cn('w-3 h-3', color)} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-zinc-200 font-medium truncate">
                                      {finding.title}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <FileCode className="w-3 h-3 text-zinc-500" />
                                    <span className="text-xs text-zinc-500 truncate">
                                      {finding.file}
                                      {finding.line && `:${finding.line}`}
                                    </span>
                                  </div>
                                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                                    {finding.description}
                                  </p>
                                  {finding.suggestion && (
                                    <p className="text-xs text-green-400/70 mt-1 line-clamp-1">
                                      Suggestion: {finding.suggestion}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-700 bg-zinc-800/50">
          <div className="text-xs text-zinc-500">
            {review.status === 'completed' && (
              <>
                Reviewed {review.files.length} file{review.files.length !== 1 ? 's' : ''} •{' '}
                {new Date(review.completedAt!).toLocaleTimeString()}
              </>
            )}
          </div>
          <button
            onClick={() => setVisibility(false)}
            className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
