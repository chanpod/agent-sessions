#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const POLL_INTERVAL_MS = 100
const TIMEOUT_MS = 300000 // 5 minutes

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
        resolve({ decision: 'allow' })
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

async function main() {
  debug(`Hook started. argv: ${JSON.stringify(process.argv)}`)

  const ipcDir = process.argv[2]
  if (!ipcDir) {
    debug('No IPC dir, returning allow')
    process.stdout.write(toCliResponse('allow'))
    return
  }

  debug(`IPC dir: ${ipcDir}`)
  const input = await readStdin()
  debug(`Stdin received (${input.length} bytes)`)

  const id = crypto.randomUUID()
  const requestPath = path.join(ipcDir, `${id}.request`)
  const responsePath = path.join(ipcDir, `${id}.response`)
  debug(`Request: ${requestPath}`)

  try {
    if (!fs.existsSync(ipcDir)) {
      fs.mkdirSync(ipcDir, { recursive: true })
    }
  } catch (err) {
    debug(`Failed to create IPC dir: ${err.message}`)
    process.stdout.write(toCliResponse('allow'))
    return
  }

  try {
    fs.writeFileSync(requestPath, input, 'utf8')
    debug('Request file written')
  } catch (err) {
    debug(`Failed to write request: ${err.message}`)
    process.stdout.write(toCliResponse('allow'))
    return
  }

  debug('Polling for response...')
  const response = await waitForResponse(responsePath)
  debug(`Got response: ${JSON.stringify(response)}`)
  process.stdout.write(toCliResponse(response.decision, response.reason))
}

main()
