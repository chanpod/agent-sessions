import { TerminalSession } from '../stores/terminal-store'
import { useProjectStore } from '../stores/project-store'
import { useViewStore } from '../stores/view-store'
import { Terminal } from './Terminal'
import { ActivityIndicator } from './ActivityIndicator'
import { DetectedServers } from './DetectedServers'
import { LayoutGrid } from 'lucide-react'

interface SingleTerminalViewProps {
  session: TerminalSession
}

export function SingleTerminalView({ session }: SingleTerminalViewProps) {
  const { projects } = useProjectStore()
  const { setProjectGridActive } = useViewStore()

  const project = projects.find((p) => p.id === session.projectId)
  const projectName = project?.name || 'Unknown'

  const handleBackToGrid = () => {
    if (session.projectId) {
      setProjectGridActive(session.projectId)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full h-full">
      {/* Header bar */}
      <div className="h-8 flex items-center gap-2 px-3 bg-zinc-900/50 border-b border-zinc-800 flex-shrink-0">
        {/* Back to grid button */}
        <button
          onClick={handleBackToGrid}
          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Back to Project Dashboard"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span className="text-xs">Grid</span>
        </button>

        <span className="text-zinc-700">|</span>

        {/* Shell type badge */}
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
          {session.shellName || 'shell'}
        </span>

        {/* Project name */}
        <span className="text-[10px] text-zinc-500">{projectName}</span>

        <span className="text-zinc-700">|</span>

        {/* Terminal name */}
        <span className="text-xs text-zinc-300 flex-1">{session.title}</span>

        <ActivityIndicator sessionId={session.id} className="w-2 h-2" />
      </div>

      {/* Detected Servers */}
      <DetectedServers terminalId={session.id} />

      {/* Terminal - full height */}
      <div className="flex-1 min-h-0 min-w-0 w-full">
        <Terminal key={session.id} sessionId={session.id} isFocused={true} />
      </div>
    </div>
  )
}
