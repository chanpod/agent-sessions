/**
 * Hook to listen for detected servers and update the store
 */

import { useEffect } from 'react'
import { useDetectedServersStore } from '../stores/detected-servers-store'
import { DetectedServer } from '../types/electron'

export function useDetectedServers() {
  const { addServer, markServerCrashed, clearTerminalServers } = useDetectedServersStore()

  useEffect(() => {
    if (!window.electron?.detector) return

    // Prefer batched events to avoid per-event overhead
    if (window.electron.detector.onEventBatch) {
      const unsubscribe = window.electron.detector.onEventBatch((events) => {
        for (const event of events) {
          switch (event.type) {
            case 'server-detected': {
              const server = event.data as DetectedServer
              addServer(event.terminalId, server)
              break
            }
            case 'server-crashed': {
              const { exitCode } = event.data
              markServerCrashed(event.terminalId, exitCode)
              break
            }
            case 'server-error': {
              markServerCrashed(event.terminalId, 1)
              break
            }
          }
        }
      })

      return () => { unsubscribe() }
    }

    // Fallback: individual events
    const unsubscribe = window.electron.detector.onEvent((event) => {
      switch (event.type) {
        case 'server-detected': {
          const server = event.data as DetectedServer
          addServer(event.terminalId, server)
          break
        }
        case 'server-crashed': {
          const { exitCode } = event.data
          markServerCrashed(event.terminalId, exitCode)
          break
        }
        case 'server-error': {
          markServerCrashed(event.terminalId, 1)
          break
        }
      }
    })

    return () => { unsubscribe() }
  }, [addServer, markServerCrashed, clearTerminalServers])
}
