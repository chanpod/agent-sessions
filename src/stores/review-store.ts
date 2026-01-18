import { create } from 'zustand'

/**
 * Review Finding - Individual issue found by the review
 */
export interface ReviewFinding {
  id: string // Unique ID for this finding
  file: string // Relative file path
  line?: number // Line number (optional)
  endLine?: number // End line for multi-line issues
  severity: 'critical' | 'warning' | 'info' | 'suggestion'
  category: string // e.g., "Bug", "Performance", "Security", "Style"
  title: string // Short title
  description: string // Detailed description
  suggestion?: string // Optional fix suggestion

  // UI state
  isSelected?: boolean // For checkbox selection
  isApplied?: boolean // Already applied to code
  isDismissed?: boolean // User dismissed this finding

  // Multi-agent specific
  sourceAgents?: string[] // Which agents found this (multi-agent)
  confidence?: number // Confidence score (multi-agent)
  verificationStatus?: 'verified' | 'rejected' // Accuracy verification

  // For code changes
  codeChange?: {
    oldCode: string
    newCode: string
  }

  // Cache metadata
  isCached?: boolean // Whether this finding came from cache
}

/**
 * Per-File Review Cache
 */
export interface FileReviewCache {
  file: string // File path
  diffHash: string // Hash of this file's git diff
  classification?: FileClassification // Risk classification
  findings: ReviewFinding[] // Findings for this file
  reviewedAt: number // Timestamp when reviewed
  projectId: string // Which project this belongs to
}

/**
 * File Risk Level
 */
export type FileRiskLevel = 'inconsequential' | 'high-risk'

/**
 * File Classification
 */
export interface FileClassification {
  file: string
  riskLevel: FileRiskLevel
  reasoning: string
}

/**
 * Review Stage
 */
export type ReviewStage =
  | 'classifying'
  | 'classification-review'
  | 'reviewing-inconsequential'
  | 'reviewing-high-risk'
  | 'completed'

/**
 * Review Result - Full result of a code review
 */
export interface ReviewResult {
  id: string // Review session ID
  projectId: string // Project being reviewed
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: ReviewStage // Current stage in multi-stage review
  startedAt: number // Timestamp
  completedAt?: number // Timestamp when finished
  files: string[] // Files that were reviewed
  findings: ReviewFinding[] // All findings
  summary?: string // Overall summary from AI
  error?: string // Error message if failed
  terminalId?: string // Hidden terminal ID running the review

  // Multi-stage specific
  classifications?: FileClassification[] // Risk classifications
  inconsequentialFiles: string[] // Low-risk files
  highRiskFiles: string[] // High-risk files
  inconsequentialFindings: ReviewFinding[] // Findings from low-risk review
  highRiskFindings: ReviewFinding[] // Findings from high-risk review
  currentHighRiskFileIndex: number // Which high-risk file we're on
  currentFileCoordinatorStatus?: 'reviewing' | 'coordinating' | 'verifying' | 'complete'
}

/**
 * Review Progress - Live progress updates during review
 */
export interface ReviewProgress {
  currentFile?: string
  fileIndex: number
  totalFiles: number
  message: string
}

/**
 * Review Configuration - Per-project settings
 */
export interface ReviewConfig {
  enabled: boolean
  command: string // Command to run (e.g., "claude", "coderabbit")
  promptTemplate: string // Prompt template with {{files}} placeholder
  autoReviewOnCommit: boolean // Auto-trigger on commit attempt
  fileTypes: string[] // File extensions to include (e.g., [".ts", ".tsx"])
  maxFiles: number // Max files to review at once
}

interface ReviewState {
  // Active reviews by project ID
  reviews: Map<string, ReviewResult>

  // Current progress for active review
  progress: ReviewProgress | null

  // UI state
  isVisible: boolean // Whether review panel is shown
  activeReviewId: string | null // Which review is currently displayed
  selectedFindingId: string | null // Which finding is selected

  // Review configurations by project ID
  configs: Map<string, ReviewConfig>

  // Per-file review cache: key is "projectId:file:diffHash"
  fileReviewCache: Map<string, FileReviewCache>

  // Actions
  startReview: (projectId: string, files: string[], reviewId?: string) => string // Returns review ID
  setReviewRunning: (reviewId: string) => void
  updateProgress: (progress: ReviewProgress) => void
  completeReview: (reviewId: string, findings: ReviewFinding[], summary?: string) => void
  failReview: (reviewId: string, error: string) => void
  cancelReview: (reviewId: string) => void
  setActiveReview: (reviewId: string | null) => void
  setSelectedFinding: (findingId: string | null) => void
  toggleVisibility: () => void
  setVisibility: (visible: boolean) => void
  clearReview: (reviewId: string) => void

  // Multi-stage actions
  setClassifications: (reviewId: string, classifications: FileClassification[]) => void
  updateClassification: (reviewId: string, file: string, riskLevel: FileRiskLevel) => void
  confirmClassifications: (reviewId: string) => void
  setReviewStage: (reviewId: string, stage: ReviewStage) => void
  setInconsequentialFindings: (reviewId: string, findings: ReviewFinding[]) => void
  addHighRiskFindings: (reviewId: string, findings: ReviewFinding[]) => void
  toggleFindingSelection: (reviewId: string, findingId: string) => void
  selectAllFindings: (reviewId: string) => void
  applySelectedFindings: (reviewId: string) => void
  applyFinding: (reviewId: string, findingId: string) => void
  dismissFinding: (reviewId: string, findingId: string) => void
  advanceToNextHighRiskFile: (reviewId: string) => void
  updateHighRiskStatus: (reviewId: string, status: string) => void

  // Config actions
  getConfig: (projectId: string) => ReviewConfig
  updateConfig: (projectId: string, config: Partial<ReviewConfig>) => void

  // Cache actions
  getCachedFileReview: (projectId: string, file: string, diffHash: string) => FileReviewCache | null
  setCachedFileReview: (cache: FileReviewCache) => void
  clearExpiredCache: (maxAgeMs: number) => void
  loadCacheFromStorage: () => void
  saveCacheToStorage: () => void
}

// Default configuration
const DEFAULT_CONFIG: ReviewConfig = {
  enabled: true,
  command: 'claude',
  promptTemplate: `Review the following code changes for issues. Output a JSON array of findings.

Each finding must have these fields:
- file: the relative file path
- line: line number (optional)
- severity: one of "critical", "warning", "info", or "suggestion"
- category: e.g. "Bug", "Security", "Performance", "Style"
- title: short description
- description: detailed explanation
- suggestion: how to fix (optional)

Example output format:
\`\`\`json
[{"file": "src/app.ts", "line": 10, "severity": "warning", "category": "Bug", "title": "Null check missing", "description": "Variable may be null", "suggestion": "Add null check"}]
\`\`\`

Check for: bugs, security issues, performance problems, code quality.

Files to review:
{{files}}

Output ONLY a JSON array. If no issues, output: []`,
  autoReviewOnCommit: false,
  fileTypes: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb'],
  maxFiles: 50,
}

// Cache storage key
const CACHE_STORAGE_KEY = 'review-file-cache'
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days

export const useReviewStore = create<ReviewState>((set, get) => ({
  reviews: new Map(),
  progress: null,
  isVisible: false,
  activeReviewId: null,
  selectedFindingId: null,
  configs: new Map(),
  fileReviewCache: new Map(),

  startReview: (projectId, files, existingReviewId) => {
    const reviewId = existingReviewId || `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const review: ReviewResult = {
      id: reviewId,
      projectId,
      status: 'running',
      stage: 'classifying',
      startedAt: Date.now(),
      files,
      findings: [],
      inconsequentialFiles: [],
      highRiskFiles: [],
      inconsequentialFindings: [],
      highRiskFindings: [],
      currentHighRiskFileIndex: 0,
    }

    set((state) => {
      const newReviews = new Map(state.reviews)
      newReviews.set(reviewId, review)
      return {
        reviews: newReviews,
        activeReviewId: reviewId,
        isVisible: true,
        progress: {
          fileIndex: 0,
          totalFiles: files.length,
          message: 'Classifying files by risk level...',
        },
      }
    })

    return reviewId
  },

  setReviewRunning: (reviewId) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review && review.status === 'pending') {
        newReviews.set(reviewId, {
          ...review,
          status: 'running',
        })
      }
      return { reviews: newReviews }
    })
  },

  updateProgress: (progress) => {
    set({ progress })
  },

  completeReview: (reviewId, findings, summary) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          status: 'completed',
          completedAt: Date.now(),
          findings,
          summary,
        })
      }
      return {
        reviews: newReviews,
        progress: null,
      }
    })
  },

  failReview: (reviewId, error) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          status: 'failed',
          completedAt: Date.now(),
          error,
        })
      }
      return {
        reviews: newReviews,
        progress: null,
      }
    })
  },

  cancelReview: (reviewId) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          status: 'cancelled',
          completedAt: Date.now(),
        })
      }
      return {
        reviews: newReviews,
        progress: null,
      }
    })
  },

  setActiveReview: (reviewId) => {
    set({ activeReviewId: reviewId, isVisible: !!reviewId })
  },

  setSelectedFinding: (findingId) => {
    set({ selectedFindingId: findingId })
  },

  toggleVisibility: () => {
    set((state) => ({ isVisible: !state.isVisible }))
  },

  setVisibility: (visible) => {
    set({ isVisible: visible })
  },

  clearReview: (reviewId) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      newReviews.delete(reviewId)
      return {
        reviews: newReviews,
        activeReviewId: state.activeReviewId === reviewId ? null : state.activeReviewId,
        isVisible: state.activeReviewId === reviewId ? false : state.isVisible,
      }
    })
  },

  getConfig: (projectId) => {
    const { configs } = get()
    return configs.get(projectId) || DEFAULT_CONFIG
  },

  updateConfig: (projectId, configUpdate) => {
    set((state) => {
      const newConfigs = new Map(state.configs)
      const currentConfig = newConfigs.get(projectId) || DEFAULT_CONFIG
      newConfigs.set(projectId, { ...currentConfig, ...configUpdate })
      return { configs: newConfigs }
    })
  },

  // Multi-stage implementation
  setClassifications: (reviewId, classifications) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          classifications,
          stage: 'classification-review',
        })
      }
      return { reviews: newReviews }
    })
  },

  updateClassification: (reviewId, file, riskLevel) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review && review.classifications) {
        const newClassifications = review.classifications.map((c) =>
          c.file === file ? { ...c, riskLevel } : c
        )
        newReviews.set(reviewId, {
          ...review,
          classifications: newClassifications,
        })
      }
      return { reviews: newReviews }
    })
  },

  confirmClassifications: (reviewId) => {
    const { reviews } = get()
    const review = reviews.get(reviewId)
    if (!review || !review.classifications) return

    // Split files into inconsequential and high-risk
    const inconsequentialFiles = review.classifications
      .filter((c) => c.riskLevel === 'inconsequential')
      .map((c) => c.file)
    const highRiskFiles = review.classifications
      .filter((c) => c.riskLevel === 'high-risk')
      .map((c) => c.file)

    set((state) => {
      const newReviews = new Map(state.reviews)
      newReviews.set(reviewId, {
        ...review,
        stage: 'reviewing-inconsequential',
        inconsequentialFiles,
        highRiskFiles,
      })
      return { reviews: newReviews }
    })

    // Trigger inconsequential review via IPC
    if (window.electron) {
      window.electron.review.startInconsequentialReview(reviewId, inconsequentialFiles, highRiskFiles)
    }
  },

  setReviewStage: (reviewId, stage) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          stage,
        })
      }
      return { reviews: newReviews }
    })
  },

  setInconsequentialFindings: (reviewId, findings) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          inconsequentialFindings: findings,
        })
      }
      return { reviews: newReviews }
    })
  },

  addHighRiskFindings: (reviewId, findings) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          highRiskFindings: [...review.highRiskFindings, ...findings],
        })
      }
      return { reviews: newReviews }
    })
  },

  toggleFindingSelection: (reviewId, findingId) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        const newFindings = review.inconsequentialFindings.map((f) =>
          f.id === findingId ? { ...f, isSelected: !f.isSelected } : f
        )
        newReviews.set(reviewId, {
          ...review,
          inconsequentialFindings: newFindings,
        })
      }
      return { reviews: newReviews }
    })
  },

  selectAllFindings: (reviewId) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        const allSelected = review.inconsequentialFindings.every((f) => f.isSelected)
        const newFindings = review.inconsequentialFindings.map((f) => ({
          ...f,
          isSelected: !allSelected,
        }))
        newReviews.set(reviewId, {
          ...review,
          inconsequentialFindings: newFindings,
        })
      }
      return { reviews: newReviews }
    })
  },

  applySelectedFindings: async (reviewId) => {
    const { reviews } = get()
    const review = reviews.get(reviewId)
    if (!review) return

    const selectedFindings = review.inconsequentialFindings.filter((f) => f.isSelected && !f.isApplied)

    // Apply each finding via IPC
    for (const finding of selectedFindings) {
      if (finding.codeChange && window.electron) {
        try {
          // Use BackgroundClaudeManager to apply the code change
          const projectPath = review.projectId
          const fullPath = `${projectPath}/${finding.file}`

          // Read current file content
          const result = await window.electron.fs.readFile(fullPath)
          if (result.success && result.content) {
            // Replace old code with new code
            const newContent = result.content.replace(finding.codeChange.oldCode, finding.codeChange.newCode)

            // Write back to file
            await window.electron.fs.writeFile(fullPath, newContent)
            console.log('[ReviewStore] Applied finding:', finding.id)
          }
        } catch (error) {
          console.error('[ReviewStore] Failed to apply finding:', finding.id, error)
        }
      }
    }

    // Mark applied findings
    set((state) => {
      const newReviews = new Map(state.reviews)
      const newFindings = review.inconsequentialFindings.map((f) =>
        f.isSelected && !f.isApplied ? { ...f, isApplied: true, isSelected: false } : f
      )
      newReviews.set(reviewId, {
        ...review,
        inconsequentialFindings: newFindings,
      })
      return { reviews: newReviews }
    })
  },

  applyFinding: async (reviewId, findingId) => {
    const { reviews } = get()
    const review = reviews.get(reviewId)
    if (!review) return

    const finding = review.inconsequentialFindings.find((f) => f.id === findingId)
    if (!finding || finding.isApplied || !finding.codeChange) return

    // Apply the fix to the file
    if (window.electron) {
      try {
        const projectPath = review.projectId
        const fullPath = `${projectPath}/${finding.file}`

        // Read current file content
        const result = await window.electron.fs.readFile(fullPath)
        if (result.success && result.content) {
          // Replace old code with new code
          const newContent = result.content.replace(finding.codeChange.oldCode, finding.codeChange.newCode)

          // Write back to file
          await window.electron.fs.writeFile(fullPath, newContent)
          console.log('[ReviewStore] Applied finding:', finding.id)
        }
      } catch (error) {
        console.error('[ReviewStore] Failed to apply finding:', finding.id, error)
      }
    }

    // Mark finding as applied
    set((state) => {
      const newReviews = new Map(state.reviews)
      const newFindings = review.inconsequentialFindings.map((f) =>
        f.id === findingId ? { ...f, isApplied: true } : f
      )
      newReviews.set(reviewId, {
        ...review,
        inconsequentialFindings: newFindings,
      })
      return { reviews: newReviews }
    })
  },

  dismissFinding: (reviewId, findingId) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        const newFindings = review.inconsequentialFindings.map((f) =>
          f.id === findingId ? { ...f, isDismissed: true } : f
        )
        newReviews.set(reviewId, {
          ...review,
          inconsequentialFindings: newFindings,
        })
      }
      return { reviews: newReviews }
    })
  },

  advanceToNextHighRiskFile: (reviewId) => {
    const { reviews } = get()
    const review = reviews.get(reviewId)
    if (!review) return

    const nextIndex = review.currentHighRiskFileIndex + 1
    if (nextIndex >= review.highRiskFiles.length) {
      // All high-risk files reviewed, mark as complete
      set((state) => {
        const newReviews = new Map(state.reviews)
        newReviews.set(reviewId, {
          ...review,
          stage: 'completed',
          status: 'completed',
          completedAt: Date.now(),
        })
        return { reviews: newReviews }
      })
    } else {
      // Move to next file
      set((state) => {
        const newReviews = new Map(state.reviews)
        newReviews.set(reviewId, {
          ...review,
          currentHighRiskFileIndex: nextIndex,
        })
        return { reviews: newReviews }
      })

      // Trigger next high-risk file review via IPC
      if (window.electron) {
        window.electron.review.reviewHighRiskFile(reviewId)
      }
    }
  },

  updateHighRiskStatus: (reviewId, status) => {
    set((state) => {
      const newReviews = new Map(state.reviews)
      const review = newReviews.get(reviewId)
      if (review) {
        newReviews.set(reviewId, {
          ...review,
          currentFileCoordinatorStatus: status as any,
        })
      }
      return { reviews: newReviews }
    })
  },

  // Cache actions
  getCachedFileReview: (projectId, file, diffHash) => {
    const { fileReviewCache } = get()
    const key = `${projectId}:${file}:${diffHash}`
    const cached = fileReviewCache.get(key)

    if (!cached) return null

    // Check if cache is expired
    if (Date.now() - cached.reviewedAt > CACHE_MAX_AGE) {
      // Remove expired cache
      set((state) => {
        const newCache = new Map(state.fileReviewCache)
        newCache.delete(key)
        return { fileReviewCache: newCache }
      })
      return null
    }

    console.log('[ReviewStore] Cache hit for', file, 'hash:', diffHash.slice(0, 8))
    return cached
  },

  setCachedFileReview: (cache) => {
    const key = `${cache.projectId}:${cache.file}:${cache.diffHash}`
    console.log('[ReviewStore] Caching review for', cache.file, 'hash:', cache.diffHash.slice(0, 8))

    set((state) => {
      const newCache = new Map(state.fileReviewCache)
      newCache.set(key, cache)
      return { fileReviewCache: newCache }
    })

    // Auto-save to storage
    get().saveCacheToStorage()
  },

  clearExpiredCache: (maxAgeMs) => {
    const now = Date.now()
    set((state) => {
      const newCache = new Map(state.fileReviewCache)
      let removed = 0

      for (const [key, cache] of newCache.entries()) {
        if (now - cache.reviewedAt > maxAgeMs) {
          newCache.delete(key)
          removed++
        }
      }

      if (removed > 0) {
        console.log('[ReviewStore] Cleared', removed, 'expired cache entries')
      }

      return { fileReviewCache: newCache }
    })

    // Auto-save after cleanup
    get().saveCacheToStorage()
  },

  loadCacheFromStorage: () => {
    try {
      const stored = localStorage.getItem(CACHE_STORAGE_KEY)
      if (!stored) return

      const parsed = JSON.parse(stored) as Array<[string, FileReviewCache]>
      const newCache = new Map(parsed)

      console.log('[ReviewStore] Loaded', newCache.size, 'cached reviews from storage')
      set({ fileReviewCache: newCache })

      // Clean up expired entries on load
      get().clearExpiredCache(CACHE_MAX_AGE)
    } catch (error) {
      console.error('[ReviewStore] Failed to load cache from storage:', error)
    }
  },

  saveCacheToStorage: () => {
    try {
      const { fileReviewCache } = get()
      const serialized = JSON.stringify(Array.from(fileReviewCache.entries()))
      localStorage.setItem(CACHE_STORAGE_KEY, serialized)
      console.log('[ReviewStore] Saved', fileReviewCache.size, 'cached reviews to storage')
    } catch (error) {
      console.error('[ReviewStore] Failed to save cache to storage:', error)
    }
  },
}))
