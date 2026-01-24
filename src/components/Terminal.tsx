import { useEffect, useRef, useCallback } from 'react'
import { getOrCreateTerminal, detachTerminal, resizeTerminal, focusTerminal, getTerminalReady } from '../lib/terminal-registry'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
  isFocused: boolean
}

export function Terminal({ sessionId, isFocused }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)

  const handleResize = useCallback(() => {
    resizeTerminal(sessionId)
  }, [sessionId])

  useEffect(() => {
    if (!containerRef.current) return

    // Get or create terminal instance from registry
    const { isNew, ready } = getOrCreateTerminal(sessionId, containerRef.current)

    // Only set up resize observer once per mount
    if (!initializedRef.current) {
      initializedRef.current = true

      const resizeObserver = new ResizeObserver(() => {
        handleResize()
      })
      resizeObserver.observe(containerRef.current)

      // Initial resize after mount to ensure proper fitting
      requestAnimationFrame(() => {
        handleResize()
      })

      // Focus if this is a new terminal - wait for terminal to be ready first
      // Use retry mechanism since container may not be visible/mounted when ready resolves
      if (isNew) {
        ready.then(() => {
          const attemptFocus = (retries = 10) => {
            if (focusTerminal(sessionId)) return
            if (retries > 0) {
              setTimeout(() => attemptFocus(retries - 1), 50)
            }
          }
          attemptFocus()
        })
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
  }, [sessionId]) // handleResize is stable (only depends on sessionId)

  // Re-fit and focus when this terminal becomes focused
  useEffect(() => {
    if (isFocused) {
      let cancelled = false
      const ready = getTerminalReady(sessionId)

      const performResizeAndFocus = () => {
        if (cancelled) return
        // Use requestAnimationFrame to batch resize and focus operations
        requestAnimationFrame(() => {
          if (cancelled) return
          resizeTerminal(sessionId)
          focusTerminal(sessionId)
        })
      }

      if (ready) {
        // Wait for terminal to be ready before focusing
        ready.then(performResizeAndFocus)
      } else {
        // Terminal already exists and is ready - focus immediately
        performResizeAndFocus()
      }

      return () => {
        cancelled = true
      }
    }
  }, [isFocused, sessionId]) // Removed handleResize - use resizeTerminal directly

  return (
    <div ref={containerRef} className="h-full w-full bg-[#0c0c0c]" onClick={() => focusTerminal(sessionId)} />
  )
}
