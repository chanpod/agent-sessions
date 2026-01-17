import { useState, useEffect } from 'react'
import { Server, Plus, Trash2, Circle, Edit2 } from 'lucide-react'
import { useSSHStore } from '../stores/ssh-store'
import { SSHConnectionModal } from './SSHConnectionModal'
import type { SSHConnection } from '../stores/ssh-store'

export function SSHConnectionsList() {
  const { connections, removeConnection, connectionStatuses, setConnectionStatus } = useSSHStore()
  const [showModal, setShowModal] = useState(false)
  const [editingConnection, setEditingConnection] = useState<SSHConnection | undefined>()
  const [connectionStatusMap, setConnectionStatusMap] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    // Subscribe to SSH status changes
    const unsubscribe = window.electron?.ssh.onStatusChange((connectionId, connected) => {
      setConnectionStatusMap(prev => {
        const next = new Map(prev)
        next.set(connectionId, connected)
        return next
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const handleEditConnection = (connection: SSHConnection, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingConnection(connection)
    setShowModal(true)
  }

  const handleDeleteConnection = (connection: SSHConnection, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`Delete SSH connection "${connection.name}"?`)) {
      // Disconnect if connected
      if (connectionStatusMap.get(connection.id)) {
        window.electron?.ssh.disconnect(connection.id)
      }
      removeConnection(connection.id)
    }
  }

  const handleNewConnection = () => {
    setEditingConnection(undefined)
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingConnection(undefined)
  }

  return (
    <div className="px-2">
      <div className="flex items-center justify-between px-2 mb-2">
        <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          SSH Connections
        </h2>
        <button
          onClick={handleNewConnection}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="New SSH Connection"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="px-2 py-8 text-center">
          <Server className="w-8 h-8 mx-auto text-zinc-700 mb-2" />
          <p className="text-xs text-zinc-600 mb-3">No SSH connections</p>
          <button
            onClick={handleNewConnection}
            className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
          >
            Add your first connection
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {connections.map((connection) => {
            const isConnected = connectionStatusMap.get(connection.id) || false
            return (
              <div
                key={connection.id}
                className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800 transition-colors"
              >
                {/* Status Indicator */}
                <Circle
                  className={`w-2 h-2 flex-shrink-0 ${
                    isConnected ? 'fill-green-500 text-green-500' : 'fill-zinc-700 text-zinc-700'
                  }`}
                />

                {/* Connection Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-300 truncate">
                    {connection.name}
                  </div>
                  <div className="text-[10px] text-zinc-600 truncate">
                    {connection.username}@{connection.host}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleEditConnection(connection, e)}
                    className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                    title="Edit"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => handleDeleteConnection(connection, e)}
                    className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <SSHConnectionModal
          connection={editingConnection}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}
