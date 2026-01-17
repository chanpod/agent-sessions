/**
 * DetectedServers - Display detected servers from terminal output with "Open" buttons
 */

import React, { useMemo, useState } from 'react'
import { useDetectedServersStore } from '../stores/detected-servers-store'
import { ExternalLink, Server, X, AlertCircle, Copy, Check } from 'lucide-react'

interface DetectedServersProps {
  terminalId: string
}

export function DetectedServers({ terminalId }: DetectedServersProps) {
  // Subscribe to servers state changes
  const allServers = useDetectedServersStore((state) => state.servers)
  const removeServer = useDetectedServersStore((state) => state.removeServer)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  // Filter servers for this terminal (memoized to avoid infinite loop)
  const servers = useMemo(() => {
    const result: any[] = []
    for (const server of allServers.values()) {
      if (server.terminalId === terminalId) {
        result.push(server)
      }
    }
    return result
  }, [allServers, terminalId])

  if (servers.length === 0) {
    return null
  }

  const handleOpen = (url: string) => {
    if (window.electron?.system && 'openExternal' in window.electron.system) {
      (window.electron.system as any).openExternal(url)
    } else {
      // Fallback for non-Electron environments
      window.open(url, '_blank')
    }
  }

  const handleCopy = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      // Clear the toast after 2 seconds
      setTimeout(() => setCopiedUrl(null), 2000)
    } catch (err) {
      console.error('Failed to copy URL:', err)
    }
  }

  const handleRemove = (url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeServer(terminalId, url)
  }

  return (
    <div className="border-b border-neutral-700 bg-neutral-900 px-3 py-2 relative">
      <div className="flex flex-col gap-2">
        {servers.map((server) => (
          <div
            key={server.url}
            className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${
              server.status === 'running'
                ? 'bg-green-900/20 border border-green-700/30'
                : server.status === 'crashed'
                ? 'bg-red-900/20 border border-red-700/30'
                : 'bg-neutral-800/50 border border-neutral-700/30'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {server.status === 'running' ? (
                <Server className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
              ) : server.status === 'crashed' ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              ) : (
                <Server className="w-3.5 h-3.5 text-neutral-500 flex-shrink-0" />
              )}

              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-mono text-neutral-200 truncate">{server.url}</span>
                {server.status === 'crashed' && server.exitCode !== undefined && (
                  <span className="text-xs text-red-400">
                    Crashed with exit code {server.exitCode}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              {server.status === 'running' && (
                <>
                  <button
                    onClick={() => handleOpen(server.url)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                    title="Open in browser"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open
                  </button>
                  <button
                    onClick={(e) => handleCopy(server.url, e)}
                    className="p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                    title="Copy URL"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button
                onClick={(e) => handleRemove(server.url, e)}
                className="p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                title="Remove"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Toast notification */}
      {copiedUrl && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-3 py-2 rounded shadow-lg flex items-center gap-2 text-sm animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-4 h-4" />
          <span>URL copied to clipboard!</span>
        </div>
      )}
    </div>
  )
}
