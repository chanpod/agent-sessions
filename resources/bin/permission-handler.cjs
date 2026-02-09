#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const POLL_INTERVAL_MS = 100
const TIMEOUT_MS = 30000 // 30 seconds - deny if app doesn't respond
const HEARTBEAT_STALE_MS = 10000 // Consider app dead if heartbeat > 10s old
const ALLOWLIST_FILENAME = 'permission-allowlist.json'

// Tools that are always safe to allow without prompting.
// Only potentially destructive tools (Bash, Edit, Write, NotebookEdit) need approval.
const SAFE_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoWrite',
  'EnterPlanMode',
  'ExitPlanMode',
  'Skill',
  'AskUserQuestion',
])

// Tools that must be denied so the host application can handle them.
// Currently empty — AskUserQuestion was moved to SAFE_TOOLS because denying it
// at the hook level blocks the tool entirely. The CLI emits the tool_use event
// in the stream regardless, so the app can capture and render custom UI.
const HOST_HANDLED_TOOLS = new Set([
])

function toCliResponse(decision, reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  })
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
  })
}

function waitForResponse(responsePath) {
  return new Promise((resolve) => {
    const deadline = Date.now() + TIMEOUT_MS
    const check = () => {
      try {
        if (fs.existsSync(responsePath)) {
          const data = fs.readFileSync(responsePath, 'utf8')
          try { fs.unlinkSync(responsePath) } catch {}
          try {
            const requestPath = responsePath.replace('.response', '.request')
            fs.unlinkSync(requestPath)
          } catch {}
          resolve(JSON.parse(data))
          return
        }
      } catch {}
      if (Date.now() > deadline) {
        resolve({ decision: 'deny', reason: 'Permission request timed out' })
        return
      }
      setTimeout(check, POLL_INTERVAL_MS)
    }
    check()
  })
}

const DEBUG_LOG = path.join(require('os').tmpdir(), 'permission-handler-debug.log')

function debug(msg) {
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

/**
 * Check if the Agent Sessions app is actively watching this IPC directory.
 * The app writes a .active heartbeat file every few seconds. If it's missing
 * or stale, the app isn't running and we should abstain.
 */
function isAppActive(ipcDir) {
  const heartbeatPath = path.join(ipcDir, '.active')
  try {
    if (!fs.existsSync(heartbeatPath)) return false
    const stat = fs.statSync(heartbeatPath)
    const age = Date.now() - stat.mtimeMs
    return age < HEARTBEAT_STALE_MS
  } catch {
    return false
  }
}

/**
 * Load the user's permission config from .claude/permission-allowlist.json.
 * The IPC dir is .claude/.permission-ipc, so the allowlist is one level up.
 *
 * Supports two formats:
 *   Legacy:  ["Edit", "Write", "Bash"]
 *   Current: { "tools": ["Edit", "Write"], "bashRules": [["git","status"], ["npm","test"]] }
 *
 * Returns { tools: string[], bashRules: string[][] }
 */
function loadAllowlist(ipcDir) {
  const allowlistPath = path.join(path.dirname(ipcDir), ALLOWLIST_FILENAME)
  try {
    const data = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
    // Legacy format: plain array of tool names
    if (Array.isArray(data)) {
      return { tools: data, bashRules: [] }
    }
    // Current format: object with tools[] and bashRules[][]
    return {
      tools: Array.isArray(data.tools) ? data.tools : [],
      bashRules: Array.isArray(data.bashRules) ? data.bashRules : [],
    }
  } catch {
    return { tools: [], bashRules: [] }
  }
}

/**
 * Tokenize a shell command string into an array of tokens.
 * Handles quoted strings (single/double) as single tokens.
 */
function tokenizeCommand(command) {
  const tokens = []
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
 * Check if a Bash command matches any of the user's bash rules.
 * Each rule is an array of tokens. If the last token is '*', the rule
 * matches any command whose prefix tokens match (wildcard suffix).
 * Otherwise, the rule requires an exact token-count and token-value match.
 */
function matchesBashRule(command, bashRules) {
  if (!bashRules.length) return false
  const tokens = tokenizeCommand(command.trim())
  for (const rule of bashRules) {
    if (!Array.isArray(rule) || rule.length === 0) continue
    const isWildcard = rule[rule.length - 1] === '*'
    if (isWildcard) {
      // Prefix match: command must have at least as many tokens as rule minus the '*'
      const prefixLen = rule.length - 1
      if (tokens.length < prefixLen) continue
      let match = true
      for (let i = 0; i < prefixLen; i++) {
        if (tokens[i] !== rule[i]) { match = false; break }
      }
      if (match) return true
    } else {
      // Exact match: same token count, every token must match
      if (tokens.length !== rule.length) continue
      let match = true
      for (let i = 0; i < rule.length; i++) {
        if (tokens[i] !== rule[i]) { match = false; break }
      }
      if (match) return true
    }
  }
  return false
}

async function main() {
  debug(`Hook started. argv: ${JSON.stringify(process.argv)}`)

  const ipcDir = process.argv[2]
  if (!ipcDir) {
    debug('No IPC dir, abstaining')
    return // No stdout = abstain = CLI uses normal permission flow
  }

  // Gate 1: Only activate when the Agent Sessions app is actively watching.
  // If the app isn't running, abstain so the CLI uses its normal permission flow.
  if (!isAppActive(ipcDir)) {
    debug('App not active (no recent heartbeat), abstaining')
    return // No stdout = abstain = CLI uses normal permission flow
  }

  debug(`IPC dir: ${ipcDir}, app is active`)
  const input = await readStdin()
  debug(`Stdin received (${input.length} bytes)`)

  // Parse the hook input once — we need tool_name and tool_input for Bash rules.
  let toolName = null
  let toolInput = {}
  try {
    const parsed = JSON.parse(input)
    toolName = parsed.tool_name
    toolInput = parsed.tool_input || {}
  } catch {}

  // Gate 2a: Deny host-handled tools so the embedding app can manage them.
  // The tool_use block is still emitted in the stream (PreToolUse fires after streaming),
  // so the app can capture the tool input and render custom UI.
  if (toolName && HOST_HANDLED_TOOLS.has(toolName)) {
    debug(`Tool "${toolName}" is host-handled, denying so app can manage it`)
    process.stdout.write(toCliResponse('deny',
      'This tool is handled by the host application. ' +
      'The user will see your question and their answer will be delivered in the next message. ' +
      'Do NOT repeat the question or try this tool again. Wait for the user\'s response.'
    ))
    return
  }

  if (toolName && SAFE_TOOLS.has(toolName)) {
    debug(`Tool "${toolName}" is in safe list, auto-allowing`)
    process.stdout.write(toCliResponse('allow'))
    return
  }

  // Gate 3: Check user's always-allow list
  const allowlist = loadAllowlist(ipcDir)

  // Gate 3a: For Bash, check granular bash rules before the blanket tool allowlist.
  // Bash rules are exact token-match patterns created by the user via the permission modal.
  if (toolName === 'Bash' && toolInput.command) {
    if (matchesBashRule(String(toolInput.command), allowlist.bashRules)) {
      debug(`Bash command matches a rule, auto-allowing: ${String(toolInput.command).slice(0, 100)}`)
      process.stdout.write(toCliResponse('allow'))
      return
    }
  }

  // Gate 3b: Blanket tool allowlist (non-Bash tools, or Bash if explicitly in tools[])
  if (toolName && allowlist.tools.includes(toolName)) {
    debug(`Tool "${toolName}" is in user allowlist, auto-allowing`)
    process.stdout.write(toCliResponse('allow'))
    return
  }

  debug(`Tool "${toolName}" requires permission, forwarding to app`)

  const id = crypto.randomUUID()
  const requestPath = path.join(ipcDir, `${id}.request`)
  const responsePath = path.join(ipcDir, `${id}.response`)
  debug(`Request: ${requestPath}`)

  try {
    if (!fs.existsSync(ipcDir)) {
      fs.mkdirSync(ipcDir, { recursive: true })
    }
  } catch (err) {
    debug(`Failed to create IPC dir: ${err.message}, denying`)
    process.stdout.write(toCliResponse('deny', 'Permission system unavailable'))
    return
  }

  try {
    fs.writeFileSync(requestPath, input, 'utf8')
    debug('Request file written')
  } catch (err) {
    debug(`Failed to write request: ${err.message}, denying`)
    process.stdout.write(toCliResponse('deny', 'Permission system unavailable'))
    return
  }

  debug('Polling for response...')
  const response = await waitForResponse(responsePath)
  debug(`Got response: ${JSON.stringify(response)}`)
  process.stdout.write(toCliResponse(response.decision, response.reason))
}

// Only run main() when executed as a script (not when required for testing)
if (require.main === module) {
  main()
}

// Export pure functions for testing
module.exports = { tokenizeCommand, matchesBashRule }
