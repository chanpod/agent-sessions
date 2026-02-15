import { Bot, Code, Gem, Sparkles, RotateCcw, Trash2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ArchivedSessionConfig } from '@/stores/terminal-store'
import { formatTimeAgo } from '@/lib/utils'

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

interface ArchivedSessionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  archivedConfigs: ArchivedSessionConfig[]
  onRestore: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onDeleteAll: () => void
}

export function ArchivedSessionsSheet({
  open,
  onOpenChange,
  archivedConfigs,
  onRestore,
  onDelete,
  onDeleteAll,
}: ArchivedSessionsSheetProps) {
  const sorted = [...archivedConfigs].sort((a, b) => b.archivedAt - a.archivedAt)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Archived Sessions</SheetTitle>
          <SheetDescription>
            {sorted.length} archived session{sorted.length !== 1 ? 's' : ''}
          </SheetDescription>
          {sorted.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
              onClick={() => {
                if (confirm(`Delete all ${sorted.length} archived sessions? This cannot be undone.`)) {
                  onDeleteAll()
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete All
            </Button>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-4 px-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No archived sessions
            </div>
          ) : (
            <div className="space-y-1">
              {sorted.map((archived) => (
                <div
                  key={archived.config.sessionId}
                  className="group flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50"
                >
                  <AgentIcon
                    id={archived.agentType}
                    className="w-4 h-4 shrink-0 text-muted-foreground"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {archived.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {archived.agentType}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(archived.archivedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        onRestore(archived.config.sessionId!)
                        onOpenChange(false)
                      }}
                      className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10"
                      title="Restore session"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onDelete(archived.config.sessionId!)}
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                      title="Permanently delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
