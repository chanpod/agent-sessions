import { useState, useEffect, useCallback, useMemo } from 'react'

/**
 * Tokenize a shell command string into an array of tokens.
 * Must stay in sync with the copies in permission-handler.cjs and permission-server.ts.
 */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escape = false

  for (const ch of command) {
    if (escape) { current += ch; escape = false; continue }
    if (ch === '\\' && !inSingle) { escape = true; current += ch; continue }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) { tokens.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

const SHELL_OPERATORS = new Set(['&&', '||', '|', ';'])

/**
 * Split a token array into sub-commands at shell operators.
 * Must stay in sync with the copies in permission-handler.cjs and permission-server.ts.
 */
function splitSubCommands(tokens: string[]): string[][] {
  const subs: string[][] = []
  let current: string[] = []
  for (const tok of tokens) {
    if (SHELL_OPERATORS.has(tok)) {
      if (current.length) subs.push(current)
      current = []
    } else if (tok.endsWith(';') && tok.length > 1) {
      current.push(tok.slice(0, -1))
      if (current.length) subs.push(current)
      current = []
    } else {
      current.push(tok)
    }
  }
  if (current.length) subs.push(current)
  return subs
}

function matchesSingleRule(tokens: string[], bashRules: string[][]): string[] | null {
  for (const rule of bashRules) {
    if (!Array.isArray(rule) || rule.length === 0) continue
    const isWildcard = rule[rule.length - 1] === '*'
    if (isWildcard) {
      const prefixLen = rule.length - 1
      if (tokens.length >= prefixLen && rule.slice(0, prefixLen).every((t, i) => t === tokens[i])) {
        return rule
      }
    } else {
      if (rule.length === tokens.length && rule.every((t, i) => t === tokens[i])) {
        return rule
      }
    }
  }
  return null
}

/**
 * Tools that are hardcoded as always-safe in the hook script (Gate 2).
 * Must stay in sync with SAFE_TOOLS in permission-handler.cjs.
 */
const SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'Task', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode',
  'Skill', 'AskUserQuestion',
])

export type AutoAllowMatch =
  | { type: 'safe-tool' }
  | { type: 'bash-rule'; rule: string[] }
  | { type: 'blanket-tool'; toolName: string }

/**
 * Hook that loads the full permission allowlist config for a project and provides:
 * - `checkAutoAllow(toolName, toolInput)` — returns match info or null
 * - `revokeBashRule(rule)` — removes a bash rule and refreshes
 * - `revokeToolAllow(toolName)` — removes a blanket tool allow and refreshes
 */
export function useBashRules(projectPath: string | null | undefined) {
  const [tools, setTools] = useState<string[]>([])
  const [bashRules, setBashRules] = useState<string[][]>([])

  const loadConfig = useCallback(async () => {
    if (!projectPath || !window.electron?.permission?.getAllowlistConfig) {
      setTools([])
      setBashRules([])
      return
    }
    const config = await window.electron.permission.getAllowlistConfig(projectPath)
    setTools(config?.tools ?? [])
    setBashRules(config?.bashRules ?? [])
  }, [projectPath])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const checkAutoAllow = useMemo(() => {
    return (toolName: string, inputJson: string): AutoAllowMatch | null => {
      // Gate 2: hardcoded safe tools (always allowed, not revocable)
      if (SAFE_TOOLS.has(toolName)) {
        return { type: 'safe-tool' }
      }

      // Gate 3a: for Bash, check granular rules first (same priority as the hook)
      // Compound commands are split at shell operators; every sub-command must match.
      if (toolName === 'Bash') {
        try {
          const parsed = JSON.parse(inputJson)
          if (typeof parsed.command === 'string' && bashRules.length > 0) {
            const tokens = tokenizeCommand(parsed.command.trim())
            const subCommands = splitSubCommands(tokens)
            if (subCommands.length > 0) {
              let allMatched = true
              let firstRule: string[] | null = null
              for (const sub of subCommands) {
                const rule = matchesSingleRule(sub, bashRules)
                if (!rule) { allMatched = false; break }
                if (!firstRule) firstRule = rule
              }
              if (allMatched && firstRule) {
                return { type: 'bash-rule', rule: firstRule }
              }
            }
          }
        } catch { /* invalid input JSON — fall through */ }
      }

      // Then check blanket tool allow
      if (tools.includes(toolName)) {
        return { type: 'blanket-tool', toolName }
      }

      return null
    }
  }, [tools, bashRules])

  const revokeBashRule = useCallback(async (rule: string[]) => {
    if (!projectPath || !window.electron?.permission?.removeBashRule) return
    await window.electron.permission.removeBashRule(projectPath, rule)
    await loadConfig()
  }, [projectPath, loadConfig])

  const revokeToolAllow = useCallback(async (toolName: string) => {
    if (!projectPath || !window.electron?.permission?.removeAllowedTool) return
    await window.electron.permission.removeAllowedTool(projectPath, toolName)
    await loadConfig()
  }, [projectPath, loadConfig])

  return { tools, bashRules, checkAutoAllow, revokeBashRule, revokeToolAllow, refreshConfig: loadConfig }
}
