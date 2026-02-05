import { useRef, useEffect, useState, useMemo } from 'react'
import { IconBug, IconChevronDown, IconChevronUp, IconTrash } from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStreamStore } from '@/stores/agent-stream-store'
import { cn } from '@/lib/utils'
import type { DebugEventEntry } from '@/types/stream-json'

interface DebugEventLogProps {
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
  'agent-text-delta': 'text-zinc-500',
  'agent-thinking-delta': 'text-purple-500',
  'agent-tool-input-delta': 'text-zinc-500',
  'agent-error': 'text-red-400',
  'agent-process-exit': 'text-red-500',
  'agent-session-init': 'text-green-400',
}

/** Short labels for event types */
const EVENT_SHORT: Record<string, string> = {
  'agent-message-start': 'MSG_START',
  'agent-message-end': 'MSG_END',
  'agent-tool-start': 'TOOL_START',
  'agent-tool-end': 'TOOL_END',
  'agent-block-end': 'BLK_END',
  'agent-text-delta': 'TXT_Δ',
  'agent-thinking-delta': 'THINK_Δ',
  'agent-tool-input-delta': 'TOOL_Δ',
  'agent-error': 'ERROR',
  'agent-process-exit': 'PROC_EXIT',
  'agent-session-init': 'SESS_INIT',
}

/** Filter delta events (very noisy) */
const DELTA_TYPES = new Set(['agent-text-delta', 'agent-thinking-delta', 'agent-tool-input-delta'])

function EventRow({ entry }: { entry: DebugEventEntry }) {
  const color = EVENT_COLORS[entry.type] ?? 'text-zinc-400'
  const label = EVENT_SHORT[entry.type] ?? entry.type
  const time = new Date(entry.timestamp).toISOString().slice(11, 23) // HH:mm:ss.SSS

  return (
    <div className="flex items-start gap-2 font-mono text-[10px] leading-4 px-2 hover:bg-zinc-800/50">
      <span className="text-zinc-600 shrink-0 w-20">{time}</span>
      <span className={cn('shrink-0 w-20 font-semibold', color)}>{label}</span>
      <span className="text-zinc-500 shrink-0">
        active={entry.isActiveAfter ? '✓' : '✗'}
        {' '}exited={entry.processExitedAfter ? '✓' : '✗'}
      </span>
      <span className="text-zinc-400 truncate">{entry.summary}</span>
    </div>
  )
}

export function DebugEventLog({ processIds }: DebugEventLogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showDeltas, setShowDeltas] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Gather debug events from all active processes.
  // Use useShallow so the selector only triggers re-renders when the per-terminal
  // debugEvents arrays actually change (shallow compare of the collected arrays).
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

  // Sort by index and optionally filter deltas
  const filteredEvents = useMemo(() => {
    const sorted = [...allDebugEvents].sort((a, b) => a.index - b.index)
    if (showDeltas) return sorted
    return sorted.filter((e) => !DELTA_TYPES.has(e.type))
  }, [allDebugEvents, showDeltas])

  // Count of filtered-out delta events
  const deltaCount = useMemo(
    () => allDebugEvents.filter((e) => DELTA_TYPES.has(e.type)).length,
    [allDebugEvents],
  )

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredEvents.length, isOpen])

  // Summary counts for the collapsed header
  const summary = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of allDebugEvents) {
      const label = EVENT_SHORT[e.type] ?? e.type
      counts[label] = (counts[label] ?? 0) + 1
    }
    return counts
  }, [allDebugEvents])

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
  }

  if (allDebugEvents.length === 0 && !isOpen) return null

  return (
    <div className="border-t border-zinc-800">
      {/* Toggle header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-4 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800/50 transition-colors"
      >
        <IconBug className="size-3.5" />
        <span className="font-medium">Debug Events</span>
        <span className="text-zinc-600">({allDebugEvents.length})</span>

        {/* Mini summary when collapsed */}
        {!isOpen && (
          <span className="flex gap-2 ml-2 text-[10px] text-zinc-600">
            {Object.entries(summary).map(([label, count]) => (
              <span key={label}>{label}:{count}</span>
            ))}
          </span>
        )}

        <span className="ml-auto">
          {isOpen ? <IconChevronDown className="size-3.5" /> : <IconChevronUp className="size-3.5" />}
        </span>
      </button>

      {/* Event list */}
      {isOpen && (
        <div className="border-t border-zinc-800/50">
          {/* Controls bar */}
          <div className="flex items-center gap-3 px-4 py-1 text-[10px] text-zinc-600 border-b border-zinc-800/50">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showDeltas}
                onChange={(e) => setShowDeltas(e.target.checked)}
                className="size-3"
              />
              Show deltas ({deltaCount})
            </label>
            <button
              onClick={handleClear}
              className="flex items-center gap-1 hover:text-zinc-400 transition-colors"
            >
              <IconTrash className="size-3" />
              Clear
            </button>
            <span className="ml-auto text-zinc-700">
              {filteredEvents.length} events
            </span>
          </div>

          {/* Scrollable event rows */}
          <div
            ref={scrollRef}
            className="max-h-48 overflow-y-auto bg-zinc-950/50"
          >
            {filteredEvents.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-600 italic">No events yet</div>
            ) : (
              filteredEvents.map((entry) => (
                <EventRow key={entry.index} entry={entry} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
