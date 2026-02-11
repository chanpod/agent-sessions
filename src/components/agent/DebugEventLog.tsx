import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { IconBug, IconTrash, IconX, IconChevronDown, IconChevronRight, IconFolderOpen, IconSearch, IconFilter } from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStreamStore } from '@/stores/agent-stream-store'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { DebugEventEntry } from '@/types/stream-json'

interface DebugEventSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All process IDs for this conversation */
  processIds: Set<string>
}

/** Color coding for event types to make state transitions visually obvious */
const EVENT_COLORS: Record<string, string> = {
  'agent-message-start': 'text-blue-400',
  'agent-message-end': 'text-amber-400',
  'agent-tool-start': 'text-cyan-400',
  'agent-tool-end': 'text-cyan-600',
  'agent-block-end': 'text-cyan-600',
  'agent-tool-result': 'text-teal-400',
  'agent-text-delta': 'text-zinc-500',
  'agent-thinking-delta': 'text-purple-500',
  'agent-tool-input-delta': 'text-zinc-500',
  'agent-error': 'text-red-400',
  'agent-process-exit': 'text-red-500',
  'agent-session-init': 'text-green-400',
  'agent-session-result': 'text-emerald-400',
  'agent-system-event': 'text-yellow-400',
}

/** Short labels for event types */
const EVENT_SHORT: Record<string, string> = {
  'agent-message-start': 'MSG_START',
  'agent-message-end': 'MSG_END',
  'agent-tool-start': 'TOOL_START',
  'agent-tool-end': 'TOOL_END',
  'agent-block-end': 'BLK_END',
  'agent-tool-result': 'TOOL_RESULT',
  'agent-text-delta': 'TXT_\u0394',
  'agent-thinking-delta': 'THINK_\u0394',
  'agent-tool-input-delta': 'TOOL_\u0394',
  'agent-error': 'ERROR',
  'agent-process-exit': 'PROC_EXIT',
  'agent-session-init': 'SESS_INIT',
  'agent-session-result': 'RESULT',
  'agent-system-event': 'SYSTEM',
}

/** Background color for event type badges */
const EVENT_BG: Record<string, string> = {
  'agent-message-start': 'bg-blue-500/10',
  'agent-message-end': 'bg-amber-500/10',
  'agent-tool-start': 'bg-cyan-500/10',
  'agent-tool-result': 'bg-teal-500/10',
  'agent-error': 'bg-red-500/10',
  'agent-process-exit': 'bg-red-500/10',
  'agent-session-init': 'bg-green-500/10',
  'agent-session-result': 'bg-emerald-500/10',
  'agent-system-event': 'bg-yellow-500/10',
}

/** Filter delta events (very noisy) */
const DELTA_TYPES = new Set(['agent-text-delta', 'agent-thinking-delta', 'agent-tool-input-delta'])

/** Structural (important) event types */
const STRUCTURAL_TYPES = new Set([
  'agent-message-start', 'agent-message-end',
  'agent-tool-start', 'agent-tool-end', 'agent-tool-result',
  'agent-block-end',
  'agent-error', 'agent-process-exit',
  'agent-session-init', 'agent-session-result', 'agent-system-event',
])

type FilterMode = 'all' | 'no-deltas' | 'structural'

function StateFlag({ label, value, warning }: { label: string; value: boolean; warning?: boolean }) {
  return (
    <span className={cn(
      'px-1 rounded text-[9px] font-medium',
      value
        ? warning ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/15 text-green-400'
        : 'bg-zinc-800 text-zinc-600',
    )}>
      {label}
    </span>
  )
}

function EventRow({ entry, isExpanded, onToggle }: { entry: DebugEventEntry; isExpanded: boolean; onToggle: () => void }) {
  const color = EVENT_COLORS[entry.type] ?? 'text-zinc-400'
  const bg = EVENT_BG[entry.type] ?? ''
  const label = EVENT_SHORT[entry.type] ?? entry.type.replace('agent-', '')
  const time = new Date(entry.timestamp).toISOString().slice(11, 23) // HH:mm:ss.SSS
  const isDelta = DELTA_TYPES.has(entry.type)
  const isError = entry.type === 'agent-error' || entry.type === 'agent-process-exit'
  const hasDetails = entry.rawData != null || entry.stateSnapshot != null

  return (
    <div className={cn(
      'border-b border-zinc-800/50',
      isError && 'bg-red-500/5',
    )}>
      {/* Main row */}
      <div
        className={cn(
          'flex items-center gap-1.5 font-mono text-[10px] leading-5 px-2 cursor-pointer select-none',
          'hover:bg-zinc-800/50 transition-colors',
          isDelta && 'opacity-60',
        )}
        onClick={onToggle}
      >
        {/* Expand chevron */}
        {hasDetails ? (
          isExpanded
            ? <IconChevronDown className="size-3 shrink-0 text-zinc-500" />
            : <IconChevronRight className="size-3 shrink-0 text-zinc-600" />
        ) : (
          <span className="size-3 shrink-0" />
        )}

        {/* Index */}
        <span className="text-zinc-700 shrink-0 w-8 text-right tabular-nums">
          {entry.index}
        </span>

        {/* Timestamp */}
        <span className="text-zinc-500 shrink-0 w-[76px] tabular-nums">{time}</span>

        {/* Event type badge */}
        <span className={cn(
          'shrink-0 px-1.5 py-0 rounded font-semibold text-[9px] leading-4',
          color, bg,
        )}>
          {label}
        </span>

        {/* State flags */}
        <span className="flex gap-0.5 shrink-0">
          <StateFlag label="ACT" value={entry.isActiveAfter} />
          <StateFlag label="EXIT" value={entry.processExitedAfter} warning />
          {entry.stateSnapshot?.isWaitingForResponse && (
            <StateFlag label="WAIT" value={true} warning />
          )}
          {entry.stateSnapshot?.isWaitingForQuestion && (
            <StateFlag label="Q?" value={true} warning />
          )}
        </span>

        {/* Summary */}
        <span className="text-zinc-400 truncate ml-1">{entry.summary}</span>
      </div>

      {/* Expanded detail panel */}
      {isExpanded && hasDetails && (
        <div className="px-2 pb-2 pl-8 font-mono text-[10px] space-y-1.5">
          {/* State snapshot */}
          {entry.stateSnapshot && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-500">
              <span>msgId={entry.stateSnapshot.currentMessageId ?? 'null'}</span>
              <span>msgs={entry.stateSnapshot.messageCount}</span>
              <span>blocks={entry.stateSnapshot.currentBlockCount}</span>
              <span>waiting={String(entry.stateSnapshot.isWaitingForResponse)}</span>
              <span>question={String(entry.stateSnapshot.isWaitingForQuestion)}</span>
            </div>
          )}

          {/* Terminal ID */}
          {entry.terminalId && (
            <div className="text-zinc-600">
              pid={entry.terminalId.substring(0, 20)}...
            </div>
          )}

          {/* Raw data */}
          {entry.rawData != null && (
            <pre className="text-[9px] leading-3.5 text-zinc-500 bg-zinc-900/80 rounded px-2 py-1.5 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
              {JSON.stringify(entry.rawData, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function DebugEventSheet({ open, onOpenChange, processIds }: DebugEventSheetProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('no-deltas')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Gather debug events from all active processes.
  const perProcessEvents = useAgentStreamStore(
    useShallow((store) => {
      const result: (DebugEventEntry[] | undefined)[] = []
      for (const pid of processIds) {
        result.push(store.terminals.get(pid)?.debugEvents)
      }
      return result
    })
  )
  const allDebugEvents = useMemo(
    () => perProcessEvents.flatMap((events) => events ?? []),
    [perProcessEvents],
  )

  // Sort and filter
  const filteredEvents = useMemo(() => {
    let sorted = [...allDebugEvents].sort((a, b) => a.index - b.index)

    // Apply filter mode
    if (filterMode === 'no-deltas') {
      sorted = sorted.filter((e) => !DELTA_TYPES.has(e.type))
    } else if (filterMode === 'structural') {
      sorted = sorted.filter((e) => STRUCTURAL_TYPES.has(e.type))
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      sorted = sorted.filter((e) =>
        e.type.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        (e.rawData && JSON.stringify(e.rawData).toLowerCase().includes(q))
      )
    }

    return sorted
  }, [allDebugEvents, filterMode, searchQuery])

  // Counts
  const deltaCount = useMemo(
    () => allDebugEvents.filter((e) => DELTA_TYPES.has(e.type)).length,
    [allDebugEvents],
  )
  const errorCount = useMemo(
    () => allDebugEvents.filter((e) => e.type === 'agent-error' || (e.type === 'agent-process-exit' && e.rawData && (e.rawData as Record<string, unknown>).exitCode !== 0)).length,
    [allDebugEvents],
  )

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (open && autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredEvents.length, open, autoScroll])

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(isAtBottom)
  }, [])

  const toggleExpanded = useCallback((index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const handleClear = () => {
    useAgentStreamStore.setState((state) => {
      const terminals = new Map(state.terminals)
      for (const pid of processIds) {
        const ts = terminals.get(pid)
        if (ts) {
          terminals.set(pid, { ...ts, debugEvents: [] })
        }
      }
      return { terminals }
    })
    setExpandedIndices(new Set())
  }

  const handleOpenLogFolder = async () => {
    try {
      await window.electron?.log.openEventLogFolder()
    } catch {
      // fallback — log folder might not exist yet
    }
  }

  const expandAll = () => {
    setExpandedIndices(new Set(filteredEvents.map((e) => e.index)))
  }

  const collapseAll = () => {
    setExpandedIndices(new Set())
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="flex flex-col w-[560px] max-w-[90vw] p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border/30">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-full bg-orange-500/15">
                <IconBug className="size-3.5 text-orange-400" />
              </div>
              Debug Events
              <span className="text-xs font-normal text-muted-foreground">
                ({allDebugEvents.length})
              </span>
              {errorCount > 0 && (
                <span className="text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 rounded">
                  {errorCount} errors
                </span>
              )}
            </SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(
                'size-9 inline-flex items-center justify-center rounded-md',
                'text-muted-foreground hover:text-foreground hover:bg-accent',
                'transition-colors cursor-pointer',
              )}
              aria-label="Close"
            >
              <IconX className="size-4" />
            </button>
          </div>
          <SheetDescription>
            Raw event stream from the agent process. Click rows to inspect full data.
          </SheetDescription>
        </SheetHeader>

        {/* Search bar */}
        <div className="px-3 py-2 border-b border-border/30">
          <div className="relative">
            <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events (type, summary, data)..."
              className="w-full pl-7 pr-2 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            />
          </div>
        </div>

        {/* Controls bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/30 flex-wrap">
          {/* Filter mode */}
          <div className="flex items-center gap-1">
            <IconFilter className="size-3 text-zinc-500" />
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-zinc-300 cursor-pointer"
            >
              <option value="all">All ({allDebugEvents.length})</option>
              <option value="no-deltas">No deltas ({allDebugEvents.length - deltaCount})</option>
              <option value="structural">Structural only</option>
            </select>
          </div>

          {/* Actions */}
          <button
            onClick={expandAll}
            className="hover:text-foreground transition-colors px-1"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="hover:text-foreground transition-colors px-1"
          >
            Collapse all
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-0.5 hover:text-foreground transition-colors px-1"
          >
            <IconTrash className="size-2.5" />
            Clear
          </button>
          <button
            onClick={handleOpenLogFolder}
            className="flex items-center gap-0.5 hover:text-foreground transition-colors px-1"
            title="Open event log folder (full server-side NDJSON log)"
          >
            <IconFolderOpen className="size-2.5" />
            Log file
          </button>

          <span className="ml-auto flex items-center gap-2 text-muted-foreground/60">
            {!autoScroll && (
              <button
                onClick={() => {
                  setAutoScroll(true)
                  if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
                }}
                className="text-blue-400 hover:text-blue-300"
              >
                Resume scroll
              </button>
            )}
            {filteredEvents.length} shown
          </span>
        </div>

        {/* Scrollable event rows */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-zinc-950/50"
          onScroll={handleScroll}
        >
          {filteredEvents.length === 0 ? (
            <div className="px-4 py-8 text-xs text-muted-foreground/60 italic text-center">
              {searchQuery ? 'No events match search' : 'No events yet'}
            </div>
          ) : (
            filteredEvents.map((entry) => (
              <EventRow
                key={entry.index}
                entry={entry}
                isExpanded={expandedIndices.has(entry.index)}
                onToggle={() => toggleExpanded(entry.index)}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
