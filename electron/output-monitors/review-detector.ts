/**
 * ReviewDetector - Detects and parses code review output from AI tools
 * Watches for JSON-formatted review results and emits structured findings
 */

import { OutputDetector, DetectedEvent } from './output-detector'

export interface ReviewFinding {
  file: string
  line?: number
  endLine?: number
  severity: 'critical' | 'warning' | 'info' | 'suggestion'
  category: string
  title: string
  description: string
  suggestion?: string
}

interface TerminalReviewState {
  buffer: string // Accumulated output buffer
  reviewId: string | null // Active review session ID
  isCapturing: boolean // Whether we're actively capturing review output
  hasEmittedResults: boolean // Prevent duplicate emissions
}

// Strip ANSI codes for cleaner parsing
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

export class ReviewDetector implements OutputDetector {
  readonly id = 'review-detector'

  private terminalStates: Map<string, TerminalReviewState> = new Map()
  // Keep completed review buffers around for debugging (keyed by reviewId)
  private completedBuffers: Map<string, string> = new Map()

  // Patterns to detect start of JSON output
  private readonly jsonStartPatterns = [
    /^\s*\[/m, // Array start
    /```json\s*\n\s*\[/m, // Markdown code block with json
  ]

  // Pattern to detect end of JSON array
  private readonly jsonEndPattern = /\]\s*(?:```)?$/m

  /**
   * Register a terminal as actively running a review
   */
  registerReview(terminalId: string, reviewId: string): void {
    const state = this.getOrCreateState(terminalId)
    state.reviewId = reviewId
    state.isCapturing = true
    state.hasEmittedResults = false
    state.buffer = ''
    console.log(`[ReviewDetector] Registered review ${reviewId} for terminal ${terminalId}`)
  }

  processOutput(terminalId: string, data: string): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.terminalStates.get(terminalId)

    // Only process if we have an active review
    if (!state || !state.isCapturing || !state.reviewId) {
      return events
    }

    const cleanData = stripAnsi(data)
    state.buffer += cleanData

    // Keep buffer manageable (max 500KB)
    if (state.buffer.length > 500000) {
      state.buffer = state.buffer.slice(-500000)
    }

    // Try to extract JSON findings
    const findings = this.extractFindings(state.buffer)
    if (findings !== null && !state.hasEmittedResults) {
      state.hasEmittedResults = true
      state.isCapturing = false

      // Save buffer for debugging before cleanup
      this.completedBuffers.set(state.reviewId, state.buffer)

      events.push({
        terminalId,
        type: 'review-completed',
        timestamp: Date.now(),
        data: {
          reviewId: state.reviewId,
          findings,
        },
      })
      console.log(`[ReviewDetector] Emitted ${findings.length} findings for review ${state.reviewId}`)
    }

    return events
  }

  onTerminalExit(terminalId: string, exitCode: number): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.terminalStates.get(terminalId)

    if (state && state.reviewId) {
      // Always save buffer before cleanup for debugging
      this.completedBuffers.set(state.reviewId, state.buffer)

      if (state.isCapturing) {
        // Review process ended
        if (exitCode === 0 && !state.hasEmittedResults) {
          // Try one last time to extract findings
          const findings = this.extractFindings(state.buffer)
          if (findings && findings.length > 0) {
            events.push({
              terminalId,
              type: 'review-completed',
              timestamp: Date.now(),
              data: {
                reviewId: state.reviewId,
                findings,
              },
            })
            console.log(`[ReviewDetector] Emitted ${findings.length} findings on exit for review ${state.reviewId}`)
          } else {
            // No findings found, but successful exit - maybe no issues?
            events.push({
              terminalId,
              type: 'review-completed',
              timestamp: Date.now(),
              data: {
                reviewId: state.reviewId,
                findings: [],
              },
            })
            console.log(`[ReviewDetector] Review completed with no findings for review ${state.reviewId}`)
          }
        } else if (exitCode !== 0) {
          // Non-zero exit code - review failed
          events.push({
            terminalId,
            type: 'review-failed',
            timestamp: Date.now(),
            data: {
              reviewId: state.reviewId,
              error: `Review process exited with code ${exitCode}`,
              output: state.buffer.slice(-2000), // Last 2000 chars for debugging
            },
          })
          console.log(`[ReviewDetector] Review failed with exit code ${exitCode} for review ${state.reviewId}`)
        }
      }
    }

    return events
  }

  cleanup(terminalId: string): void {
    this.terminalStates.delete(terminalId)
    console.log(`[ReviewDetector] Cleaned up state for terminal ${terminalId}`)
  }

  /**
   * Get the current buffer for a review (for debugging)
   */
  getBuffer(reviewId: string): string | null {
    // First check active states
    for (const [, state] of this.terminalStates) {
      if (state.reviewId === reviewId) {
        return state.buffer
      }
    }
    // Then check completed buffers
    return this.completedBuffers.get(reviewId) || null
  }

  /**
   * Get buffer by terminal ID
   */
  getBufferByTerminalId(terminalId: string): string | null {
    const state = this.terminalStates.get(terminalId)
    return state?.buffer || null
  }

  /**
   * Clear old completed buffers (call periodically to prevent memory leaks)
   */
  clearOldBuffers(): void {
    // Keep only the last 10 completed buffers
    if (this.completedBuffers.size > 10) {
      const keys = Array.from(this.completedBuffers.keys())
      const toDelete = keys.slice(0, keys.length - 10)
      for (const key of toDelete) {
        this.completedBuffers.delete(key)
      }
    }
  }

  private getOrCreateState(terminalId: string): TerminalReviewState {
    let state = this.terminalStates.get(terminalId)
    if (!state) {
      state = {
        buffer: '',
        reviewId: null,
        isCapturing: false,
        hasEmittedResults: false,
      }
      this.terminalStates.set(terminalId, state)
    }
    return state
  }

  /**
   * Extract review findings from buffered output
   * Looks for JSON array of findings, with or without markdown code blocks
   */
  private extractFindings(buffer: string): ReviewFinding[] | null {
    // Log buffer for debugging (truncated)
    console.log('[ReviewDetector] Buffer length:', buffer.length)
    if (buffer.length < 2000) {
      console.log('[ReviewDetector] Buffer contents:', buffer)
    } else {
      console.log('[ReviewDetector] Buffer start:', buffer.slice(0, 500))
      console.log('[ReviewDetector] Buffer end:', buffer.slice(-500))
    }

    // Try to find JSON content
    // Strategy 1: Look for markdown code block with json
    const jsonCodeBlockMatch = buffer.match(/```json\s*\n([\s\S]*?)\n```/)
    if (jsonCodeBlockMatch) {
      console.log('[ReviewDetector] Found JSON code block')
      try {
        const parsed = JSON.parse(jsonCodeBlockMatch[1])
        if (Array.isArray(parsed)) {
          return this.validateFindings(parsed)
        }
      } catch (e) {
        console.error('[ReviewDetector] Failed to parse JSON from code block:', e)
        console.log('[ReviewDetector] Code block content:', jsonCodeBlockMatch[1].slice(0, 200))
      }
    }

    // Strategy 2: Look for complete JSON array with balanced brackets
    // Find all [ positions and try to find matching ]
    const bracketPositions: number[] = []
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === '[') bracketPositions.push(i)
    }

    for (const startPos of bracketPositions) {
      // Try to find matching closing bracket
      let depth = 0
      let inString = false
      let escapeNext = false

      for (let i = startPos; i < buffer.length; i++) {
        const char = buffer[i]

        if (escapeNext) {
          escapeNext = false
          continue
        }

        if (char === '\\' && inString) {
          escapeNext = true
          continue
        }

        if (char === '"' && !escapeNext) {
          inString = !inString
          continue
        }

        if (!inString) {
          if (char === '[') depth++
          else if (char === ']') {
            depth--
            if (depth === 0) {
              // Found complete array
              const jsonStr = buffer.slice(startPos, i + 1)
              try {
                const parsed = JSON.parse(jsonStr)
                if (Array.isArray(parsed) && parsed.length > 0) {
                  console.log('[ReviewDetector] Successfully parsed JSON array with', parsed.length, 'items')
                  return this.validateFindings(parsed)
                }
              } catch (e) {
                // This bracket pair wasn't valid JSON, try next
              }
              break
            }
          }
        }
      }
    }

    // Strategy 3: Check if Claude said there are no issues
    const noIssuesPatterns = [
      /no\s+issues?\s+found/i,
      /code\s+looks?\s+good/i,
      /no\s+problems?\s+(found|detected)/i,
      /everything\s+looks?\s+(good|fine|ok)/i,
      /\[\s*\]/,  // Empty array
    ]

    for (const pattern of noIssuesPatterns) {
      if (pattern.test(buffer)) {
        console.log('[ReviewDetector] Detected "no issues" response')
        return []
      }
    }

    console.log('[ReviewDetector] No valid JSON found in buffer')
    return null
  }

  /**
   * Validate and normalize findings array
   */
  private validateFindings(data: any[]): ReviewFinding[] {
    const findings: ReviewFinding[] = []

    for (const item of data) {
      // Validate required fields
      if (!item.file || !item.severity || !item.title || !item.description) {
        console.warn('[ReviewDetector] Skipping invalid finding (missing fields):', item)
        continue
      }

      // Skip items that look like template examples (contain pipe characters)
      if (
        item.severity.includes('|') ||
        item.category?.includes('|') ||
        item.file.includes('relative/path') ||
        item.title.includes('Short title')
      ) {
        console.warn('[ReviewDetector] Skipping template example:', item)
        continue
      }

      // Normalize severity
      const severity = item.severity.toLowerCase().trim()
      if (!['critical', 'warning', 'info', 'suggestion'].includes(severity)) {
        console.warn('[ReviewDetector] Invalid severity:', severity, 'in item:', item)
        continue
      }

      findings.push({
        file: item.file,
        line: item.line ? parseInt(item.line, 10) : undefined,
        endLine: item.endLine ? parseInt(item.endLine, 10) : undefined,
        severity: severity as 'critical' | 'warning' | 'info' | 'suggestion',
        category: item.category || 'General',
        title: item.title,
        description: item.description,
        suggestion: item.suggestion,
      })
    }

    return findings
  }
}
