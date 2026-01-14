import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

interface TerminalInstance {
  terminal: XTerm
  fitAddon: FitAddon
  dataUnsubscribe: (() => void) | undefined
  currentContainer: HTMLDivElement | null
  isOpened: boolean
}

// Registry to keep terminal instances alive across React component mounts/unmounts
const terminalInstances = new Map<string, TerminalInstance>()

// Track which session IDs have been explicitly closed (should be disposed)
const closedSessions = new Set<string>()

export function getOrCreateTerminal(
  sessionId: string,
  container: HTMLDivElement
): { terminal: XTerm; fitAddon: FitAddon; isNew: boolean } {
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

      // Refit after reattaching
      requestAnimationFrame(() => {
        try {
          existing.fitAddon.fit()
          const { cols, rows } = existing.terminal
          window.electron?.pty.resize(sessionId, cols, rows)
        } catch (e) {
          console.warn('Fit after reattach failed:', e)
        }
      })
    }
    return { terminal: existing.terminal, fitAddon: existing.fitAddon, isNew: false }
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

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(container)

  // Initial fit
  requestAnimationFrame(() => {
    try {
      fitAddon.fit()
      const { cols, rows } = terminal
      window.electron?.pty.resize(sessionId, cols, rows)
    } catch (e) {
      console.warn('Initial fit failed:', e)
    }
  })

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
    fitAddon,
    dataUnsubscribe,
    currentContainer: container,
    isOpened: true,
  })

  return { terminal, fitAddon, isNew: true }
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
  if (instance && instance.currentContainer) {
    const { clientWidth, clientHeight } = instance.currentContainer
    if (clientWidth === 0 || clientHeight === 0) return

    try {
      instance.fitAddon.fit()
      const { cols, rows } = instance.terminal
      window.electron?.pty.resize(sessionId, cols, rows)
    } catch (e) {
      console.warn('Failed to resize terminal:', e)
    }
  }
}

export function focusTerminal(sessionId: string): void {
  const instance = terminalInstances.get(sessionId)
  if (instance) {
    instance.terminal.focus()
  }
}
