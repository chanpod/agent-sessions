import { useEffect, useCallback } from 'react'
import { IconShieldCheck, IconShieldX, IconTerminal2, IconFile, IconTool } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { usePermissionStore } from '@/stores/permission-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useAgentStreamStore } from '@/stores/agent-stream-store'
import { cn } from '@/lib/utils'

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Bash':
      return <IconTerminal2 className="size-5" />
    case 'Edit':
    case 'Write':
    case 'Read':
      return <IconFile className="size-5" />
    default:
      return <IconTool className="size-5" />
  }
}

function getToolSummary(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return String(toolInput.command ?? '')
    case 'Edit':
    case 'Write':
    case 'Read':
      return String(toolInput.file_path ?? toolInput.path ?? '')
    case 'Glob':
      return String(toolInput.pattern ?? '')
    case 'Grep':
      return String(toolInput.pattern ?? '')
    default:
      return JSON.stringify(toolInput, null, 2)
  }
}

export function PermissionModal() {
  const { pendingRequests, removeRequest, getNextRequestForSession } = usePermissionStore()
  const activeAgentSessionId = useTerminalStore((s) => s.activeAgentSessionId)
  const terminalToSession = useAgentStreamStore((s) => s.terminalToSession)

  // Get the CLI sessionId for the active agent terminal
  const activeCliSessionId = activeAgentSessionId
    ? terminalToSession.get(activeAgentSessionId) ?? null
    : null

  // Only show requests belonging to the active session
  const request = activeCliSessionId
    ? getNextRequestForSession(activeCliSessionId)
    : null

  // Count pending for this session only
  const sessionQueueCount = activeCliSessionId
    ? pendingRequests.filter((r) => r.sessionId === activeCliSessionId).length
    : 0

  const respond = useCallback(
    (decision: 'allow' | 'deny', alwaysAllow?: boolean) => {
      if (!request) return
      window.electron?.permission.respond(request.id, decision, undefined, alwaysAllow)
      removeRequest(request.id)
    },
    [request, removeRequest]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && request) {
        respond('deny')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [request, respond])

  if (!request) return null

  const summary = getToolSummary(request.toolName, request.toolInput)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            {getToolIcon(request.toolName)}
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">Permission Request</h2>
            <p className="text-xs text-muted-foreground">
              Agent wants to use <span className="font-medium text-foreground">{request.toolName}</span>
            </p>
          </div>
          {sessionQueueCount > 1 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
              +{sessionQueueCount - 1} pending
            </span>
          )}
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
            <pre className={cn(
              'overflow-x-auto whitespace-pre-wrap break-all text-sm',
              request.toolName === 'Bash' ? 'font-mono text-emerald-300' : 'text-zinc-300'
            )}>
              {summary}
            </pre>
          </div>

          {/* Full tool input for non-simple tools */}
          {!['Bash', 'Read'].includes(request.toolName) && Object.keys(request.toolInput).length > 1 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Full tool input
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-800/30 p-3 text-xs text-zinc-400 font-mono">
                {JSON.stringify(request.toolInput, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="destructive" size="sm" onClick={() => respond('deny')}>
            <IconShieldX className="size-4" />
            Deny
          </Button>
          <Button variant="outline" size="sm" onClick={() => respond('allow', true)}>
            <IconShieldCheck className="size-4" />
            Always Allow
          </Button>
          <Button variant="default" size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={() => respond('allow')}>
            <IconShieldCheck className="size-4" />
            Allow
          </Button>
        </div>
      </div>
    </div>
  )
}
