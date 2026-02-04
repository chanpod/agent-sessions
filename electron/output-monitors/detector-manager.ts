/**
 * DetectorManager coordinates multiple output detectors
 * and routes terminal output to all registered detectors
 */

import { OutputDetector, DetectedEvent } from './output-detector'

export type EventCallback = (event: DetectedEvent) => void

export class DetectorManager {
  private detectors: Map<string, OutputDetector> = new Map()
  private eventCallbacks: Set<EventCallback> = new Set()

  /**
   * Register a new detector
   */
  registerDetector(detector: OutputDetector): void {
    this.detectors.set(detector.id, detector)
    console.log(`[DetectorManager] Registered detector: ${detector.id}`)
  }

  /**
   * Unregister a detector
   */
  unregisterDetector(detectorId: string): void {
    this.detectors.delete(detectorId)
    console.log(`[DetectorManager] Unregistered detector: ${detectorId}`)
  }

  /**
   * Subscribe to detected events
   */
  onEvent(callback: EventCallback): () => void {
    this.eventCallbacks.add(callback)
    return () => {
      this.eventCallbacks.delete(callback)
    }
  }

  /**
   * Process output through all detectors
   */
  processOutput(terminalId: string, data: string): void {
    for (const detector of this.detectors.values()) {
      try {
        const events = detector.processOutput(terminalId, data)
        this.emitEvents(events)
      } catch (error) {
        console.error(`[DetectorManager] Error in detector ${detector.id}:`, error)
      }
    }
  }

  /**
   * Handle terminal exit through all detectors
   */
  handleTerminalExit(terminalId: string, exitCode: number): void {
    for (const detector of this.detectors.values()) {
      try {
        const events = detector.onTerminalExit(terminalId, exitCode)
        this.emitEvents(events)
      } catch (error) {
        console.error(`[DetectorManager] Error in detector ${detector.id} on exit:`, error)
      }
    }
  }

  /**
   * Clean up state for a terminal across all detectors
   */
  cleanupTerminal(terminalId: string): void {
    for (const detector of this.detectors.values()) {
      try {
        detector.cleanup(terminalId)
      } catch (error) {
        console.error(`[DetectorManager] Error cleaning up detector ${detector.id}:`, error)
      }
    }
  }

  /**
   * Emit events to all subscribers
   */
  private emitEvents(events: DetectedEvent[]): void {
    for (const event of events) {
      for (const callback of this.eventCallbacks) {
        try {
          callback(event)
        } catch (error) {
          console.error('[DetectorManager] Error in event callback:', error)
        }
      }
    }
  }
}
