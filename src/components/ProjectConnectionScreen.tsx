import { Wifi, WifiOff, AlertCircle, Loader2, X } from 'lucide-react'
import { useSSHStore } from '../stores/ssh-store'
import { Project } from '../stores/project-store'

interface ProjectConnectionScreenProps {
  project: Project
  onConnect: () => void
  onCancel: () => void
}

export function ProjectConnectionScreen({ project, onConnect, onCancel }: ProjectConnectionScreenProps) {
  const { getConnection } = useSSHStore()
  const sshConnection = project.sshConnectionId ? getConnection(project.sshConnectionId) : null

  const status = project.connectionStatus || 'disconnected'
  const isConnecting = status === 'connecting'
  const isError = status === 'error'

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {/* Icon */}
      <div className={`mb-4 p-4 rounded-full ${
        isError ? 'bg-red-500/10' :
        isConnecting ? 'bg-blue-500/10' :
        'bg-zinc-700/50'
      }`}>
        {isConnecting ? (
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        ) : isError ? (
          <AlertCircle className="w-8 h-8 text-red-400" />
        ) : (
          <WifiOff className="w-8 h-8 text-zinc-400" />
        )}
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-zinc-200 mb-2">
        {isConnecting ? 'Connecting...' : isError ? 'Connection Failed' : 'Disconnected'}
      </h3>

      {/* SSH Connection Details */}
      {sshConnection && (
        <div className="mb-4 text-sm text-zinc-400">
          <p className="font-mono">{sshConnection.username}@{sshConnection.host}</p>
          {project.remotePath && (
            <p className="text-zinc-500 mt-1">{project.remotePath}</p>
          )}
        </div>
      )}

      {/* Error Message */}
      {isError && project.connectionError && (
        <div className="mb-4 max-w-xs p-3 bg-red-500/10 border border-red-500/20 rounded-md">
          <p className="text-sm text-red-400">{project.connectionError}</p>
        </div>
      )}

      {/* Description */}
      {!isConnecting && (
        <p className="text-sm text-zinc-500 mb-6 max-w-xs">
          {isError
            ? 'The connection to the remote server failed. Check your credentials and try again.'
            : 'Connect to this SSH project to access terminals, files, and git operations.'
          }
        </p>
      )}

      {/* Connect Button */}
      {!isConnecting && (
        <button
          onClick={onConnect}
          disabled={!sshConnection}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
        >
          <Wifi className="w-4 h-4" />
          {isError ? 'Retry Connection' : 'Connect to Server'}
        </button>
      )}

      {/* Connecting State with Cancel */}
      {isConnecting && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-400">
            Establishing SSH connection...
          </p>
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
