import { useState, useEffect } from 'react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useServerStore } from '../stores/server-store'
import { ProjectTabBar } from './ProjectTabBar'
import { TerminalsTab } from './TerminalsTab'
import { FilesTab } from './FilesTab'
import { GitTab } from './GitTab'
import type { ChangedFile } from '../types/electron'

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
  const { setProjectTab } = useProjectStore()
  const { sessions } = useTerminalStore()
  const { servers } = useServerStore()
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [gitHasChanges, setGitHasChanges] = useState(false)
  const [gitAhead, setGitAhead] = useState(0)
  const [gitBehind, setGitBehind] = useState(0)
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])

  // Filter out server terminals from regular terminal list
  const projectSessions = sessions.filter((s) => s.projectId === project.id && s.shell !== '')
  const projectServers = servers.filter((s) => s.projectId === project.id)

  // Fetch git info
  const refreshGitInfo = async () => {
    if (!window.electron || !project.path) return

    try {
      const gitInfo = await window.electron.git.getInfo(project.path)
      if (gitInfo.isGitRepo) {
        setGitBranch(gitInfo.branch || null)
        setGitHasChanges(gitInfo.hasChanges || false)
        setGitAhead(gitInfo.ahead || 0)
        setGitBehind(gitInfo.behind || 0)

        // Fetch changed files if there are changes
        if (gitInfo.hasChanges) {
          const filesResult = await window.electron.git.getChangedFiles(project.path)
          if (filesResult.success && filesResult.files) {
            setChangedFiles(filesResult.files)
          }
        } else {
          setChangedFiles([])
        }
      } else {
        setGitBranch(null)
        setGitHasChanges(false)
        setGitAhead(0)
        setGitBehind(0)
        setChangedFiles([])
      }
    } catch (err) {
      console.error('Failed to get git status:', err)
    }
  }

  useEffect(() => {
    refreshGitInfo()

    // Subscribe to git events for this project
    const handleGitChange = (projectPath: string) => {
      if (projectPath === project.path) {
        refreshGitInfo()
      }
    }

    if (window.electron) {
      const unsubscribe = window.electron.git.onChanged(handleGitChange)
      return unsubscribe
    }
  }, [project.path])

  return (
    <div className="bg-zinc-900/40 rounded-lg p-2 border border-zinc-800/30">
      <ProjectTabBar
        activeTab={project.activeTab}
        onTabChange={(tab) => setProjectTab(project.id, tab)}
        terminalCount={projectSessions.length + projectServers.length}
        changedFilesCount={changedFiles.length}
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
            projectPath={project.path}
            gitBranch={gitBranch}
            gitHasChanges={gitHasChanges}
            changedFiles={changedFiles}
            ahead={gitAhead}
            behind={gitBehind}
            onRefreshGitInfo={refreshGitInfo}
          />
        )}
      </div>
    </div>
  )
}
