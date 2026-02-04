import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import {
  PERMISSION_SERVER_PORT,
  PERMISSION_REQUEST_TIMEOUT_MS,
  PERMISSION_HOOK_FILENAME,
} from '../constants.js'
import type {
  PermissionRequest,
  PermissionResponse,
  PendingPermission,
  PermissionRequestForUI,
} from '../types/permission-types.js'

export class PermissionServer {
  private server: http.Server | null = null
  private pending = new Map<string, PendingPermission>()
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[PermissionServer] Port ${PERMISSION_SERVER_PORT} in use`)
        } else {
          console.error('[PermissionServer] Server error:', err)
        }
        reject(err)
      })

      this.server.listen(PERMISSION_SERVER_PORT, '127.0.0.1', () => {
        console.log(`[PermissionServer] Listening on 127.0.0.1:${PERMISSION_SERVER_PORT}`)
        resolve()
      })
    })
  }

  stop(): void {
    // Deny all pending requests before shutting down
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeoutHandle)
      pending.resolveHttp({ decision: 'deny', reason: 'Server shutting down' })
      this.pending.delete(id)
    }

    this.server?.close()
    this.server = null
    console.log('[PermissionServer] Stopped')
  }

  resolvePermission(id: string, response: PermissionResponse): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false

    clearTimeout(pending.timeoutHandle)
    pending.resolveHttp(response)
    this.pending.delete(id)
    console.log(`[PermissionServer] Resolved ${id}: ${response.decision}`)
    return true
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST' || req.url !== '/permission-request') {
      res.writeHead(404)
      res.end()
      return
    }

    let body = ''
    req.on('data', (chunk: string) => { body += chunk })
    req.on('end', () => {
      let request: PermissionRequest
      try {
        request = JSON.parse(body)
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ decision: 'allow' }))
        return
      }

      const id = crypto.randomUUID()
      const now = Date.now()

      const timeoutHandle = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.get(id)!.resolveHttp({ decision: 'deny', reason: 'Timed out' })
          this.pending.delete(id)
          this.sendToRenderer('permission:expired', id)
        }
      }, PERMISSION_REQUEST_TIMEOUT_MS)

      const pending: PendingPermission = {
        id,
        request,
        receivedAt: now,
        resolveHttp: (response: PermissionResponse) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response))
        },
        timeoutHandle,
      }

      this.pending.set(id, pending)

      const uiRequest: PermissionRequestForUI = {
        id,
        sessionId: request.session_id,
        toolName: request.tool_name,
        toolInput: request.tool_input,
        receivedAt: now,
      }

      this.sendToRenderer('permission:request', uiRequest)
      console.log(`[PermissionServer] Queued ${id}: ${request.tool_name}`)
    })
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  // --- Static helpers for hook installation ---

  static getHookScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'bin', PERMISSION_HOOK_FILENAME)
    }
    return path.join(app.getAppPath(), 'resources', 'bin', PERMISSION_HOOK_FILENAME)
  }

  static isHookInstalled(projectPath: string): boolean {
    const settingsPath = path.join(projectPath, '.claude', 'settings.json')
    if (!fs.existsSync(settingsPath)) return false

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      const hooks = settings.hooks?.PreToolUse
      if (!Array.isArray(hooks)) return false
      return hooks.some((h: { type?: string; command?: string }) =>
        h.command?.includes(PERMISSION_HOOK_FILENAME)
      )
    } catch {
      return false
    }
  }

  static installHook(projectPath: string): { success: boolean; error?: string } {
    const hookScriptPath = PermissionServer.getHookScriptPath()
    if (!fs.existsSync(hookScriptPath)) {
      return { success: false, error: `Hook script not found: ${hookScriptPath}` }
    }

    const claudeDir = path.join(projectPath, '.claude')
    const settingsPath = path.join(claudeDir, 'settings.json')

    // Ensure .claude directory exists
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true })
    }

    // Read existing settings or start fresh
    let settings: Record<string, unknown> = {}
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      } catch {
        // Corrupted file - start fresh
      }
    }

    // Build hook entry
    const quotedPath = JSON.stringify(hookScriptPath)
    const hookEntry = {
      type: 'command',
      command: `node ${quotedPath}`,
    }

    // Merge into existing hooks without overwriting
    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {}
    }
    const hooks = settings.hooks as Record<string, unknown>

    if (!Array.isArray(hooks.PreToolUse)) {
      hooks.PreToolUse = []
    }

    // Check if already installed (idempotent)
    const existing = hooks.PreToolUse as Array<{ type?: string; command?: string }>
    if (existing.some(h => h.command?.includes(PERMISSION_HOOK_FILENAME))) {
      return { success: true }
    }

    existing.push(hookEntry)
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')

    console.log(`[PermissionServer] Hook installed at ${settingsPath}`)
    return { success: true }
  }
}
