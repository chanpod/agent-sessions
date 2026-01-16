/**
 * ServerDetector - Detects when servers start running and provides URLs
 * Also detects server crashes and errors
 */

import { OutputDetector, DetectedEvent } from './output-detector'

export interface DetectedServer {
  url: string
  port: number
  protocol: 'http' | 'https'
  host: string
  detectedAt: number
}

interface TerminalServerState {
  servers: Map<string, DetectedServer> // key is URL
  lastOutput: string
  hasErrors: boolean
}

// Strip ANSI codes for pattern matching
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

export class ServerDetector implements OutputDetector {
  readonly id = 'server-detector'

  private terminalStates: Map<string, TerminalServerState> = new Map()

  // Patterns to detect server URLs
  private readonly patterns = [
    // Direct URL patterns
    /(?:Local|Network|running at|running on|available at|listening on|server started at|started on)[\s:]+(?:https?:\/\/)?([a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+:\d+)/gi,

    // Port-only patterns (will construct URL)
    /(?:running on|listening on|started on|server.* on|port)[:\s]+(?:localhost:)?(\d{2,5})/gi,

    // Framework-specific patterns (now with capture group!)
    /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[:a-fA-F0-9]+):\d+)/gi,

    // Next.js style
    /(?:Local:|Network:)\s+(https?:\/\/[^\s]+)/gi,

    // Vite style
    /Local:\s+(https?:\/\/[^\s\)]+)/gi,
  ]

  // Error patterns
  private readonly errorPatterns = [
    /EADDRINUSE/i,
    /address already in use/i,
    /port.*already in use/i,
    /error.*starting server/i,
    /failed to start/i,
    /cannot start server/i,
  ]

  processOutput(terminalId: string, data: string): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.getOrCreateState(terminalId)
    const cleanData = stripAnsi(data)

    // Append to last output (for multi-line patterns)
    state.lastOutput += cleanData

    // Keep only last 5000 chars to avoid memory issues
    if (state.lastOutput.length > 5000) {
      state.lastOutput = state.lastOutput.slice(-5000)
    }

    // Detect servers
    const detectedServers = this.detectServers(cleanData)
    for (const server of detectedServers) {
      if (!state.servers.has(server.url)) {
        state.servers.set(server.url, server)
        events.push({
          terminalId,
          type: 'server-detected',
          timestamp: Date.now(),
          data: server,
        })
        console.log(`[ServerDetector] Detected server: ${server.url} in terminal ${terminalId}`)
      }
    }

    // Detect errors
    const hasError = this.detectErrors(cleanData)
    if (hasError && !state.hasErrors) {
      state.hasErrors = true
      events.push({
        terminalId,
        type: 'server-error',
        timestamp: Date.now(),
        data: { message: 'Server error detected' },
      })
      console.log(`[ServerDetector] Server error detected in terminal ${terminalId}`)
    }

    return events
  }

  onTerminalExit(terminalId: string, exitCode: number): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.terminalStates.get(terminalId)

    console.log(`[ServerDetector] onTerminalExit called for terminal ${terminalId}, has state: ${!!state}, servers: ${state?.servers.size || 0}`)

    if (state && state.servers.size > 0) {
      // Server crashed
      events.push({
        terminalId,
        type: 'server-crashed',
        timestamp: Date.now(),
        data: {
          exitCode,
          servers: Array.from(state.servers.values()),
        },
      })
      console.log(`[ServerDetector] Emitting server-crashed event for terminal ${terminalId} with ${state.servers.size} servers`)

      // Clear the servers since they're no longer running
      state.servers.clear()
      state.hasErrors = false
    }

    return events
  }

  cleanup(terminalId: string): void {
    this.terminalStates.delete(terminalId)
    console.log(`[ServerDetector] Cleaned up state for terminal ${terminalId}`)
  }

  /**
   * Get all detected servers for a terminal
   */
  getServers(terminalId: string): DetectedServer[] {
    const state = this.terminalStates.get(terminalId)
    return state ? Array.from(state.servers.values()) : []
  }

  private getOrCreateState(terminalId: string): TerminalServerState {
    let state = this.terminalStates.get(terminalId)
    if (!state) {
      state = {
        servers: new Map(),
        lastOutput: '',
        hasErrors: false,
      }
      this.terminalStates.set(terminalId, state)
    }
    return state
  }

  private detectServers(output: string): DetectedServer[] {
    const servers: DetectedServer[] = []
    const seenUrls = new Set<string>()

    for (const pattern of this.patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0

      let match
      while ((match = pattern.exec(output)) !== null) {
        const captured = match[1]
        if (!captured) continue

        let url: string
        let port: number
        let protocol: 'http' | 'https' = 'http'
        let host: string

        // Check if it's a full URL or just a port
        if (/^https?:\/\//.test(captured)) {
          // Full URL
          url = captured
        } else if (/^\d{2,5}$/.test(captured.trim())) {
          // Just a port number
          port = parseInt(captured.trim(), 10)
          if (port < 1024 || port > 65535) continue // Invalid port
          url = `http://localhost:${port}`
        } else if (/^[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+:\d+/.test(captured)) {
          // Host:port format
          url = `http://${captured}`
        } else {
          continue
        }

        // Normalize and validate URL
        try {
          const urlObj = new URL(url)
          protocol = urlObj.protocol.replace(':', '') as 'http' | 'https'
          host = urlObj.hostname
          port = parseInt(urlObj.port, 10)

          if (isNaN(port) || port < 1024 || port > 65535) continue

          const normalizedUrl = `${protocol}://${host}:${port}`

          if (!seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl)
            servers.push({
              url: normalizedUrl,
              port,
              protocol,
              host,
              detectedAt: Date.now(),
            })
          }
        } catch (error) {
          // Invalid URL, skip
          continue
        }
      }
    }

    return servers
  }

  private detectErrors(output: string): boolean {
    for (const pattern of this.errorPatterns) {
      if (pattern.test(output)) {
        return true
      }
    }
    return false
  }
}
