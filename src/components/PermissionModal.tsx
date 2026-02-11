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

/**
 * Interactive token selector for building a bash rule from a single command.
 * Tokens form a contiguous prefix — click a token to set the boundary.
 */
function BashTokenSelector({
  command,
  onRuleChange,
}: {
  command: string
  onRuleChange: (selectedTokens: string[] | null) => void
}) {
  const tokens = useMemo(() => tokenizeCommand(command), [command])
  const [selectedCount, setSelectedCount] = useState<number>(tokens.length)
  const [wildcard, setWildcard] = useState(false)

  useEffect(() => {
    setSelectedCount(tokens.length)
    setWildcard(false)
    onRuleChange(tokens.length > 0 ? tokens : null)
  }, [command]) // eslint-disable-line react-hooks/exhaustive-deps

  const emitRule = (count: number, wc: boolean) => {
    if (count <= 0) { onRuleChange(null); return }
    const prefix = tokens.slice(0, count)
    onRuleChange(wc && count < tokens.length ? [...prefix, '*'] : prefix)
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

  const selectedTokens = tokens.slice(0, selectedCount)
  const allSelected = selectedCount === tokens.length
  const showWildcard = !allSelected

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
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
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={() => { setWildcard(false); setPrefix(tokens.length) }}
            >
              Select all
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tokens.map((token, i) => (
          <button
            key={i}
            onClick={() => handleTokenClick(i)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-mono transition-all border',
              'hover:scale-105 active:scale-95',
              i < selectedCount
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 line-through'
            )}
          >
            {token}
          </button>
        ))}
        {showWildcard && wildcard && (
          <span className="rounded-md px-2 py-1 text-xs font-mono bg-amber-500/20 border border-amber-500/40 text-amber-300">
            *
          </span>
        )}
      </div>
      <p className="text-[10px] text-zinc-500 font-mono">
        Rule: <span className="text-emerald-400">{selectedTokens.join(' ')}{showWildcard && wildcard ? ' *' : ''}</span>
        {allSelected && <span className="text-zinc-600 ml-1">(exact command)</span>}
        {!allSelected && wildcard && <span className="text-zinc-600 ml-1">(prefix + any args)</span>}
        {!allSelected && !wildcard && <span className="text-zinc-600 ml-1">(exact only)</span>}
      </p>
    </div>
  )
}

export function PermissionModal() {
  const { pendingRequests, removeRequest, getNextRequestForSession } = usePermissionStore()
  const activeAgentSessionId = useTerminalStore((s) => s.activeAgentSessionId)

  // Per-sub-command rules for compound commands, keyed by sub-command index
  const [subCommandRules, setSubCommandRules] = useState<Map<number, string[] | null>>(new Map())
  // Single rule for simple (non-compound) commands
  const [singleRule, setSingleRule] = useState<string[] | null>(null)

  const activeCliSessionId = useAgentStreamStore(
    (s) => (activeAgentSessionId ? s.terminalToSession.get(activeAgentSessionId) : undefined)
  ) ?? null

  const request = activeCliSessionId
    ? getNextRequestForSession(activeCliSessionId)
    : null

  const sessionQueueCount = activeCliSessionId
    ? pendingRequests.filter((r) => r.sessionId === activeCliSessionId).length
    : 0

  const isBash = request?.toolName === 'Bash'
  const subCommandMatches = request?.subCommandMatches
  const isCompound = !!subCommandMatches && subCommandMatches.length > 1
  const unmatchedSubs = useMemo(
    () => subCommandMatches?.filter(s => !s.matched) ?? [],
    [subCommandMatches]
  )

  const respond = useCallback(
    (decision: 'allow' | 'deny', alwaysAllow?: boolean, rules?: string[][]) => {
      if (!request) return
      window.electron?.permission.respond(request.id, decision, undefined, alwaysAllow, rules)
      removeRequest(request.id)
      useToastStore.getState().removeToast(`permission-${request.id}`)
      setSubCommandRules(new Map())
      setSingleRule(null)
    },
    [request, removeRequest]
  )

  // When the permission modal is visible, blur any focused input/textarea so
  // keyboard shortcuts (A/D) work immediately without clicking the modal first.
  // Uses a focusin listener to catch delayed auto-focus (e.g. AgentInputArea's
  // 50ms setTimeout) that might fire after the initial blur.
  useEffect(() => {
    if (!request) return
    const blurIfInput = () => {
      const el = document.activeElement
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.blur()
      }
    }
    blurIfInput()
    document.addEventListener('focusin', blurIfInput)
    return () => document.removeEventListener('focusin', blurIfInput)
  }, [request?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!request) return
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

  // Collect rules for the "Always Allow Pattern" button
  const collectRules = (): string[][] | null => {
    if (isCompound) {
      const rules: string[][] = []
      for (const [, rule] of subCommandRules) {
        if (rule && rule.length > 0) rules.push(rule)
      }
      return rules.length > 0 ? rules : null
    } else {
      return singleRule && singleRule.length > 0 ? [singleRule] : null
    }
  }

  // Check if all unmatched sub-commands have rules configured
  const allUnmatchedHaveRules = isCompound
    ? unmatchedSubs.every((_, idx) => {
        const rule = subCommandRules.get(idx)
        return rule && rule.length > 0
      })
    : singleRule && singleRule.length > 0

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
          {isCompound ? (
            // Compound command: show each sub-command with match status
            <div className="space-y-1.5">
              {subCommandMatches!.map((sub, i) => {
                const unmatchedIdx = unmatchedSubs.indexOf(sub)
                return (
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
                    {sub.matched ? (
                      <div className="rounded-lg bg-zinc-800/30 border border-emerald-800/30 p-3 opacity-60">
                        <div className="flex items-center gap-2">
                          <IconShieldCheck className="size-3.5 text-emerald-500 shrink-0" />
                          <pre className="text-sm font-mono text-emerald-300/60 overflow-x-auto whitespace-pre-wrap break-all">
                            {sub.tokens.join(' ')}
                          </pre>
                          <span className="text-[10px] text-emerald-500/60 ml-auto shrink-0">rule exists</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm font-mono text-emerald-300">
                          {sub.tokens.join(' ')}
                        </pre>
                        <BashTokenSelector
                          command={sub.tokens.join(' ')}
                          onRuleChange={(rule) => {
                            setSubCommandRules(prev => {
                              const next = new Map(prev)
                              next.set(unmatchedIdx, rule)
                              return next
                            })
                          }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            // Simple command or non-Bash tool
            <>
              <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
                <pre className={cn(
                  'overflow-x-auto whitespace-pre-wrap break-all text-sm',
                  isBash ? 'font-mono text-emerald-300' : 'text-zinc-300'
                )}>
                  {summary}
                </pre>
              </div>
              {isBash && summary && (
                <BashTokenSelector
                  command={summary}
                  onRuleChange={setSingleRule}
                />
              )}
            </>
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
                disabled={!allUnmatchedHaveRules}
                onClick={() => {
                  const rules = collectRules()
                  if (rules) respond('allow', false, rules)
                }}
              >
                <IconShieldCheck className="size-4" />
                Always Allow {isCompound ? 'Patterns' : 'Pattern'}
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
