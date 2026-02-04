#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const POLL_INTERVAL_MS = 100
const TIMEOUT_MS = 30000 // 30 seconds - deny if app doesn't respond
const HEARTBEAT_STALE_MS = 10000 // Consider app dead if heartbeat > 10s old

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
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'Skill',
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

  if (toolName && SAFE_TOOLS.has(toolName)) {
    debug(`Tool "${toolName}" is in safe list, auto-allowing`)
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
