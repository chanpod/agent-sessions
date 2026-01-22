/**
 * Code Review Service
 *
 * Pure utility functions for parsing and processing code review findings.
 * These functions are extracted from the main.ts review handler to enable
 * testing and reuse.
 */

import type { Finding, SubAgentReview } from '../types/index.js'

/**
 * Review stage status for tracking progress
 */
export interface ReviewStage {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
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
 * Verification result from accuracy checker
 */
export interface VerificationEntry {
  index: number
  status: 'verified' | 'rejected'
}

/**
 * Parse findings from Claude's JSON output string.
 * Handles various edge cases including wrapped JSON, markdown code blocks,
 * and malformed output.
 *
 * @param output - Raw string output from Claude
 * @returns Array of parsed findings, or empty array if parsing fails
 */
export function parseFindings(output: string): Finding[] {
  if (!output || typeof output !== 'string') {
    return []
  }

  // Trim whitespace
  let cleaned = output.trim()

  // Remove markdown code block wrappers if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }

  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }

  cleaned = cleaned.trim()

  // Handle empty output
  if (!cleaned) {
    return []
  }

  // Try to find JSON array in the output
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    cleaned = arrayMatch[0]
  }

  try {
    const parsed = JSON.parse(cleaned)

    // Ensure we have an array
    if (!Array.isArray(parsed)) {
      // If it's a single finding object, wrap it
      if (typeof parsed === 'object' && parsed !== null && 'file' in parsed) {
        const validated = validateFinding(parsed)
        return validated ? [validated] : []
      }
      return []
    }

    // Validate and filter findings
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(validateFinding)
      .filter((f): f is Finding => f !== null)
  } catch {
    return []
  }
}

/**
 * Validate and normalize a finding object.
 * Ensures required fields are present with correct types.
 *
 * @param obj - Raw object that might be a finding
 * @returns Validated Finding or null if invalid
 */
function validateFinding(obj: Record<string, unknown>): Finding | null {
  // Required: file and line
  if (typeof obj.file !== 'string' || !obj.file) {
    return null
  }

  const line = typeof obj.line === 'number' ? obj.line : parseInt(String(obj.line), 10)
  if (isNaN(line) || line < 1) {
    return null
  }

  // Validate severity
  const validSeverities = ['critical', 'error', 'warning', 'suggestion']
  const severity =
    typeof obj.severity === 'string' && validSeverities.includes(obj.severity)
      ? (obj.severity as Finding['severity'])
      : 'warning'

  const finding: Finding = {
    file: obj.file,
    line,
    severity
  }

  // Optional fields
  if (typeof obj.endLine === 'number') {
    finding.endLine = obj.endLine
  }

  if (typeof obj.column === 'number') {
    finding.column = obj.column
  }

  if (typeof obj.category === 'string') {
    finding.category = obj.category
  }

  if (typeof obj.title === 'string') {
    finding.title = obj.title
  }

  if (typeof obj.message === 'string') {
    finding.message = obj.message
  }

  if (typeof obj.description === 'string') {
    finding.description = obj.description
  }

  if (typeof obj.code === 'string') {
    finding.code = obj.code
  }

  if (typeof obj.suggestion === 'string') {
    finding.suggestion = obj.suggestion
  }

  if (typeof obj.aiPrompt === 'string') {
    finding.aiPrompt = obj.aiPrompt
  }

  if (typeof obj.confidence === 'number') {
    finding.confidence = obj.confidence
  }

  if (typeof obj.id === 'string') {
    finding.id = obj.id
  }

  if (Array.isArray(obj.sourceAgents)) {
    finding.sourceAgents = obj.sourceAgents.filter((a): a is string => typeof a === 'string')
  }

  // Handle codeChange
  if (
    typeof obj.codeChange === 'object' &&
    obj.codeChange !== null &&
    typeof (obj.codeChange as Record<string, unknown>).oldCode === 'string' &&
    typeof (obj.codeChange as Record<string, unknown>).newCode === 'string'
  ) {
    finding.codeChange = {
      oldCode: (obj.codeChange as Record<string, unknown>).oldCode as string,
      newCode: (obj.codeChange as Record<string, unknown>).newCode as string
    }
  }

  return finding
}

/**
 * Consolidate findings from multiple sub-agent reviews.
 * Deduplicates findings that reference the same issue (same file + line + similar title/category).
 *
 * @param subAgentResults - Array of sub-agent review results
 * @returns Deduplicated array of findings with source agent tracking
 */
export function consolidateFindings(subAgentResults: SubAgentReview[]): Finding[] {
  if (!Array.isArray(subAgentResults) || subAgentResults.length === 0) {
    return []
  }

  // Map to track unique findings by key
  const findingsMap = new Map<string, Finding>()

  for (const review of subAgentResults) {
    if (!review || !Array.isArray(review.findings)) {
      continue
    }

    for (const finding of review.findings) {
      if (!finding || typeof finding.file !== 'string' || typeof finding.line !== 'number') {
        continue
      }

      // Create a key for deduplication
      // Use file + line + normalized category/title
      const normalizedCategory = (finding.category || '').toLowerCase().trim()
      const normalizedTitle = (finding.title || '').toLowerCase().trim()
      const key = `${finding.file}:${finding.line}:${normalizedCategory}:${normalizedTitle}`

      const existing = findingsMap.get(key)
      if (existing) {
        // Merge source agents
        const agents = new Set(existing.sourceAgents || [])
        if (review.agentId) {
          agents.add(review.agentId)
        }
        existing.sourceAgents = Array.from(agents)

        // Update confidence based on agent agreement
        existing.confidence = calculateConfidence(existing.sourceAgents.length)

        // Keep the more detailed description
        if (
          finding.description &&
          (!existing.description || finding.description.length > existing.description.length)
        ) {
          existing.description = finding.description
        }

        // Keep suggestion if not present
        if (finding.suggestion && !existing.suggestion) {
          existing.suggestion = finding.suggestion
        }

        // Keep aiPrompt if not present
        if (finding.aiPrompt && !existing.aiPrompt) {
          existing.aiPrompt = finding.aiPrompt
        }

        // Keep codeChange if not present
        if (finding.codeChange && !existing.codeChange) {
          existing.codeChange = finding.codeChange
        }
      } else {
        // Add new finding
        const newFinding: Finding = {
          ...finding,
          sourceAgents: review.agentId ? [review.agentId] : [],
          confidence: calculateConfidence(1)
        }
        findingsMap.set(key, newFinding)
      }
    }
  }

  return Array.from(findingsMap.values())
}

/**
 * Calculate confidence score based on number of agreeing agents.
 *
 * @param agentCount - Number of agents that reported the finding
 * @returns Confidence score between 0 and 1
 */
function calculateConfidence(agentCount: number): number {
  switch (agentCount) {
    case 3:
      return 1.0
    case 2:
      return 0.85
    case 1:
      return 0.65
    default:
      return agentCount > 3 ? 1.0 : 0.5
  }
}

/**
 * Filter findings based on verification results.
 * Only keeps findings that have been verified as accurate.
 *
 * @param findings - Array of findings to filter
 * @param verificationResults - Array of verification entries with index and status
 * @returns Array of findings that passed verification
 */
export function filterVerifiedFindings(
  findings: Finding[],
  verificationResults: VerificationEntry[]
): Finding[] {
  if (!Array.isArray(findings) || findings.length === 0) {
    return []
  }

  if (!Array.isArray(verificationResults) || verificationResults.length === 0) {
    // If no verification results, return all findings (or none depending on policy)
    // Default: return empty (require explicit verification)
    return []
  }

  // Create a set of verified indices for O(1) lookup
  const verifiedIndices = new Set<number>()
  for (const result of verificationResults) {
    if (
      typeof result === 'object' &&
      result !== null &&
      typeof result.index === 'number' &&
      result.status === 'verified'
    ) {
      verifiedIndices.add(result.index)
    }
  }

  // Filter findings by verified indices
  return findings
    .map((finding, index) => {
      if (verifiedIndices.has(index)) {
        return {
          ...finding,
          verificationStatus: 'verified' as const
        }
      }
      return null
    })
    .filter((f): f is Finding => f !== null)
}

/**
 * Generate a unique finding ID based on review context.
 *
 * @param reviewId - The review session ID
 * @param fileIndex - Index of the file being reviewed
 * @param findingIndex - Index of the finding within the file
 * @returns Unique finding ID string
 */
export function generateFindingId(reviewId: string, fileIndex: number, findingIndex: number): string {
  return `${reviewId}-highrisk-${fileIndex}-${findingIndex}`
}
