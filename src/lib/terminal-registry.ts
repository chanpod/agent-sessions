import { Terminal as XTerm } from '@xterm/xterm'

interface TerminalInstance {
  terminal: XTerm
  dataUnsubscribe: (() => void) | undefined
  currentContainer: HTMLDivElement | null
  isOpened: boolean
}

// Manual fit function - calculates terminal dimensions based on container size
function fitTerminalManually(terminal: XTerm, container: HTMLDivElement): boolean {
  if (!container.isConnected) return false

  const { clientWidth, clientHeight } = container
  if (clientWidth === 0 || clientHeight === 0) return false

  // Get the actual cell dimensions from the terminal
  // We need to check if the terminal has been rendered first
  const core = (terminal as any)._core
  if (!core) return false

  // Try to get dimensions from the render service
  const renderService = core._renderService
  if (!renderService || !renderService.dimensions) return false

  const dims = renderService.dimensions

  // actualCellWidth and actualCellHeight should be available
  const cellWidth = dims.actualCellWidth || dims.css?.cell?.width
  const cellHeight = dims.actualCellHeight || dims.css?.cell?.height

  if (!cellWidth || !cellHeight || cellWidth === 0 || cellHeight === 0) return false

  // Account for xterm padding (default is 0.5rem = 8px on each side)
  const padding = 16 // 8px left + 8px right (and top + bottom)

  const availableWidth = clientWidth - padding
  const availableHeight = clientHeight - padding

  // Calculate how many cols/rows fit
  const cols = Math.max(2, Math.floor(availableWidth / cellWidth))
  const rows = Math.max(1, Math.floor(availableHeight / cellHeight))

  // Only resize if dimensions actually changed
  if (terminal.cols !== cols || terminal.rows !== rows) {
    terminal.resize(cols, rows)
    return true
  }

  return false
}

// Registry to keep terminal instances alive across React component mounts/unmounts
const terminalInstances = new Map<string, TerminalInstance>()

// Track resize timers for debouncing
const resizeTimers = new Map<string, NodeJS.Timeout>()

// Track which session IDs have been explicitly closed (should be disposed)
const closedSessions = new Set<string>()

export function getOrCreateTerminal(
  sessionId: string,
  container: HTMLDivElement
): { terminal: XTerm; isNew: boolean } {
  // Check if session was explicitly closed - don't reuse
  if (closedSessions.has(sessionId)) {
    closedSessions.delete(sessionId)
  }

  const existing = terminalInstances.get(sessionId)

  if (existing) {
    // Reattach to new container if different
    if (existing.currentContainer !== container) {
      // Move the terminal's DOM element to the new container
      // xterm.js creates a .terminal element we can move
      if (existing.isOpened && existing.terminal.element) {
        // Clear new container first
        container.innerHTML = ''
        // Move the terminal element to the new container
        container.appendChild(existing.terminal.element)
      } else if (!existing.isOpened) {
        // Terminal was created but never opened - open it now
        existing.terminal.open(container)
        existing.isOpened = true
      }

      existing.currentContainer = container

      // Refit after reattaching with retry logic
      const attemptReattachFit = (retries = 0) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const success = fitTerminalManually(existing.terminal, container)

            if (!success && retries < 5) {
              // Retry with exponential backoff if fit failed
              console.log(`Reattach fit retry ${retries + 1}/5`)
              setTimeout(() => attemptReattachFit(retries + 1), 50 * (retries + 1))
            } else if (success) {
              const { cols, rows } = existing.terminal
              console.log(`Terminal ${sessionId} reattached and resized to ${cols}x${rows}`)
              window.electron?.pty.resize(sessionId, cols, rows)
            } else {
              console.warn(`Terminal ${sessionId} reattach fit failed after retries`)
            }
          })
        })
      }

      attemptReattachFit()
    }
    return { terminal: existing.terminal, isNew: false }
  }

  // Create new terminal instance
  const terminal = new XTerm({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 14,
    fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
    theme: {
      background: '#0c0c0c',
      foreground: '#cccccc',
      cursor: '#ffffff',
      cursorAccent: '#0c0c0c',
      selectionBackground: 'rgba(255, 255, 255, 0.3)',
      black: '#0c0c0c',
      red: '#c50f1f',
      green: '#13a10e',
      yellow: '#c19c00',
      blue: '#0037da',
      magenta: '#881798',
      cyan: '#3a96dd',
      white: '#cccccc',
      brightBlack: '#767676',
      brightRed: '#e74856',
      brightGreen: '#16c60c',
      brightYellow: '#f9f1a5',
      brightBlue: '#3b78ff',
      brightMagenta: '#b4009e',
      brightCyan: '#61d6d6',
      brightWhite: '#f2f2f2',
    },
    allowProposedApi: true,
  })

  terminal.open(container)

  // Initial fit with retry logic
  const attemptInitialFit = (retries = 0) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const success = fitTerminalManually(terminal, container)

        if (!success && retries < 5) {
          // Retry with exponential backoff if fit failed
          console.log(`Initial fit retry ${retries + 1}/5`)
          setTimeout(() => attemptInitialFit(retries + 1), 50 * (retries + 1))
        } else if (success) {
          const { cols, rows } = terminal
          console.log(`Terminal ${sessionId} initial size: ${cols}x${rows}`)
          window.electron?.pty.resize(sessionId, cols, rows)
        } else {
          console.warn(`Terminal ${sessionId} initial fit failed after retries`)
        }
      })
    })
  }

  attemptInitialFit()

  // Handle terminal input -> PTY
  terminal.onData((data) => {
    window.electron?.pty.write(sessionId, data)
  })

  // Handle PTY output -> terminal
  const dataUnsubscribe = window.electron?.pty.onData((id, data) => {
    if (id === sessionId) {
      terminal.write(data)
    }
  })

  terminalInstances.set(sessionId, {
    terminal,
    dataUnsubscribe,
    currentContainer: container,
    isOpened: true,
  })

  return { terminal, isNew: true }
}

export function detachTerminal(sessionId: string, container: HTMLDivElement): void {
  const instance = terminalInstances.get(sessionId)
  if (instance && instance.currentContainer === container) {
    // Don't clear the container - the terminal element stays there
    // Just update our reference
    instance.currentContainer = null
  }
}

export function disposeTerminal(sessionId: string): void {
  const instance = terminalInstances.get(sessionId)
  if (instance) {
    instance.dataUnsubscribe?.()
    instance.terminal.dispose()
    terminalInstances.delete(sessionId)
  }

  // Clean up any pending resize timers
  const timer = resizeTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    resizeTimers.delete(sessionId)
  }

  closedSessions.add(sessionId)
}

export function hasTerminalInstance(sessionId: string): boolean {
  return terminalInstances.has(sessionId)
}

export function getTerminalInstance(sessionId: string): TerminalInstance | undefined {
  return terminalInstances.get(sessionId)
}

export function resizeTerminal(sessionId: string): void {
  const instance = terminalInstances.get(sessionId)
  if (!instance || !instance.currentContainer || !instance.isOpened) {
    return
  }

  // Ensure terminal has an element (is attached to DOM)
  if (!instance.terminal.element) {
    console.warn(`Terminal ${sessionId} has no element - skipping resize`)
    return
  }

  // Debounce resize calls to prevent jittery behavior
  const existingTimer = resizeTimers.get(sessionId)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    resizeTimers.delete(sessionId)

    // Double RAF to ensure layout is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!instance.currentContainer) return

        const success = fitTerminalManually(instance.terminal, instance.currentContainer)

        if (success) {
          const { cols, rows } = instance.terminal
          console.log(`Terminal ${sessionId} resized to ${cols}x${rows}`)
          window.electron?.pty.resize(sessionId, cols, rows)
        }
      })
    })
  }, 100) // 100ms debounce

  resizeTimers.set(sessionId, timer)
}

export function focusTerminal(sessionId: string): void {
  const instance = terminalInstances.get(sessionId)
  if (instance) {
    instance.terminal.focus()
  }
}

export function clearTerminal(sessionId: string): void {
  const instance = terminalInstances.get(sessionId)
  if (instance) {
    instance.terminal.clear()
  }
}
