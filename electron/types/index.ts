/**
 * Type definitions for the main process
 */

/**
 * A code review finding
 */
export interface Finding {
  file: string
  line: number
  endLine?: number
  column?: number
  severity: 'critical' | 'error' | 'warning' | 'suggestion'
  category?: string
  title?: string
  message?: string
  description?: string
  code?: string
  suggestion?: string
  aiPrompt?: string
  codeChange?: {
    oldCode: string
    newCode: string
  }
  sourceAgents?: string[]
  confidence?: number
  id?: string
  fileId?: string
  verificationStatus?: 'verified' | 'rejected'
  verificationResult?: VerificationResult
}

/**
 * Result of accuracy verification
 */
export interface VerificationResult {
  findingId: string
  isAccurate: boolean
  confidence: number
  reasoning: string
}

/**
 * Options for exec operations
 */
export interface ExecOptions {
  cwd?: string
  encoding?: BufferEncoding
  timeout?: number
  maxBuffer?: number
  env?: NodeJS.ProcessEnv
}

/**
 * Configuration for code review operations
 */
export interface ReviewConfig {
  projectPath: string
  projectId: string
  timeout?: number
}

/**
 * Information about a file being reviewed
 */
export interface FileInfo {
  path: string
  content: string
  diff?: string
  imports?: string[]
}

/**
 * Classification result for a file
 */
export interface FileClassification {
  fileId: string
  file: string
  riskLevel: 'low-risk' | 'high-risk'
  reasoning: string
}

/**
 * Sub-agent review result
 */
export interface SubAgentReview {
  agentId: string
  findings: Finding[]
  timestamp: number
}

/**
 * Error with additional properties from exec
 */
export interface ExecError extends Error {
  code?: number | string
  signal?: string
  killed?: boolean
  cmd?: string
}

/**
 * Helper function to safely extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Type guard to check if error is an ExecError
 */
export function isExecError(error: unknown): error is ExecError {
  return error instanceof Error && ('code' in error || 'signal' in error)
}
