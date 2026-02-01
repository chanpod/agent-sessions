/**
 * AgentTerminalsSection - Displays agent terminals (terminalType === 'agent')
 * for a specific project, with ability to launch new agent terminals
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { LayoutGrid, Bot, Sparkles, Gem, Code, Plus, Settings2 } from 'lucide-react'
import { useTerminalStore } from '../stores/terminal-store'
import { useViewStore } from '../stores/view-store'
import { useProjectStore } from '../stores/project-store'
import { useAgentContextStore } from '../stores/agent-context-store'
import { DraggableTerminalItem } from './DraggableTerminalItem'
import { TerminalItem } from './ProjectItem'
import { AgentLauncher } from './AgentLauncher'
import { AgentContextEditor } from './AgentContextEditor'
import AgentContextManager from './AgentContextManager'
import { cn } from '../lib/utils'
import type { CliToolDetectionResult } from '../types/electron'

interface AgentTerminalsSectionProps {
  projectId: string
  projectPath: string
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onLaunchAgent: (projectId: string, agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => void
}

/**
 * Get the appropriate icon for an agent based on its ID
 */
function AgentIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'claude':
      return <Sparkles className={className} />
    case 'gemini':
      return <Gem className={className} />
    case 'codex':
      return <Code className={className} />
    default:
      return <Bot className={className} />
  }
}

export function AgentTerminalsSection({
  projectId,
  projectPath,
  onCloseTerminal,
  onReconnectTerminal,
  onLaunchAgent,
}: AgentTerminalsSectionProps) {
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()
  const { activeView, setProjectGridActive } = useViewStore()
  const { projects } = useProjectStore()
  const { loadContexts } = useAgentContextStore()

  // Agent detection state
  const [agents, setAgents] = useState<CliToolDetectionResult[]>([])
  const loadedProjectRef = useRef<string | null>(null)

  // Modal state
  const [showLauncher, setShowLauncher] = useState(false)
  const [showContextEditor, setShowContextEditor] = useState(false)
  const [showContextManager, setShowContextManager] = useState(false)
  const [editingContextId, setEditingContextId] = useState<string | undefined>()

  // Derive project name from store
  const projectName = projects.find((p) => p.id === projectId)?.name || 'Unknown Project'

  // Load contexts when project changes
  useEffect(() => {
    if (projectId && loadedProjectRef.current !== projectId) {
      loadedProjectRef.current = projectId
      loadContexts(projectId)
    }
  }, [projectId, loadContexts])

  // Detect agents
  const detectAgents = useCallback(async () => {
    if (!window.electron?.cli) return

    try {
      const result = await window.electron.cli.detectAll(projectPath, projectId)
      if (result.success || result.tools) {
        setAgents(result.tools)
      }
    } catch (err) {
      console.error('Agent detection failed:', err)
    }
  }, [projectPath, projectId])

  useEffect(() => {
    detectAgents()
  }, [detectAgents])

  // Filter sessions to only agent terminals for this project
  const agentSessions = sessions.filter(
    (s) => s.projectId === projectId && s.terminalType === 'agent'
  )

  // Check if currently in project grid view for this project
  const isInGridView = activeView.type === 'project-grid' && activeView.projectId === projectId

  // Get installed agents for the launcher
  const installedAgents = agents.filter((a) => a.installed)

  // Handle launch from modal
  const handleLaunch = (agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => {
    onLaunchAgent(projectId, agentId, contextId, contextContent, skipPermissions)
    setShowLauncher(false)
  }

  // Handle edit context from launcher
  const handleEditContext = (contextId?: string) => {
    setEditingContextId(contextId)
    setShowContextEditor(true)
  }

  // Close context editor
  const handleCloseContextEditor = () => {
    setShowContextEditor(false)
    setEditingContextId(undefined)
  }

  return (
    <>
      <div className="mb-3 bg-zinc-800/20 rounded-md p-2">
        {/* Project Dashboard Button for agent terminals */}
        {agentSessions.length > 1 && (
          <button
            onClick={() => setProjectGridActive(projectId)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-2 mb-2 rounded-md transition-colors',
              isInGridView
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'bg-zinc-700/30 text-zinc-300 hover:bg-zinc-700/50 border border-transparent'
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-sm font-medium">Agent Dashboard</span>
            <span className="ml-auto text-xs text-zinc-500">{agentSessions.length}</span>
          </button>
        )}

        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Agent Terminals
          </span>
          <div className="flex items-center gap-1">
            {/* Manage Contexts button */}
            <button
              onClick={() => setShowContextManager(true)}
              className="p-0.5 rounded transition-colors hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
              title="Manage Contexts"
            >
              <Settings2 className="w-4 h-4" />
            </button>
            {/* Launch button */}
            <button
              onClick={() => setShowLauncher(true)}
              disabled={installedAgents.length === 0}
              className={cn(
                'p-0.5 rounded transition-colors',
                installedAgents.length > 0
                  ? 'hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300'
                  : 'text-zinc-600 cursor-not-allowed'
              )}
              title={installedAgents.length > 0 ? 'Launch agent terminal' : 'No agents installed'}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {agentSessions.length === 0 ? (
          <p className="text-sm text-zinc-600 px-2 py-1">No agent terminals</p>
        ) : (
          <ul className="space-y-0.5">
            {agentSessions.map((session) => (
              <DraggableTerminalItem
                key={session.id}
                terminalId={session.id}
                terminalTitle={session.title}
              >
                <div className="relative">
                  {/* Agent icon indicator */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 pl-1 pointer-events-none">
                    <AgentIcon
                      id={session.agentId || ''}
                      className="w-3 h-3 text-zinc-500"
                    />
                  </div>
                  <div className="pl-5">
                    <TerminalItem
                      session={session}
                      isActive={activeSessionId === session.id}
                      onSelect={() => setActiveSession(session.id)}
                      onClose={() => onCloseTerminal(session.id)}
                      onReconnect={() => onReconnectTerminal(session.id)}
                    />
                  </div>
                </div>
              </DraggableTerminalItem>
            ))}
          </ul>
        )}
      </div>

      {/* Agent Launcher Modal */}
      {showLauncher && (
        <AgentLauncher
          projectId={projectId}
          projectPath={projectPath}
          installedAgents={agents}
          onLaunch={handleLaunch}
          onClose={() => setShowLauncher(false)}
          onEditContext={handleEditContext}
        />
      )}

      {/* Agent Context Editor Modal */}
      {showContextEditor && (
        <AgentContextEditor
          projectId={projectId}
          contextId={editingContextId}
          onClose={handleCloseContextEditor}
        />
      )}

      {/* Agent Context Manager Modal */}
      <AgentContextManager
        isOpen={showContextManager}
        onClose={() => setShowContextManager(false)}
        projectId={projectId}
        projectName={projectName}
      />
    </>
  )
}
