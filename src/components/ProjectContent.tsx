import { useEffect } from 'react'
import { Project, useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useServerStore } from '../stores/server-store'
import { useGitStore } from '../stores/git-store'
import { ProjectTabBar } from './ProjectTabBar'
import { TerminalsTab } from './TerminalsTab'
import { FilesTab } from './FilesTab'
import { GitTab } from './GitTab'

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
  const { gitInfo, refreshGitInfo } = useGitStore()

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
