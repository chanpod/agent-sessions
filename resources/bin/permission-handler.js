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
])

// Tools that must be denied so the host application can handle them.
// AskUserQuestion: The CLI auto-resolves this in -p mode without waiting for user input.
// We deny it so the host app can render the question UI, collect the user's answer,
// and deliver it as a follow-up --resume message.
const HOST_HANDLED_TOOLS = new Set([
  'AskUserQuestion',
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
 * Load the user's always-allow list from .claude/permission-allowlist.json.
 * The IPC dir is .claude/.permission-ipc, so the allowlist is one level up.
 */
function loadAllowlist(ipcDir) {
  const allowlistPath = path.join(path.dirname(ipcDir), ALLOWLIST_FILENAME)
  try {
    const data = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
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

  // Gate 2: Auto-allow safe tools that don't need permission prompts.
  let toolName = null
  try {
    const parsed = JSON.parse(input)
    toolName = parsed.tool_name
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
  if (toolName && allowlist.includes(toolName)) {
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

main()
