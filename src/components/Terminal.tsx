import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useGridStore } from '../stores/grid-store'
import { useTerminalStore } from '../stores/terminal-store'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
}

export function Terminal({ sessionId }: TerminalProps) {
  const { focusedGridTerminalId, isInGrid } = useGridStore()
  const { activeSessionId } = useTerminalStore()
  const inGrid = isInGrid(sessionId)
  const isFocused = inGrid
    ? focusedGridTerminalId === sessionId
    : activeSessionId === sessionId
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current && containerRef.current) {
      // Only fit if container has dimensions
      const { clientWidth, clientHeight } = containerRef.current
      if (clientWidth === 0 || clientHeight === 0) return

      try {
        fitAddonRef.current.fit()
        const { cols, rows } = terminalRef.current
        window.electron?.pty.resize(sessionId, cols, rows)
      } catch (e) {
        // Terminal may not be fully initialized yet
        console.warn('Failed to fit terminal:', e)
      }
    }
  }, [sessionId])

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return

    // Create terminal instance
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

    terminalRef.current = terminal

    // Add fit addon
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    terminal.loadAddon(fitAddon)

    // Open terminal in container
    terminal.open(containerRef.current)

    // Initial fit - delay to ensure DOM is ready
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
    const unsubData = window.electron?.pty.onData((id, data) => {
      if (id === sessionId) {
        terminal.write(data)
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(containerRef.current)

    // Focus terminal
    terminal.focus()

    return () => {
      unsubData?.()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId, handleResize])

  // Re-fit and focus when this terminal becomes focused
  useEffect(() => {
    if (isFocused) {
      const timer = setTimeout(() => {
        handleResize()
        terminalRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isFocused, handleResize])

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#0c0c0c]"
      onClick={() => terminalRef.current?.focus()}
    />
  )
}
