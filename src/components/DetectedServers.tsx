/**
 * DetectedServers - Display detected servers from terminal output with "Open" buttons
 */

import React from 'react'
import { useDetectedServersStore } from '../stores/detected-servers-store'
import { ExternalLink, Server, X, AlertCircle } from 'lucide-react'

interface DetectedServersProps {
  terminalId: string
}

export function DetectedServers({ terminalId }: DetectedServersProps) {
  const { getServersByTerminal, removeServer } = useDetectedServersStore()
  const servers = getServersByTerminal(terminalId)

  if (servers.length === 0) {
    return null
  }

  const handleOpen = (url: string) => {
    window.open(url, '_blank')
  }

  const handleRemove = (url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeServer(terminalId, url)
  }

  return (
    <div className="border-b border-neutral-700 bg-neutral-900 px-3 py-2">
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
                <button
                  onClick={() => handleOpen(server.url)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                  title="Open in browser"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </button>
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
    </div>
  )
}
