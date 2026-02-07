import { useState, useEffect } from 'react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useServerStore } from '../stores/server-store'
import { useSSHStore } from '../stores/ssh-store'
import { useGitStore } from '../stores/git-store'
import { TerminalsTab } from './TerminalsTab'
import { ProjectConnectionScreen } from './ProjectConnectionScreen'
import { PasswordDialog } from './PasswordDialog'
import { DockerServicesSection } from './DockerServicesSection'
import { useDockerDiscovery } from '../hooks/useDockerDiscovery'

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
  onCreateAgentTerminal: (projectId: string, agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => void
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
  onCreateAgentTerminal,
}: ProjectContentProps) {
  const { connectProject, setProjectConnectionStatus, disconnectProject } = useProjectStore()
  const { sessions } = useTerminalStore()
  const { servers } = useServerStore()
  const { getConnection } = useSSHStore()
  const { refreshGitInfo } = useGitStore()

  // State for password authentication flow
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [sshConnectionName, setSSHConnectionName] = useState('')

  // Auto-discover Docker Compose services (only for local projects)
  useDockerDiscovery({
    projectId: project.id,
    projectPath: project.isSSHProject ? (project.remotePath || project.path) : project.path,
    enabled: !project.isSSHProject, // Only for local projects
  })

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
      if (result.requiresInteractive) {
        // Password auth — show dialog, then establish ControlMaster with the password
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

  // Handle password submission — establish background ControlMaster via SSH_ASKPASS
  const handlePasswordSubmit = async (password: string) => {
    if (!window.electron) return

    setShowPasswordDialog(false)

    const result = await window.electron.ssh.connectProjectWithPassword(project.id, password)
    if (result?.success) {
      const { setProjectConnectionStatus } = useProjectStore.getState()
      setProjectConnectionStatus(project.id, 'connected')

      const gitPath = project.remotePath || project.path
      refreshGitInfo(project.id, gitPath)
    } else {
      console.error('[ProjectContent] SSH password auth failed:', result?.error)
      handleCancelConnect()
    }
  }

  const handlePasswordCancel = () => {
    setShowPasswordDialog(false)
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
          onCreateAgentTerminal={onCreateAgentTerminal}
        />

        {/* Docker Compose Services - only for local projects */}
        {!project.isSSHProject && (
          <DockerServicesSection
            projectId={project.id}
            projectPath={project.path}
          />
        )}
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
