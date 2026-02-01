import { useEffect, useRef } from 'react'
import { useServiceStore } from '../stores/service-store'

interface UseDockerDiscoveryOptions {
  projectId: string
  projectPath: string
  enabled?: boolean
}

export function useDockerDiscovery({
  projectId,
  projectPath,
  enabled = true,
}: UseDockerDiscoveryOptions) {
  // Track which projects have been discovered to prevent redundant discoveries
  const discoveredProjectsRef = useRef<Set<string>>(new Set())
  const isDiscoveringRef = useRef(false)

  // Single effect that runs discovery when enabled and projectPath changes
  useEffect(() => {
    if (!enabled || !window.electron) {
      console.log('[useDockerDiscovery] Skipping - enabled:', enabled, 'electron:', !!window.electron)
      return
    }

    // Guard: Prevent re-discovery if already discovering or already discovered for this project
    const discoveryKey = `${projectId}:${projectPath}`
    if (isDiscoveringRef.current) {
      console.log('[useDockerDiscovery] Skipping - already discovering')
      return
    }
    if (discoveredProjectsRef.current.has(discoveryKey)) {
      console.log('[useDockerDiscovery] Skipping - already discovered for:', discoveryKey)
      return
    }

    let cancelled = false
    isDiscoveringRef.current = true

    const discover = async () => {
      const store = useServiceStore.getState()
      console.log('[useDockerDiscovery] Starting discovery for:', projectPath)

      // Check Docker availability
      try {
        const dockerResult = await window.electron!.docker.isAvailable()
        console.log('[useDockerDiscovery] Docker available:', dockerResult.available)

        if (cancelled) return
        store.setDockerAvailable(dockerResult.available)

        if (!dockerResult.available) {
          console.log('[useDockerDiscovery] Docker not available, skipping service discovery')
          return
        }
      } catch (error) {
        console.error('[useDockerDiscovery] Docker check failed:', error)
        useServiceStore.getState().setDockerAvailable(false)
        return
      }

      // Discover services
      useServiceStore.getState().setProjectLoading(projectId, true)
      try {
        const result = await window.electron!.service.discover(projectPath, projectId)
        console.log('[useDockerDiscovery] Discovery result:', result)

        if (cancelled) return

        if (result.success) {
          useServiceStore.getState().setServices(projectId, result.services)
          console.log('[useDockerDiscovery] Found', result.services.length, 'services')
        } else {
          console.error('[useDockerDiscovery] Discovery failed:', result.error)
        }
      } catch (error) {
        console.error('[useDockerDiscovery] Discovery error:', error)
      } finally {
        if (!cancelled) {
          useServiceStore.getState().setProjectLoading(projectId, false)
          // Mark this project as discovered
          discoveredProjectsRef.current.add(discoveryKey)
        }
        isDiscoveringRef.current = false
      }
    }

    discover()

    return () => {
      cancelled = true
      isDiscoveringRef.current = false
    }
  }, [enabled, projectId, projectPath]) // Only primitive deps
}
