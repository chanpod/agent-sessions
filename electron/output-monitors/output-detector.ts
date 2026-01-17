/**
 * Base interface for output detectors
 * Detectors watch terminal output and emit events when they detect patterns
 */

export interface DetectedEvent {
  terminalId: string
  type: string
  timestamp: number
  data: any
}

export interface OutputDetector {
  /**
   * Unique identifier for this detector
   */
  readonly id: string

  /**
   * Process a chunk of output data
   * @param terminalId - The terminal session ID
   * @param data - The output data (may contain ANSI codes)
   * @returns Array of detected events
   */
  processOutput(terminalId: string, data: string): DetectedEvent[]

  /**
   * Handle terminal exit event
   * @param terminalId - The terminal session ID
   * @param exitCode - The exit code
   * @returns Array of detected events
   */
  onTerminalExit(terminalId: string, exitCode: number): DetectedEvent[]

  /**
   * Clean up any state for a terminal
   * @param terminalId - The terminal session ID
   */
  cleanup(terminalId: string): void
}
