/**
 * Event Logger - Writes detector events to per-session NDJSON log files.
 *
 * Each agent session gets its own log file, organized by project:
 *   {userData}/logs/events/{projectName}/{sessionTitle}.ndjson
 *
 * Session titles default to "Claude Agent" and are updated when the
 * auto-generated title arrives or the user renames the session.
 * The log file is renamed on disk to stay in sync.
 *
 * Events without a registered session go to a fallback file:
 *   {userData}/logs/events/_unassigned.ndjson
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { DetectedEvent } from '../output-monitors/output-detector'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB per session file

interface SessionLogEntry {
  stream: fs.WriteStream
  filePath: string
  currentSize: number
  projectName: string
  sessionTitle: string
}

/** terminalId → log entry */
const sessionLogs = new Map<string, SessionLogEntry>()

/** Fallback stream for events without a registered session */
let fallbackStream: fs.WriteStream | null = null
let fallbackPath = ''
let fallbackSize = 0

function getEventsDir(): string {
  return path.join(app.getPath('userData'), 'logs', 'events')
}

/**
 * Sanitize a string for use as a filename.
 * Replaces characters that are invalid on Windows/macOS/Linux.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // invalid chars
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .replace(/^\.+/, '_')                      // no leading dots
    .trim()
    .slice(0, 100)                             // reasonable length limit
    || '_unnamed'
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function buildLogPath(projectName: string, sessionTitle: string): string {
  const dir = path.join(getEventsDir(), sanitizeFilename(projectName))
  ensureDir(dir)
  return path.join(dir, `${sanitizeFilename(sessionTitle)}.ndjson`)
}

function openStreamAt(filePath: string): { stream: fs.WriteStream; size: number } {
  ensureDir(path.dirname(filePath))
  let size = 0
  try {
    const stat = fs.statSync(filePath)
    size = stat.size
  } catch { /* new file */ }

  const stream = fs.createWriteStream(filePath, { flags: 'a' })
  stream.on('error', (err) => {
    console.error('[EventLogger] Write error:', err.message)
  })
  return { stream, size }
}

function writeToStream(stream: fs.WriteStream, obj: unknown): number {
  let line: string
  try {
    line = JSON.stringify(obj) + '\n'
  } catch {
    return 0 // non-serializable, skip
  }
  stream.write(line)
  return Buffer.byteLength(line, 'utf8')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the event logger. Call once at app startup.
 */
export function initEventLogger(): void {
  ensureDir(getEventsDir())
  // Open the fallback stream for unassigned events
  fallbackPath = path.join(getEventsDir(), '_unassigned.ndjson')
  const { stream, size } = openStreamAt(fallbackPath)
  fallbackStream = stream
  fallbackSize = size
  writeToStream(fallbackStream, { _marker: 'app-start', timestamp: Date.now(), pid: process.pid })
}

/**
 * Register a terminal so its events get their own log file.
 * Call this when a new agent session is spawned.
 */
export function registerSessionLog(terminalId: string, projectName: string, sessionTitle: string): void {
  // Close existing stream if re-registering
  const existing = sessionLogs.get(terminalId)
  if (existing) {
    existing.stream.end()
  }

  const filePath = buildLogPath(projectName, sessionTitle)
  const { stream, size } = openStreamAt(filePath)

  sessionLogs.set(terminalId, {
    stream,
    filePath,
    currentSize: size,
    projectName,
    sessionTitle,
  })

  writeToStream(stream, { _marker: 'session-start', terminalId, projectName, sessionTitle, timestamp: Date.now() })
}

/**
 * Rename the log file for a session when its title changes.
 * The old file is renamed on disk and the stream reopened.
 */
export function renameSessionLog(terminalId: string, newTitle: string): void {
  const entry = sessionLogs.get(terminalId)
  if (!entry) return
  if (entry.sessionTitle === newTitle) return // no-op

  const oldPath = entry.filePath
  const newPath = buildLogPath(entry.projectName, newTitle)

  // If the new path is the same (e.g. sanitization produced the same name), just update title
  if (oldPath === newPath) {
    entry.sessionTitle = newTitle
    return
  }

  // Close current stream
  entry.stream.end()

  // Rename the file on disk (merge if target already exists by appending)
  try {
    if (fs.existsSync(oldPath)) {
      if (fs.existsSync(newPath)) {
        // Target exists — append old content to new, then delete old
        const oldContent = fs.readFileSync(oldPath)
        fs.appendFileSync(newPath, oldContent)
        fs.unlinkSync(oldPath)
      } else {
        fs.renameSync(oldPath, newPath)
      }
    }
  } catch (err) {
    console.error('[EventLogger] Failed to rename log file:', err)
    // Fall through — we'll open the new path regardless
  }

  // Reopen at the new path
  const { stream, size } = openStreamAt(newPath)
  entry.stream = stream
  entry.filePath = newPath
  entry.currentSize = size
  entry.sessionTitle = newTitle

  writeToStream(stream, { _marker: 'session-renamed', terminalId, newTitle, timestamp: Date.now() })
}

/**
 * Log a batch of detector events (called from PtyManager flush).
 */
export function logDetectorEvents(events: DetectedEvent[]): void {
  for (const event of events) {
    logDetectorEvent(event)
  }
}

/**
 * Log a single detector event, routed to the correct session file.
 */
export function logDetectorEvent(event: DetectedEvent): void {
  const entry = sessionLogs.get(event.terminalId)
  if (entry) {
    const bytes = writeToStream(entry.stream, event)
    entry.currentSize += bytes
    if (entry.currentSize >= MAX_FILE_SIZE) {
      rotateSessionLog(entry)
    }
  } else {
    // No session registered — write to fallback
    if (fallbackStream) {
      const bytes = writeToStream(fallbackStream, event)
      fallbackSize += bytes
      if (fallbackSize >= MAX_FILE_SIZE) {
        rotateFallback()
      }
    }
  }
}

/**
 * Get the log file path for a specific terminal session.
 * Returns fallback path if the terminal isn't registered.
 */
export function getSessionLogPath(terminalId?: string): string {
  if (terminalId) {
    const entry = sessionLogs.get(terminalId)
    if (entry) return entry.filePath
  }
  return fallbackPath || path.join(getEventsDir(), '_unassigned.ndjson')
}

/**
 * Get the events log directory (for "open folder" actions).
 */
export function getEventLogDir(): string {
  return getEventsDir()
}

/**
 * Legacy compatibility: get a single event log path.
 * Returns the events directory instead since logs are now per-session.
 */
export function getEventLogPath(): string {
  return getEventsDir()
}

/**
 * Unregister a terminal session's log (e.g., on session close).
 */
export function unregisterSessionLog(terminalId: string): void {
  const entry = sessionLogs.get(terminalId)
  if (entry) {
    entry.stream.end()
    sessionLogs.delete(terminalId)
  }
}

/**
 * Flush and close all log streams. Call on app shutdown.
 */
export function closeEventLogger(): void {
  for (const [, entry] of sessionLogs) {
    entry.stream.end()
  }
  sessionLogs.clear()
  if (fallbackStream) {
    fallbackStream.end()
    fallbackStream = null
  }
}

// ---------------------------------------------------------------------------
// Rotation helpers
// ---------------------------------------------------------------------------

function rotateSessionLog(entry: SessionLogEntry): void {
  entry.stream.end()
  const rotatedPath = `${entry.filePath}.1`
  try { fs.unlinkSync(rotatedPath) } catch { /* doesn't exist */ }
  try { fs.renameSync(entry.filePath, rotatedPath) } catch { /* ignore */ }

  const { stream, size } = openStreamAt(entry.filePath)
  entry.stream = stream
  entry.currentSize = size
}

function rotateFallback(): void {
  if (fallbackStream) {
    fallbackStream.end()
    fallbackStream = null
  }
  const rotatedPath = `${fallbackPath}.1`
  try { fs.unlinkSync(rotatedPath) } catch { /* doesn't exist */ }
  try { fs.renameSync(fallbackPath, rotatedPath) } catch { /* ignore */ }

  const { stream, size } = openStreamAt(fallbackPath)
  fallbackStream = stream
  fallbackSize = size
}
