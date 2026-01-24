import { Terminal as XTerm } from '@xterm/xterm'

interface TerminalInstance {
  terminal: XTerm
  dataUnsubscribe: (() => void) | undefined
  currentContainer: HTMLDivElement | null
  isOpened: boolean
  ready: Promise<void>
}

// Whitelisted keyboard shortcuts that should work even when terminal is focused
// Returns true if the event should be allowed to bubble up (not consumed by terminal)
function isWhitelistedShortcut(event: KeyboardEvent): boolean {
  // Ctrl+P or Cmd+P (file search)
  if ((event.ctrlKey || event.metaKey) && event.key === 'p' && !event.altKey && !event.shiftKey) {
    return true
  }

  // Ctrl+1-9 (project switching)
  if (event.ctrlKey && !event.altKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
    return true
  }

  // Alt+1-9 (terminal focus switching)
  if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
    return true
  }

  return false
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

// Store ready resolvers for deferred terminals
const readyResolvers = new Map<string, () => void>()

/**
 * Creates a terminal instance without opening it to a container.
 * Sets up PTY data handlers but defers DOM attachment.
 * Use openTerminalToContainer() to attach to DOM later.
 */
export function createTerminalDeferred(sessionId: string): XTerm {
  // Check if session was explicitly closed - don't reuse
  if (closedSessions.has(sessionId)) {
    closedSessions.delete(sessionId)
  }

  // Return existing terminal if already created
  const existing = terminalInstances.get(sessionId)
  if (existing) {
    return existing.terminal
  }

  // Create new terminal instance with all options
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

  // Create ready promise that resolves when terminal is fully initialized (after opening)
  let resolveReady: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  readyResolvers.set(sessionId, resolveReady!)

  // Handle terminal input -> PTY (works even before opening)
  terminal.onData((data) => {
    window.electron?.pty.write(sessionId, data)
  })

  // Handle PTY output -> terminal (works even before opening, buffers data)
  const dataUnsubscribe = window.electron?.pty.onData((id, data) => {
    if (id === sessionId) {
      terminal.write(data)
    }
  })

  // Store in registry with isOpened: false
  terminalInstances.set(sessionId, {
    terminal,
    dataUnsubscribe,
    currentContainer: null,
    isOpened: false,
    ready,
  })

  return terminal
}

/**
 * Opens a deferred terminal to a container.
 * Must be called after createTerminalDeferred().
 * Returns true if opened, false if already was opened.
 */
export function openTerminalToContainer(
  sessionId: string,
  container: HTMLDivElement
): boolean {
  const instance = terminalInstances.get(sessionId)
  if (!instance) {
    console.warn(`openTerminalToContainer: No terminal instance found for ${sessionId}`)
    return false
  }

  if (instance.isOpened) {
    // Already opened - use attachTerminalToContainer for reattachment
    return false
  }

  // Open terminal to container
  instance.terminal.open(container)
  instance.isOpened = true
  instance.currentContainer = container

  // Attach custom key event handler (needs DOM to work)
  instance.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (isWhitelistedShortcut(event)) {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true
      }))
      return false
    }
    return true
  })

  // Initial fit with retry logic
  const resolveReady = readyResolvers.get(sessionId)
  const attemptInitialFit = (retries = 0) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const success = fitTerminalManually(instance.terminal, container)

        if (!success && retries < 5) {
          console.log(`Initial fit retry ${retries + 1}/5`)
          setTimeout(() => attemptInitialFit(retries + 1), 50 * (retries + 1))
        } else if (success) {
          const { cols, rows } = instance.terminal
          console.log(`Terminal ${sessionId} initial size: ${cols}x${rows}`)
          window.electron?.pty.resize(sessionId, cols, rows)
          resolveReady?.()
          readyResolvers.delete(sessionId)
        } else {
          console.warn(`Terminal ${sessionId} initial fit failed after retries`)
          resolveReady?.()
          readyResolvers.delete(sessionId)
        }
      })
    })
  }

  attemptInitialFit()
  return true
}

/**
 * Attaches an already-opened terminal to a new container.
 * Moves the terminal's DOM element to the new container.
 * Returns true if attached, false if terminal not found or not opened.
 */
export function attachTerminalToContainer(
  sessionId: string,
  container: HTMLDivElement
): boolean {
  const instance = terminalInstances.get(sessionId)
  if (!instance) {
    console.warn(`attachTerminalToContainer: No terminal instance found for ${sessionId}`)
    return false
  }

  if (!instance.isOpened) {
    // Not opened yet - use openTerminalToContainer instead
    console.warn(`attachTerminalToContainer: Terminal ${sessionId} not opened yet, use openTerminalToContainer`)
    return false
  }

  if (instance.currentContainer === container) {
    // Already attached to this container
    return true
  }

  // Move the terminal's DOM element to the new container
  if (instance.terminal.element) {
    // Remove from previous parent if exists (instead of clearing innerHTML which can cause issues)
    instance.terminal.element.parentElement?.removeChild(instance.terminal.element)
    container.appendChild(instance.terminal.element)
  }

  instance.currentContainer = container

  // Refit after reattaching with retry logic
  const attemptReattachFit = (retries = 0) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const success = fitTerminalManually(instance.terminal, container)

        if (!success && retries < 5) {
          console.log(`Reattach fit retry ${retries + 1}/5`)
          setTimeout(() => attemptReattachFit(retries + 1), 50 * (retries + 1))
        } else if (success) {
          const { cols, rows } = instance.terminal
          console.log(`Terminal ${sessionId} reattached and resized to ${cols}x${rows}`)
          window.electron?.pty.resize(sessionId, cols, rows)
        } else {
          console.warn(`Terminal ${sessionId} reattach fit failed after retries`)
        }
      })
    })
  }

  attemptReattachFit()
  return true
}

/**
 * Gets an existing terminal or creates a new one and opens it to the container.
 * This is the original API - kept for backward compatibility.
 * Internally uses the new deferred creation functions.
 */
export function getOrCreateTerminal(
  sessionId: string,
  container: HTMLDivElement
): { terminal: XTerm; isNew: boolean; ready: Promise<void> } {
  const existing = terminalInstances.get(sessionId)

  if (existing) {
    // Existing terminal - handle reattachment
    if (existing.currentContainer !== container) {
      if (existing.isOpened) {
        // Use the new attach function for already-opened terminals
        attachTerminalToContainer(sessionId, container)
      } else {
        // Terminal was created deferred but never opened - open it now
        openTerminalToContainer(sessionId, container)
      }
    }
    return { terminal: existing.terminal, isNew: false, ready: existing.ready }
  }

  // Create new terminal using deferred creation, then immediately open
  const terminal = createTerminalDeferred(sessionId)
  openTerminalToContainer(sessionId, container)

  const instance = terminalInstances.get(sessionId)!
  return { terminal, isNew: true, ready: instance.ready }
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

  // Clean up ready resolver if present
  readyResolvers.delete(sessionId)

  closedSessions.add(sessionId)
}

export function hasTerminalInstance(sessionId: string): boolean {
  return terminalInstances.has(sessionId)
}

export function getTerminalInstance(sessionId: string): TerminalInstance | undefined {
  return terminalInstances.get(sessionId)
}

export function getTerminalReady(sessionId: string): Promise<void> | undefined {
  return terminalInstances.get(sessionId)?.ready
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

export function focusTerminal(sessionId: string): boolean {
  const instance = terminalInstances.get(sessionId)
  if (!instance) return false

  // Check if container is visible and has dimensions
  const container = instance.terminal.element?.parentElement
  if (!container || container.clientWidth === 0 || container.clientHeight === 0) {
    return false // Don't attempt focus on invisible container
  }

  instance.terminal.focus()
  return true
}

export function clearTerminal(sessionId: string): void {
  const instance = terminalInstances.get(sessionId)
  if (instance) {
    instance.terminal.clear()
  }
}
