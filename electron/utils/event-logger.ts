/**
 * Event Logger - Writes full detector events to a rotating log file.
 *
 * Each line is NDJSON with the complete event payload (type, terminalId,
 * timestamp, data) so it can be replayed or grep'd for debugging.
 *
 * Log location: {userData}/logs/agent-events.log
 * Rotation:     Rolls at 20 MB, keeps 2 old files.
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { DetectedEvent } from '../output-monitors/output-detector'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
const MAX_ROTATED_FILES = 2

let logStream: fs.WriteStream | null = null
let currentSize = 0
let logFilePath = ''

function getLogDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function getLogFile(): string {
  return path.join(getLogDir(), 'agent-events.log')
}

function ensureLogDir(): void {
  const dir = getLogDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function rotate(): void {
  if (logStream) {
    logStream.end()
    logStream = null
  }

  // Shift existing rotated files (agent-events.2.log -> deleted, .1 -> .2, current -> .1)
  for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
    const older = `${logFilePath}.${i}`
    if (i === MAX_ROTATED_FILES) {
      try { fs.unlinkSync(older) } catch { /* doesn't exist */ }
    } else {
      const newer = `${logFilePath}.${i + 1}`
      try { fs.renameSync(older, newer) } catch { /* doesn't exist */ }
    }
  }

  try { fs.renameSync(logFilePath, `${logFilePath}.1`) } catch { /* doesn't exist */ }

  openStream()
}

function openStream(): void {
  ensureLogDir()
  logFilePath = getLogFile()

  try {
    const stat = fs.statSync(logFilePath)
    currentSize = stat.size
  } catch {
    currentSize = 0
  }

  logStream = fs.createWriteStream(logFilePath, { flags: 'a' })
  logStream.on('error', (err) => {
    console.error('[EventLogger] Write error:', err.message)
    logStream = null
  })
}

/**
 * Initialize the event logger. Call once at app startup.
 */
export function initEventLogger(): void {
  openStream()
  // Write a startup marker
  writeRaw({ _marker: 'session-start', timestamp: Date.now(), pid: process.pid })
}

/**
 * Log a batch of detector events (called from PtyManager flush).
 */
export function logDetectorEvents(events: DetectedEvent[]): void {
  for (const event of events) {
    writeRaw(event)
  }
}

/**
 * Log a single detector event.
 */
export function logDetectorEvent(event: DetectedEvent): void {
  writeRaw(event)
}

function writeRaw(obj: unknown): void {
  if (!logStream) return

  let line: string
  try {
    line = JSON.stringify(obj) + '\n'
  } catch {
    return // non-serializable, skip
  }

  logStream.write(line)
  currentSize += Buffer.byteLength(line, 'utf8')

  if (currentSize >= MAX_FILE_SIZE) {
    rotate()
  }
}

/**
 * Get the path to the current event log file (for UI "open in editor" actions).
 */
export function getEventLogPath(): string {
  if (!logFilePath) {
    ensureLogDir()
    logFilePath = getLogFile()
  }
  return logFilePath
}

/**
 * Flush and close the event logger. Call on app shutdown.
 */
export function closeEventLogger(): void {
  if (logStream) {
    logStream.end()
    logStream = null
  }
}
