import { useEffect, useRef, useCallback } from 'react'
import { useGridStore } from '../stores/grid-store'
import {
  getOrCreateTerminal,
  detachTerminal,
  resizeTerminal,
  focusTerminal,
} from '../lib/terminal-registry'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
  gridId: string
}

export function Terminal({ sessionId, gridId }: TerminalProps) {
  const { grids } = useGridStore()
  const grid = grids.find((g) => g.id === gridId)
  const isFocused = grid?.focusedTerminalId === sessionId

  const containerRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)

  const handleResize = useCallback(() => {
    resizeTerminal(sessionId)
  }, [sessionId])

  useEffect(() => {
    if (!containerRef.current) return

    // Get or create terminal instance from registry
    const { isNew } = getOrCreateTerminal(sessionId, containerRef.current)

    // Only set up resize observer once per mount
    if (!initializedRef.current) {
      initializedRef.current = true

      const resizeObserver = new ResizeObserver(() => {
        handleResize()
      })
      resizeObserver.observe(containerRef.current)

      // Focus if this is a new terminal
      if (isNew) {
        focusTerminal(sessionId)
      }

      return () => {
        resizeObserver.disconnect()
        initializedRef.current = false
        // Detach but don't dispose - terminal stays in registry
        if (containerRef.current) {
          detachTerminal(sessionId, containerRef.current)
        }
      }
    }
  }, [sessionId, handleResize])

  // Re-fit and focus when this terminal becomes focused
  useEffect(() => {
    if (isFocused) {
      const timer = setTimeout(() => {
        handleResize()
        focusTerminal(sessionId)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isFocused, sessionId, handleResize])

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#0c0c0c]"
      onClick={() => focusTerminal(sessionId)}
    />
  )
}
