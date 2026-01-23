import { useState, useEffect } from 'react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useServerStore } from '../stores/server-store'
import { useSSHStore } from '../stores/ssh-store'
import { useGitStore } from '../stores/git-store'
import { TerminalsTab } from './TerminalsTab'
import { ProjectConnectionScreen } from './ProjectConnectionScreen'
import { PasswordDialog } from './PasswordDialog'

interface ShellInfo {
  name: string
  path: string
}

interface ProjectContentProps {
  project: Project
  shells: ShellInfo[]
  onCreateTerminal: (projectId: string, shell: ShellInfo) => void
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onRestartServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

export function ProjectContent({
  project,
  shells,
  onCreateTerminal,
  onCloseTerminal,
  onReconnectTerminal,
  onStartServer,
  onStopServer,
  onRestartServer,
  onDeleteServer,
}: ProjectContentProps) {
  const { connectProject, setProjectConnectionStatus, disconnectProject } = useProjectStore()
  const { sessions } = useTerminalStore()
  const { servers } = useServerStore()
  const { getConnection } = useSSHStore()
  const { refreshGitInfo } = useGitStore()

  // State for password authentication flow
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [masterTerminalId, setMasterTerminalId] = useState<string | null>(null)
  const [sshConnectionName, setSSHConnectionName] = useState('')

  // Check if SSH project is connected
  const isSSHProject = project.isSSHProject
  const connectionStatus = project.connectionStatus || 'disconnected'
  const isConnected = isSSHProject ? connectionStatus === 'connected' : true

  // Handle connection
  const handleConnect = async () => {
    if (!project.sshConnectionId || !window.electron) return

    // First establish the SSH connection
    const sshConnection = getConnection(project.sshConnectionId)
    if (!sshConnection) {
      console.error('SSH connection not found')
      return
    }

    await window.electron.ssh.connect(sshConnection)

    // Connect the project - this will establish the ControlMaster connection
    console.log('[ProjectContent] Calling connectProject...')
    const result = await connectProject(project.id)
    console.log('[ProjectContent] connectProject result:', result)

    if (!result.success) {
      // Check if password authentication is required
      if (result.requiresInteractive) {
        console.log('[ProjectContent] Password auth required - creating interactive ControlMaster terminal')

        // Get the command to establish ControlMaster interactively
        const masterCmd = await window.electron.ssh.getInteractiveMasterCommand(project.id)
        if (!masterCmd) {
          console.error('[ProjectContent] Failed to get interactive master command')
          handleCancelConnect()
          return
        }

        // Create a HIDDEN terminal for ControlMaster setup (we'll pipe the password to it)
        const terminalInfo = await window.electron.pty.createWithCommand(
          masterCmd.shell,
          masterCmd.args,
          'SSH Connection Setup',
          true // hidden
        )

        console.log('[ProjectContent] Created hidden ControlMaster terminal:', terminalInfo.id)

        // Store terminal ID and show password dialog
        setMasterTerminalId(terminalInfo.id)
        setSSHConnectionName(sshConnection.name)
        setShowPasswordDialog(true)
        return
      }

      console.error('[ProjectContent] Failed to connect project:', result.error)
      handleCancelConnect()
      return
    }

    // Connection established successfully via ControlMaster
    console.log('[ProjectContent] Project connected successfully via ControlMaster')
    console.log('[ProjectContent] Setting connection status to connected for project:', project.id)
    setProjectConnectionStatus(project.id, 'connected')
    console.log('[ProjectContent] Connection status set. Project should now be:', useProjectStore.getState().projects.find(p => p.id === project.id)?.connectionStatus)

    // Trigger git refresh now that we're connected
    // Use remotePath for SSH projects since that's the actual path on the server
    console.log('[ProjectContent] Triggering git refresh after connection')
    const gitPath = project.remotePath || project.path
    refreshGitInfo(project.id, gitPath)
  }

  // Handle password submission - pipe it to the hidden terminal
  const handlePasswordSubmit = async (password: string) => {
    if (!masterTerminalId || !window.electron) return

    console.log('[ProjectContent] Sending password to ControlMaster terminal:', masterTerminalId)

    // Send password followed by Enter key to the terminal
    await window.electron.pty.write(masterTerminalId, password + '\n')

    // Close the dialog
    setShowPasswordDialog(false)

    // After a delay, mark the project as connected
    // (gives SSH time to authenticate and establish ControlMaster)
    setTimeout(async () => {
      if (window.electron) {
        await window.electron.ssh.markProjectConnected(project.id)
        const { setProjectConnectionStatus } = useProjectStore.getState()
        setProjectConnectionStatus(project.id, 'connected')
        console.log('[ProjectContent] Project marked as connected after password auth')

        // Trigger git refresh now that we're connected
        // Use remotePath for SSH projects since that's the actual path on the server
        console.log('[ProjectContent] Triggering git refresh after password auth')
        const gitPath = project.remotePath || project.path
        refreshGitInfo(project.id, gitPath)
      }
    }, 2000) // Wait 2 seconds for SSH to authenticate
  }

  // Handle password dialog cancel
  const handlePasswordCancel = () => {
    setShowPasswordDialog(false)

    // Kill the ControlMaster terminal if user cancels
    if (masterTerminalId && window.electron) {
      window.electron.pty.kill(masterTerminalId)
      setMasterTerminalId(null)
    }

    handleCancelConnect()
  }

  // Handle cancel connection
  const handleCancelConnect = () => {
    // Reset connection status to disconnected
    const { setProjectConnectionStatus } = useProjectStore.getState()
    setProjectConnectionStatus(project.id, 'disconnected')
  }

  // Handle disconnect
  const handleDisconnect = async () => {
    console.log('[ProjectContent] Disconnecting project:', project.id)
    await disconnectProject(project.id)
  }

  // Show connection screen if SSH project is not connected
  if (isSSHProject && !isConnected) {
    return (
      <>
        <div className="bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
          <ProjectConnectionScreen
            project={project}
            onConnect={handleConnect}
            onCancel={handleCancelConnect}
          />
        </div>

        {/* Password dialog for SSH password authentication */}
        <PasswordDialog
          isOpen={showPasswordDialog}
          title="SSH Password Required"
          message={`Enter password for ${sshConnectionName}`}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      </>
    )
  }

  return (
    <>
      <div className="bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
        {/* Disconnect button for SSH projects */}
        {isSSHProject && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Disconnect
            </button>
          </div>
        )}

        <TerminalsTab
          project={project}
          projectId={project.id}
          projectPath={project.path}
          shells={shells}
          onCreateTerminal={onCreateTerminal}
          onCloseTerminal={onCloseTerminal}
          onReconnectTerminal={onReconnectTerminal}
          onStartServer={onStartServer}
          onStopServer={onStopServer}
          onRestartServer={onRestartServer}
          onDeleteServer={onDeleteServer}
        />
      </div>

      {/* Password dialog for SSH password authentication */}
      <PasswordDialog
        isOpen={showPasswordDialog}
        title="SSH Password Required"
        message={`Enter password for ${sshConnectionName}`}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />
    </>
  )
}
