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
}

/**
 * Review Result - Full result of a code review
 */
export interface ReviewResult {
  id: string // Review session ID
  projectId: string // Project being reviewed
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number // Timestamp
  completedAt?: number // Timestamp when finished
  files: string[] // Files that were reviewed
  findings: ReviewFinding[] // All findings
  summary?: string // Overall summary from AI
  error?: string // Error message if failed
  terminalId?: string // Hidden terminal ID running the review
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

  // Config actions
  getConfig: (projectId: string) => ReviewConfig
  updateConfig: (projectId: string, config: Partial<ReviewConfig>) => void
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

export const useReviewStore = create<ReviewState>((set, get) => ({
  reviews: new Map(),
  progress: null,
  isVisible: false,
  activeReviewId: null,
  selectedFindingId: null,
  configs: new Map(),

  startReview: (projectId, files, existingReviewId) => {
    const reviewId = existingReviewId || `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const review: ReviewResult = {
      id: reviewId,
      projectId,
      status: 'running',
      startedAt: Date.now(),
      files,
      findings: [],
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
          message: 'Analyzing code...',
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
}))
