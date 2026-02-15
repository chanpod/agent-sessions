import { useState, useEffect, useCallback, useRef } from 'react'
import { Archive, Wifi, WifiOff, AlertCircle, Loader2, X, Unplug } from 'lucide-react'
import { AgentTerminalsSection } from './AgentTerminalsSection'
import { ArchivedSessionsSheet } from './ArchivedSessionsSheet'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ServicesSection } from '@/components/ServicesSection'
import { DockerStacksSection } from './DockerStacksSection'
import { PasswordDialog } from './PasswordDialog'
import { useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useSSHStore } from '../stores/ssh-store'
import { useGitStore } from '../stores/git-store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'

interface SidebarProps {
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onCreateAgentTerminal: (projectId: string, agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean, model?: string | null) => void
  onRestoreArchivedSession: (sessionId: string) => void
  onPermanentDeleteArchivedSession: (sessionId: string) => void
  onDeleteAllArchivedSessions: () => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
  onCreateProject: () => void
  onEditProject: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
}

const MIN_WIDTH = 220
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 280

export function Sidebar(props: SidebarProps) {
  const { onCloseTerminal, onReconnectTerminal, onCreateAgentTerminal, onRestoreArchivedSession, onPermanentDeleteArchivedSession, onDeleteAllArchivedSessions, onStartServer, onStopServer, onDeleteServer, onCreateProject, onEditProject, onDeleteProject } = props
  const { projects, activeProjectId, connectProject, setProjectConnectionStatus, disconnectProject } = useProjectStore()
  const activeProject = projects.find(p => p.id === activeProjectId)
  const { getConnection } = useSSHStore()
  const { refreshGitInfo } = useGitStore()
  const archivedConfigs = useTerminalStore((s) => s.archivedConfigs)
  const projectArchivedConfigs = archivedConfigs.filter(
    (a) => a.config.projectId === activeProjectId
  )
  const [showArchived, setShowArchived] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('')

  // SSH connection state
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [sshConnectionName, setSSHConnectionName] = useState('')

  const isSSHProject = activeProject?.isSSHProject ?? false
  const connectionStatus = activeProject?.connectionStatus || 'disconnected'
  const isSSHConnected = isSSHProject ? connectionStatus === 'connected' : true

  const handleSSHConnect = async () => {
    if (!activeProject?.sshConnectionId || !window.electron) return

    const sshConnection = getConnection(activeProject.sshConnectionId)
    if (!sshConnection) {
      console.error('[Sidebar] SSH connection not found')
      return
    }

    await window.electron.ssh.connect(sshConnection)

    const result = await connectProject(activeProject.id)
    if (!result) return

    if (!result.success) {
      if (result.requiresInteractive) {
        // Password auth — show dialog, then establish ControlMaster with the password
        setSSHConnectionName(sshConnection.name)
        setShowPasswordDialog(true)
        return
      }

      handleSSHCancelConnect()
      return
    }

    setProjectConnectionStatus(activeProject.id, 'connected')
    const gitPath = activeProject.remotePath || activeProject.path
    refreshGitInfo(activeProject.id, gitPath)
  }

  const handlePasswordSubmit = async (password: string) => {
    if (!window.electron || !activeProject) return

    setShowPasswordDialog(false)

    // Establish a background ControlMaster using SSH_ASKPASS with the password.
    // This creates the same persistent `-fN` background process as key auth,
    // so the ControlMaster survives independently of any terminal.
    const result = await window.electron.ssh.connectProjectWithPassword(activeProject.id, password)
    if (result?.success) {
      const { setProjectConnectionStatus } = useProjectStore.getState()
      setProjectConnectionStatus(activeProject.id, 'connected')

      const gitPath = activeProject.remotePath || activeProject.path
      refreshGitInfo(activeProject.id, gitPath)
    } else {
      console.error('[Sidebar] SSH password auth failed:', result?.error)
      handleSSHCancelConnect()
    }
  }

  const handlePasswordCancel = () => {
    setShowPasswordDialog(false)
    handleSSHCancelConnect()
  }

  const handleSSHCancelConnect = () => {
    if (activeProject) {
      setProjectConnectionStatus(activeProject.id, 'disconnected')
    }
  }

  const handleSSHDisconnect = async () => {
    if (activeProject) {
      await disconnectProject(activeProject.id)
    }
  }

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width')
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing && sidebarRef.current) {
      const newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
        localStorage.setItem('sidebar-width', String(newWidth))
      }
    }
  }, [isResizing])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize)
      window.addEventListener('mouseup', stopResizing)
    }
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing, resize, stopResizing])

  useEffect(() => {
    async function loadVersion() {
      if (!window.electron?.app?.getVersion) return
      try {
        const version = await window.electron.app.getVersion()
        setAppVersion(version)
      } catch (err) {
        console.error('Failed to load app version:', err)
      }
    }
    loadVersion()
  }, [])


  return (
    <>
      <aside
        ref={sidebarRef}
        style={{ width }}
        className={cn(
          'flex-shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col relative z-20',
          isResizing && 'select-none'
        )}
      >
        <ProjectSwitcher
          onCreateProject={onCreateProject}
          onEditProject={onEditProject}
          onDeleteProject={onDeleteProject}
        />
        <Separator className="mx-2" />

        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="space-y-4 pt-2">
          {!activeProject ? (
            <div className="text-xs text-muted-foreground">
              Select a project to view sessions and servers.
            </div>
          ) : isSSHProject && !isSSHConnected ? (
            /* SSH project not connected — show connection prompt */
            <SSHConnectionGate
              project={activeProject}
              onConnect={handleSSHConnect}
              onCancel={handleSSHCancelConnect}
            />
          ) : (
            <>
              {/* Disconnect button for connected SSH projects */}
              {isSSHProject && (
                <button
                  onClick={handleSSHDisconnect}
                  className="flex items-center gap-1.5 w-full px-2 py-1.5 mb-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  Disconnect SSH
                </button>
              )}

              <AgentTerminalsSection
                projectId={activeProject.id}
                projectPath={activeProject.isSSHProject && activeProject.remotePath ? activeProject.remotePath : activeProject.path}
                sshConnected={isSSHProject && isSSHConnected}
                onCloseTerminal={onCloseTerminal}
                onReconnectTerminal={onReconnectTerminal}
                onLaunchAgent={onCreateAgentTerminal}
              />

              <Separator className="my-2 bg-border/60" />
              <ServicesSection
                projectId={activeProject.id}
                projectPath={activeProject.isSSHProject && activeProject.remotePath ? activeProject.remotePath : activeProject.path}
                onStartServer={onStartServer}
                onStopServer={onStopServer}
                onDeleteServer={onDeleteServer}
              />

              {!activeProject.isSSHProject && (
                <DockerStacksSection projectPath={activeProject.path} />
              )}
            </>
          )}
          </div>
        </ScrollArea>

        {projectArchivedConfigs.length > 0 && (
          <div className="px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowArchived(true)}
            >
              <Archive className="w-4 h-4" />
              Archived Sessions
              <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">
                {projectArchivedConfigs.length}
              </Badge>
            </Button>
          </div>
        )}

        <ArchivedSessionsSheet
          open={showArchived}
          onOpenChange={setShowArchived}
          archivedConfigs={projectArchivedConfigs}
          onRestore={onRestoreArchivedSession}
          onDelete={onPermanentDeleteArchivedSession}
          onDeleteAll={onDeleteAllArchivedSessions}
        />

        <Separator />
        <div className="px-4 py-3">
          <div className="flex items-center justify-end text-xs text-muted-foreground">
            {appVersion && <span>v{appVersion}</span>}
          </div>
        </div>

        <div
          onMouseDown={startResizing}
          className={cn(
            'absolute top-0 right-0 w-1 h-full cursor-col-resize transition-colors',
            isResizing ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'
          )}
        />
      </aside>


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

// =============================================================================
// SSH Connection Gate — compact sidebar variant
// =============================================================================

function SSHConnectionGate({
  project,
  onConnect,
  onCancel,
}: {
  project: import('../stores/project-store').Project
  onConnect: () => void
  onCancel: () => void
}) {
  const { getConnection } = useSSHStore()
  const sshConnection = project.sshConnectionId ? getConnection(project.sshConnectionId) : null

  const status = project.connectionStatus || 'disconnected'
  const isConnecting = status === 'connecting'
  const isError = status === 'error'

  return (
    <div className="flex flex-col items-center py-8 px-2 text-center">
      <div className={cn(
        'mb-3 p-3 rounded-full',
        isError ? 'bg-destructive/10' : isConnecting ? 'bg-blue-500/10' : 'bg-muted'
      )}>
        {isConnecting ? (
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
        ) : isError ? (
          <AlertCircle className="w-6 h-6 text-destructive" />
        ) : (
          <WifiOff className="w-6 h-6 text-muted-foreground" />
        )}
      </div>

      <h4 className="text-sm font-medium text-foreground mb-1">
        {isConnecting ? 'Connecting...' : isError ? 'Connection Failed' : 'Not Connected'}
      </h4>

      {sshConnection && (
        <p className="text-xs text-muted-foreground font-mono mb-1">
          {sshConnection.username}@{sshConnection.host}
        </p>
      )}
      {project.remotePath && (
        <p className="text-xs text-muted-foreground/70 mb-3 truncate max-w-full">
          {project.remotePath}
        </p>
      )}

      {isError && project.connectionError && (
        <div className="mb-3 w-full p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
          {project.connectionError}
        </div>
      )}

      {!isConnecting && (
        <Button
          size="sm"
          onClick={onConnect}
          disabled={!sshConnection}
          className="gap-1.5"
        >
          <Wifi className="w-3.5 h-3.5" />
          {isError ? 'Retry' : 'Connect'}
        </Button>
      )}

      {isConnecting && (
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
      )}
    </div>
  )
}
