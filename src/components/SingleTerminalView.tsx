import { TerminalSession } from '../stores/terminal-store'
import { useProjectStore } from '../stores/project-store'
import { Terminal } from './Terminal'
import { DetectedServers } from './DetectedServers'

interface SingleTerminalViewProps {
  session: TerminalSession
}

export function SingleTerminalView({ session }: SingleTerminalViewProps) {
  const { projects } = useProjectStore()

  const project = projects.find((p) => p.id === session.projectId)
  const projectName = project?.name || 'Unknown'

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full h-full">
      <div className="h-9 flex items-center gap-2 px-3 bg-zinc-900/60 border-b border-zinc-800 flex-shrink-0">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
          {session.shellName || 'shell'}
        </span>
        <span className="text-[10px] text-zinc-500">{projectName}</span>
        <span className="text-xs text-zinc-300 flex-1 truncate">{session.title}</span>
      </div>

      <DetectedServers terminalId={session.id} />

      <div className="flex-1 min-h-0 min-w-0 w-full">
        <Terminal key={session.id} sessionId={session.id} isFocused={true} />
      </div>
    </div>
  )
}
