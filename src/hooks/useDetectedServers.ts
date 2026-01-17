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

    const unsubscribe = window.electron.detector.onEvent((event) => {
      console.log('[useDetectedServers] Received event:', event)

      switch (event.type) {
        case 'server-detected':
          const server = event.data as DetectedServer
          addServer(event.terminalId, server)
          break

        case 'server-crashed':
          const { exitCode } = event.data
          markServerCrashed(event.terminalId, exitCode)
          break

        case 'server-error':
          // Server crashed due to error (port in use, etc.)
          console.log('[useDetectedServers] Server error in terminal', event.terminalId, '- marking as crashed')
          markServerCrashed(event.terminalId, 1) // Exit code 1 for error
          break
      }
    })

    return () => {
      unsubscribe()
    }
  }, [addServer, markServerCrashed, clearTerminalServers])
}
