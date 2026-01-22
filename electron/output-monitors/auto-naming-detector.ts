/**
 * AutoNamingDetector - Detects terminal output and suggests meaningful names
 * Uses LLM to analyze buffered terminal output and generate descriptive names
 */

import { OutputDetector, DetectedEvent } from './output-detector'
import type { LLMService } from '../services/llm-service'

/**
 * State tracked per terminal for auto-naming
 */
interface TerminalNamingState {
  buffer: string
  debounceTimer: NodeJS.Timeout | null
  lastNameChangeTime: number
  currentName: string | null
}

// Strip ANSI codes for cleaner analysis
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

export class AutoNamingDetector implements OutputDetector {
  readonly id = 'auto-naming-detector'

  private terminalStates: Map<string, TerminalNamingState> = new Map()
  private llmService: LLMService | null = null

  // Configuration constants
  private readonly MAX_BUFFER_SIZE = 5000
  private readonly DEBOUNCE_MS = 2000
  private readonly COOLDOWN_MS = 30000
  private readonly MIN_OUTPUT_LENGTH = 100

  /**
   * Set the LLMService for LLM queries
   * Must be called after construction before the detector will generate names
   */
  setLLMService(llmService: LLMService): void {
    this.llmService = llmService
    console.log('[AutoNamingDetector] LLMService set')
  }

  processOutput(terminalId: string, data: string): DetectedEvent[] {
    const state = this.getOrCreateState(terminalId)
    const cleanData = stripAnsi(data)

    // Append to buffer
    state.buffer += cleanData

    // Trim buffer if it exceeds max size
    if (state.buffer.length > this.MAX_BUFFER_SIZE) {
      state.buffer = state.buffer.slice(-this.MAX_BUFFER_SIZE)
    }

    // Reset debounce timer
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }

    // Set new debounce timer
    state.debounceTimer = setTimeout(() => {
      this.onDebounceComplete(terminalId)
    }, this.DEBOUNCE_MS)

    // No synchronous events - naming happens asynchronously via debounce
    return []
  }

  onTerminalExit(terminalId: string, _exitCode: number): DetectedEvent[] {
    // Clean up state on terminal exit
    this.cleanup(terminalId)
    return []
  }

  cleanup(terminalId: string): void {
    const state = this.terminalStates.get(terminalId)
    if (state) {
      // Clear any pending debounce timer
      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer)
      }
      this.terminalStates.delete(terminalId)
      console.log(`[AutoNamingDetector] Cleaned up state for terminal ${terminalId}`)
    }
  }

  /**
   * Called when debounce timer fires (output has stopped for DEBOUNCE_MS)
   */
  private async onDebounceComplete(terminalId: string): Promise<void> {
    const state = this.terminalStates.get(terminalId)
    if (!state) {
      console.log(`[AutoNamingDetector] No state found for terminal ${terminalId} on debounce`)
      return
    }

    // Clear the timer reference
    state.debounceTimer = null

    // Check minimum output length
    if (state.buffer.length < this.MIN_OUTPUT_LENGTH) {
      console.log(`[AutoNamingDetector] Buffer too short (${state.buffer.length} chars) for terminal ${terminalId}`)
      return
    }

    // Check cooldown
    const now = Date.now()
    const timeSinceLastChange = now - state.lastNameChangeTime
    if (timeSinceLastChange < this.COOLDOWN_MS) {
      console.log(`[AutoNamingDetector] Cooldown active for terminal ${terminalId} (${Math.round((this.COOLDOWN_MS - timeSinceLastChange) / 1000)}s remaining)`)
      return
    }

    // Check if we have LLMService
    if (!this.llmService) {
      console.warn('[AutoNamingDetector] LLMService not set, cannot generate name')
      return
    }

    try {
      const suggestedName = await this.queryLLMForName(terminalId, state.buffer)

      if (suggestedName && suggestedName !== state.currentName) {
        state.currentName = suggestedName
        state.lastNameChangeTime = now

        // Emit event via callback since we can't return events from async
        this.emitNameSuggestion(terminalId, suggestedName)
      }
    } catch (error) {
      console.error(`[AutoNamingDetector] Failed to get name suggestion for terminal ${terminalId}:`, error)
    }
  }

  /**
   * Query LLM for a suggested terminal name
   */
  private async queryLLMForName(terminalId: string, buffer: string): Promise<string | null> {
    if (!this.llmService) {
      return null
    }

    console.log(`[AutoNamingDetector] Querying LLM for terminal ${terminalId} name...`)

    try {
      const suggestedName = await this.llmService.generateTerminalName(buffer)

      if (suggestedName) {
        console.log(`[AutoNamingDetector] Suggested name for terminal ${terminalId}: "${suggestedName}"`)
        return suggestedName
      }

      return null
    } catch (error) {
      console.error(`[AutoNamingDetector] LLM query failed for terminal ${terminalId}:`, error)
      return null
    }
  }

  /**
   * Emit a name suggestion event
   * Since processOutput returns synchronously but naming is async,
   * we use a callback mechanism to emit events
   */
  private emitNameSuggestion(terminalId: string, suggestedName: string): void {
    const event: DetectedEvent = {
      terminalId,
      type: 'terminal-name-auto',
      timestamp: Date.now(),
      data: { suggestedName },
    }

    // Emit through the callback if set
    if (this.eventCallback) {
      this.eventCallback(event)
    }

    console.log(`[AutoNamingDetector] Emitted terminal-name-auto event for ${terminalId}: "${suggestedName}"`)
  }

  // Event callback for async event emission
  private eventCallback: ((event: DetectedEvent) => void) | null = null

  /**
   * Set callback for async event emission
   * This is needed because the naming happens asynchronously via debounce
   */
  onAsyncEvent(callback: (event: DetectedEvent) => void): void {
    this.eventCallback = callback
  }

  /**
   * Get or create state for a terminal
   */
  private getOrCreateState(terminalId: string): TerminalNamingState {
    let state = this.terminalStates.get(terminalId)
    if (!state) {
      state = {
        buffer: '',
        debounceTimer: null,
        lastNameChangeTime: 0,
        currentName: null,
      }
      this.terminalStates.set(terminalId, state)
    }
    return state
  }

  /**
   * Get current state for a terminal (for debugging)
   */
  getState(terminalId: string): TerminalNamingState | undefined {
    return this.terminalStates.get(terminalId)
  }

  /**
   * Get all terminal states (for debugging)
   */
  getAllStates(): Map<string, TerminalNamingState> {
    return new Map(this.terminalStates)
  }
}
