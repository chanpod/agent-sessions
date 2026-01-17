import { useState } from 'react'
import { X, Server, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useSSHStore, type SSHConnection, type SSHAuthMethod } from '../stores/ssh-store'

interface SSHConnectionModalProps {
  onClose: () => void
  connection?: SSHConnection // For editing existing connection
}

export function SSHConnectionModal({ onClose, connection }: SSHConnectionModalProps) {
  const { addConnection, updateConnection } = useSSHStore()
  const [name, setName] = useState(connection?.name || '')
  const [host, setHost] = useState(connection?.host || '')
  const [port, setPort] = useState(connection?.port?.toString() || '22')
  const [username, setUsername] = useState(connection?.username || '')
  const [authMethod, setAuthMethod] = useState<SSHAuthMethod>(connection?.authMethod || 'agent')
  const [identityFile, setIdentityFile] = useState(connection?.identityFile || '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)

  const isEdit = !!connection

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !host.trim() || !username.trim()) return

    const connectionData = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      authMethod,
      identityFile: authMethod === 'key' && identityFile ? identityFile.trim() : undefined,
      options: [],
    }

    if (isEdit && connection) {
      updateConnection(connection.id, connectionData)
    } else {
      addConnection(connectionData)
    }

    onClose()
  }

  const handleTestConnection = async () => {
    if (!host.trim() || !username.trim()) {
      setTestResult({ success: false, error: 'Host and username are required' })
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const testConfig = {
        id: connection?.id || 'test',
        name: 'Test',
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        authMethod,
        identityFile: authMethod === 'key' && identityFile ? identityFile.trim() : undefined,
        options: [],
        createdAt: Date.now(),
      }

      const result = await window.electron?.ssh.test(testConfig)
      setTestResult(result || { success: false, error: 'No result' })
    } catch (err) {
      setTestResult({ success: false, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Server className="w-4 h-4" />
            {isEdit ? 'Edit SSH Connection' : 'New SSH Connection'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Connection Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production Server"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
              required
            />
          </div>

          {/* Host */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Host
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="example.com or 192.168.1.10"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Port and Username */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ubuntu"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Auth Method */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Authentication Method
            </label>
            <select
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value as SSHAuthMethod)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="agent">SSH Agent (Recommended)</option>
              <option value="key">SSH Key File</option>
              <option value="password">Password (You'll be prompted in terminal)</option>
            </select>
            {authMethod === 'password' && (
              <p className="mt-1.5 text-xs text-amber-400">
                Password auth requires entering your password each time you open a terminal. For best experience, use SSH keys instead.
              </p>
            )}
          </div>

          {/* Identity File (only for key auth) */}
          {authMethod === 'key' && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Identity File Path
              </label>
              <input
                type="text"
                value={identityFile}
                onChange={(e) => setIdentityFile(e.target.value)}
                placeholder="~/.ssh/id_rsa"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Test Result */}
          {testResult && (
            <div className={`p-3 rounded-md border text-xs ${
              testResult.success
                ? 'bg-green-900/20 border-green-800 text-green-400'
                : 'bg-red-900/20 border-red-800 text-red-400'
            }`}>
              <div className="flex items-start gap-2">
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  {testResult.success ? testResult.message : testResult.error}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
            >
              {isEdit ? 'Save' : 'Add Connection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
