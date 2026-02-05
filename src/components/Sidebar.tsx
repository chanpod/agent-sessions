import { useState, useEffect, useCallback, useRef } from 'react'
import { Archive } from 'lucide-react'
import { AgentTerminalsSection } from './AgentTerminalsSection'
import { ArchivedSessionsSheet } from './ArchivedSessionsSheet'
import { ServicesSection } from '@/components/ServicesSection'
import { useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'

interface SidebarProps {
  onCloseTerminal: (id: string) => void
  onReconnectTerminal: (id: string) => void
  onCreateAgentTerminal: (projectId: string, agentId: string, contextId: string | null, contextContent: string | null, skipPermissions?: boolean) => void
  onRestoreArchivedSession: (sessionId: string) => void
  onPermanentDeleteArchivedSession: (sessionId: string) => void
  onStartServer: (projectId: string, name: string, command: string) => void
  onStopServer: (serverId: string) => void
  onDeleteServer: (serverId: string) => void
}

const MIN_WIDTH = 220
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 280

export function Sidebar(props: SidebarProps) {
  const { onCloseTerminal, onReconnectTerminal, onCreateAgentTerminal, onRestoreArchivedSession, onPermanentDeleteArchivedSession, onStartServer, onStopServer, onDeleteServer } = props
  const { projects, activeProjectId } = useProjectStore()
  const activeProject = projects.find(p => p.id === activeProjectId)
  const archivedConfigs = useTerminalStore((s) => s.archivedConfigs)
  const projectArchivedConfigs = archivedConfigs.filter(
    (a) => a.config.projectId === activeProjectId
  )
  const [showArchived, setShowArchived] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('')
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
        <div className="pt-2" />

        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="space-y-4 pt-2">
          {!activeProject ? (
            <div className="text-xs text-muted-foreground">
              Select a project to view sessions and servers.
            </div>
          ) : (
            <>
              <AgentTerminalsSection
                projectId={activeProject.id}
                projectPath={activeProject.path}
                onCloseTerminal={onCloseTerminal}
                onReconnectTerminal={onReconnectTerminal}
                onLaunchAgent={onCreateAgentTerminal}
              />

              <Separator className="my-2 bg-border/60" />
              <ServicesSection
                projectId={activeProject.id}
                projectPath={activeProject.path}
                onStartServer={onStartServer}
                onStopServer={onStopServer}
                onDeleteServer={onDeleteServer}
              />
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

    </>
  )
}
