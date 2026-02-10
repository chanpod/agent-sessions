import { useState, useEffect, useCallback, useMemo } from 'react'
import { IconShieldCheck, IconShieldX, IconTerminal2, IconFile, IconTool } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { usePermissionStore } from '@/stores/permission-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useAgentStreamStore } from '@/stores/agent-stream-store'
import { useToastStore } from '@/stores/toast-store'
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

// Shell operators that separate independent commands.
// Mirrors the logic in permission-handler.cjs.
const SHELL_OPERATORS = new Set(['&&', '||', '|', ';'])

/**
 * Tokenize a shell command string into an array of tokens.
 * Mirrors the logic in permission-handler.cjs.
 */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escape = false

  for (const ch of command) {
    if (escape) {
      current += ch
      escape = false
      continue
    }
    if (ch === '\\' && !inSingle) {
      escape = true
      current += ch
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      continue
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

interface SubCommand {
  tokens: string[]
  operator: string | null // operator that precedes this sub-command (null for the first)
}

/**
 * Split a token array into sub-commands at shell operators (&&, ||, |, ;).
 * Mirrors the logic in permission-handler.cjs.
 */
function splitSubCommands(tokens: string[]): SubCommand[] {
  const subs: SubCommand[] = []
  let current: string[] = []
  let nextOperator: string | null = null

  for (const tok of tokens) {
    if (SHELL_OPERATORS.has(tok)) {
      if (current.length) subs.push({ tokens: current, operator: nextOperator })
      nextOperator = tok
      current = []
    } else if (tok.endsWith(';') && tok.length > 1) {
      current.push(tok.slice(0, -1))
      if (current.length) subs.push({ tokens: current, operator: nextOperator })
      nextOperator = ';'
      current = []
    } else {
      current.push(tok)
    }
  }
  if (current.length) subs.push({ tokens: current, operator: nextOperator })
  return subs
}

/**
 * Interactive token selector for building bash rules.
 * Tokens form a contiguous prefix — click a token to set the boundary.
 * Everything up to and including the clicked token is included in the rule;
 * everything after is excluded. This ensures the rule always matches a
 * real command (no gaps).
 */
function BashTokenSelector({
  command,
  onRuleChange,
}: {
  command: string
  onRuleChange: (selectedTokens: string[] | null) => void
}) {
  // Parse into flat tokens and structured sub-commands
  const tokens = useMemo(() => tokenizeCommand(command), [command])
  const subs = useMemo(() => splitSubCommands(tokens), [tokens])
  const isCompound = subs.length > 1

  // Build a flat list of non-operator tokens (operators are excluded from rules)
  const flatTokens = useMemo(() => {
    const flat: string[] = []
    for (const sub of subs) {
      for (const tok of sub.tokens) flat.push(tok)
    }
    return flat
  }, [subs])

  // selectedCount = number of non-operator tokens included from the start (prefix length)
  const [selectedCount, setSelectedCount] = useState<number>(flatTokens.length)
  const [wildcard, setWildcard] = useState(false)

  // Reset when command changes
  useEffect(() => {
    setSelectedCount(flatTokens.length)
    setWildcard(false)
    onRuleChange(flatTokens.length > 0 ? flatTokens : null)
  }, [command]) // eslint-disable-line react-hooks/exhaustive-deps

  const emitRule = (count: number, wc: boolean) => {
    if (count <= 0) { onRuleChange(null); return }
    const prefix = flatTokens.slice(0, count)
    onRuleChange(wc && count < flatTokens.length ? [...prefix, '*'] : prefix)
  }

  const setPrefix = (count: number) => {
    setSelectedCount(count)
    emitRule(count, wildcard)
  }

  const toggleWildcard = () => {
    const next = !wildcard
    setWildcard(next)
    emitRule(selectedCount, next)
  }

  const handleTokenClick = (index: number) => {
    if (index === selectedCount - 1 && selectedCount > 1) {
      setPrefix(index)
    } else {
      setPrefix(index + 1)
    }
  }

  const selectedTokens = flatTokens.slice(0, selectedCount)
  const allSelected = selectedCount === flatTokens.length
  const showWildcard = !allSelected

  // Render tokens grouped by sub-command with operator dividers
  let flatIndex = 0
  const renderGroups = subs.map((sub, si) => {
    const groupStart = flatIndex
    const groupTokens = sub.tokens.map((token, ti) => {
      const fi = groupStart + ti
      return (
        <button
          key={fi}
          onClick={() => handleTokenClick(fi)}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-mono transition-all border',
            'hover:scale-105 active:scale-95',
            fi < selectedCount
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 line-through'
          )}
        >
          {token}
        </button>
      )
    })
    flatIndex += sub.tokens.length
    return (
      <div key={si} className="flex flex-wrap items-center gap-1.5">
        {sub.operator && (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
            {sub.operator}
          </span>
        )}
        {groupTokens}
      </div>
    )
  })

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Click a token to set the rule boundary:
        </p>
        <div className="flex items-center gap-2">
          {showWildcard && (
            <button
              className={cn(
                'rounded-md px-1.5 py-0.5 text-xs font-mono border transition-all',
                'hover:scale-105 active:scale-95',
                wildcard
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 hover:text-zinc-300'
              )}
              onClick={toggleWildcard}
              title={wildcard ? 'Remove wildcard — match only this exact prefix' : 'Add wildcard — match this prefix with any additional args'}
            >
              *
            </button>
          )}
          {!allSelected && (
            <button
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={() => { setWildcard(false); setPrefix(flatTokens.length) }}
            >
              Select all
            </button>
          )}
        </div>
      </div>
      {isCompound ? (
        <div className="space-y-1.5">
          {renderGroups}
          {showWildcard && wildcard && (
            <span className="rounded-md px-2 py-1 text-xs font-mono bg-amber-500/20 border border-amber-500/40 text-amber-300">
              *
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {renderGroups}
          {showWildcard && wildcard && (
            <span className="rounded-md px-2 py-1 text-xs font-mono bg-amber-500/20 border border-amber-500/40 text-amber-300">
              *
            </span>
          )}
        </div>
      )}
      <p className="text-xs text-zinc-500 font-mono">
        Rule: <span className="text-emerald-400">{selectedTokens.join(' ')}{showWildcard && wildcard ? ' *' : ''}</span>
        {allSelected && <span className="text-zinc-600 ml-1">(exact command)</span>}
        {!allSelected && wildcard && <span className="text-zinc-600 ml-1">(matches prefix + any additional args)</span>}
        {!allSelected && !wildcard && <span className="text-zinc-600 ml-1">(matches only this, extra args will still prompt)</span>}
      </p>
      {isCompound && (
        <p className="text-[11px] text-amber-400/70">
          Compound command — each sub-command must match a rule independently.
        </p>
      )}
    </div>
  )
}

export function PermissionModal() {
  const { pendingRequests, removeRequest, getNextRequestForSession } = usePermissionStore()
  const activeAgentSessionId = useTerminalStore((s) => s.activeAgentSessionId)
  const [bashRule, setBashRule] = useState<string[] | null>(null)

  // Derive the CLI sessionId directly in the selector to avoid subscribing to the
  // entire terminalToSession Map reference (which changes on every store update and
  // causes infinite re-renders). This selector returns a primitive string|undefined,
  // so Zustand's default Object.is equality check prevents unnecessary re-renders.
  const activeCliSessionId = useAgentStreamStore(
    (s) => (activeAgentSessionId ? s.terminalToSession.get(activeAgentSessionId) : undefined)
  ) ?? null

  // Only show requests belonging to the active session
  const request = activeCliSessionId
    ? getNextRequestForSession(activeCliSessionId)
    : null

  // Count pending for this session only
  const sessionQueueCount = activeCliSessionId
    ? pendingRequests.filter((r) => r.sessionId === activeCliSessionId).length
    : 0

  const isBash = request?.toolName === 'Bash'
  const subCommands = useMemo(() => {
    if (!isBash || !request) return []
    const cmd = String(request.toolInput.command ?? '')
    if (!cmd) return []
    return splitSubCommands(tokenizeCommand(cmd))
  }, [isBash, request])

  const respond = useCallback(
    (decision: 'allow' | 'deny', alwaysAllow?: boolean, rule?: string[]) => {
      if (!request) return
      window.electron?.permission.respond(request.id, decision, undefined, alwaysAllow, rule)
      removeRequest(request.id)
      useToastStore.getState().removeToast(`permission-${request.id}`)
      setBashRule(null)
    },
    [request, removeRequest]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!request) return
      // Ignore shortcuts when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Escape' || e.key === 'd' || e.key === 'D') {
        respond('deny')
      } else if (e.key === 'a' || e.key === 'A') {
        respond('allow')
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
          {isBash && subCommands.length > 1 ? (
            <div className="space-y-1.5">
              {subCommands.map((sub, i) => (
                <div key={i}>
                  {sub.operator && (
                    <div className="flex items-center gap-2 py-1">
                      <div className="h-px flex-1 bg-zinc-700/50" />
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        {sub.operator}
                      </span>
                      <div className="h-px flex-1 bg-zinc-700/50" />
                    </div>
                  )}
                  <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm font-mono text-emerald-300">
                      {sub.tokens.join(' ')}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
              <pre className={cn(
                'overflow-x-auto whitespace-pre-wrap break-all text-sm',
                request.toolName === 'Bash' ? 'font-mono text-emerald-300' : 'text-zinc-300'
              )}>
                {summary}
              </pre>
            </div>
          )}

          {/* Bash token selector */}
          {isBash && summary && (
            <BashTokenSelector
              command={summary}
              onRuleChange={setBashRule}
            />
          )}

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
        <div className="border-t border-border px-5 py-3">
          <div className="flex items-center justify-end gap-2">
            <Button variant="destructive" size="sm" onClick={() => respond('deny')}>
              <IconShieldX className="size-4" />
              Deny <kbd className="ml-1 text-[10px] opacity-60">D</kbd>
            </Button>
            {isBash ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!bashRule || bashRule.length === 0}
                onClick={() => {
                  if (bashRule && bashRule.length > 0) {
                    respond('allow', false, bashRule)
                  }
                }}
              >
                <IconShieldCheck className="size-4" />
                Always Allow Pattern
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => respond('allow', true)}>
                <IconShieldCheck className="size-4" />
                Always Allow
              </Button>
            )}
            <Button variant="default" size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={() => respond('allow')}>
              <IconShieldCheck className="size-4" />
              Allow <kbd className="ml-1 text-[10px] opacity-60">A</kbd>
            </Button>
          </div>
          {isBash && (
            <div className="mt-2 flex justify-end">
              <button
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors underline underline-offset-2"
                onClick={() => respond('allow', true)}
              >
                Always allow all Bash commands
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
