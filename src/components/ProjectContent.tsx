import { useEffect } from 'react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useServerStore } from '../stores/server-store'
import { useGitStore } from '../stores/git-store'
import { useSSHStore } from '../stores/ssh-store'
import { useGridStore } from '../stores/grid-store'
import { ProjectTabBar } from './ProjectTabBar'
import { TerminalsTab } from './TerminalsTab'
import { FilesTab } from './FilesTab'
import { GitTab } from './GitTab'
import { ProjectConnectionScreen } from './ProjectConnectionScreen'

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
  const { setProjectTab, connectProject } = useProjectStore()
  const { sessions, addSession, saveConfig } = useTerminalStore()
  const { servers } = useServerStore()
  const { gitInfo, refreshGitInfo } = useGitStore()
  const { getConnection } = useSSHStore()
  const { createGrid, addTerminalToGrid } = useGridStore()

  // Check if SSH project is connected
  const isSSHProject = project.isSSHProject
  const connectionStatus = project.connectionStatus || 'disconnected'
  const isConnected = isSSHProject ? connectionStatus === 'connected' : true

  // Get git info for this specific project
  const projectGitInfo = gitInfo[project.id] || {
    branch: null,
    branches: [],
    isGitRepo: false,
    hasChanges: false,
    ahead: 0,
    behind: 0,
    changedFiles: [],
  }

  // Filter out server terminals from regular terminal list
  const projectSessions = sessions.filter((s) => s.projectId === project.id && s.shell !== '')
  const projectServers = servers.filter((s) => s.projectId === project.id)

  // Wrapper for refreshing this project's git info
  const handleRefreshGitInfo = async () => {
    if (project.path) {
      await refreshGitInfo(project.id, project.path)
    }
  }

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

    // Then connect the project
    console.log('[ProjectContent] Calling connectProject...')
    const result = await connectProject(project.id)
    console.log('[ProjectContent] connectProject result:', result)

    // If password auth is required, create an interactive terminal
    if (result?.requiresInteractive) {
      console.log('[ProjectContent] Creating interactive terminal for password auth')

      // Get the SSH command for the interactive master
      const command = await window.electron.ssh.getInteractiveMasterCommand(project.id)
      if (!command) {
        console.error('Failed to get interactive master command')
        return
      }

      // Create a temporary terminal that establishes the master connection
      // This terminal will prompt for password and keep the connection alive
      const terminalInfo = await window.electron.pty.createWithCommand(
        command.shell,
        command.args,
        project.remotePath || '~'
      )

      if (terminalInfo) {
        console.log('[ProjectContent] Interactive terminal created:', terminalInfo.id)

        // Add the terminal to the session store
        addSession({
          id: terminalInfo.id,
          pid: terminalInfo.pid,
          projectId: project.id,
          shell: 'SSH (Connecting...)',
          shellName: `${sshConnection.name} (Auth)`,
          cwd: terminalInfo.cwd,
          title: terminalInfo.title,
          createdAt: terminalInfo.createdAt,
          isActive: true,
          status: 'running',
          lastActivityTime: Date.now(),
          sshConnectionId: project.sshConnectionId,
        })

        // Save the config for persistence
        saveConfig({
          id: terminalInfo.id,
          projectId: project.id,
          shell: terminalInfo.shell,
          shellName: `${sshConnection.name} (Auth)`,
          cwd: terminalInfo.cwd,
          sshConnectionId: project.sshConnectionId,
        })

        // Create a new grid with this terminal and set it as active
        const gridId = createGrid(terminalInfo.id)

        // Get the store and set this grid as active
        const { setActiveGrid } = useGridStore.getState()
        setActiveGrid(gridId)

        // Switch to terminals tab so user can see it
        setProjectTab(project.id, 'terminals')

        console.log('[ProjectContent] Terminal added to grid:', gridId, 'Terminal ID:', terminalInfo.id)

        // Don't mark as connected yet - wait for actual authentication
        // The terminal output will be monitored for successful login
        // For now, the connection stays in "connecting" state until user successfully authenticates
      }
    }
  }

  // Handle cancel connection
  const handleCancelConnect = () => {
    // Reset connection status to disconnected
    const { setProjectConnectionStatus } = useProjectStore.getState()
    setProjectConnectionStatus(project.id, 'disconnected')
  }

  // Show connection screen if SSH project is not connected
  if (isSSHProject && !isConnected) {
    return (
      <div className="bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
        <ProjectConnectionScreen
          project={project}
          onConnect={handleConnect}
          onCancel={handleCancelConnect}
        />
      </div>
    )
  }

  return (
    <div className="bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
      <ProjectTabBar
        activeTab={project.activeTab}
        onTabChange={(tab) => setProjectTab(project.id, tab)}
        terminalCount={projectSessions.length + projectServers.length}
        changedFilesCount={projectGitInfo.changedFiles.length}
      />

      <div className="mt-2 space-y-1">
        {project.activeTab === 'terminals' && (
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
        )}

        {project.activeTab === 'files' && (
          <FilesTab projectPath={project.path} />
        )}

        {project.activeTab === 'git' && (
          <GitTab
            projectId={project.id}
            projectPath={project.path}
            gitBranch={projectGitInfo.branch}
            gitHasChanges={projectGitInfo.hasChanges}
            changedFiles={projectGitInfo.changedFiles}
            ahead={projectGitInfo.ahead}
            behind={projectGitInfo.behind}
            onRefreshGitInfo={handleRefreshGitInfo}
          />
        )}
      </div>
    </div>
  )
}
