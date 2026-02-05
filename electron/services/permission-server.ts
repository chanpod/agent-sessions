import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { app, BrowserWindow } from 'electron'
import {
  PERMISSION_REQUEST_TIMEOUT_MS,
  PERMISSION_HOOK_FILENAME,
  PERMISSION_ALLOWLIST_FILENAME,
} from '../constants.js'
import type {
  PermissionRequest,
  PermissionResponse,
  PendingPermission,
  PermissionRequestForUI,
} from '../types/permission-types.js'

const IPC_DIR_NAME = '.permission-ipc'
const HEARTBEAT_FILENAME = '.active'
const HEARTBEAT_INTERVAL_MS = 3000

export class PermissionServer {
  private pending = new Map<string, PendingPermission>()
  private window: BrowserWindow
  private watchedDirs = new Set<string>()
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null

  constructor(window: BrowserWindow) {
    this.window = window
  }

  start(): void {
    this.pollInterval = setInterval(() => this.scanForRequests(), 200)
    this.heartbeatInterval = setInterval(() => this.writeHeartbeats(), HEARTBEAT_INTERVAL_MS)
    this.writeHeartbeats() // Write immediately on start
    console.log('[PermissionServer] Started polling')
  }

  watchProject(projectPath: string): void {
    const ipcDir = path.join(projectPath, '.claude', IPC_DIR_NAME)

    if (this.watchedDirs.has(ipcDir)) return

    if (!fs.existsSync(ipcDir)) {
      fs.mkdirSync(ipcDir, { recursive: true })
    }

    this.cleanIpcDir(ipcDir)
    this.watchedDirs.add(ipcDir)

    console.log(`[PermissionServer] Watching ${ipcDir}`)
  }

  stop(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeoutHandle)
      pending.resolveHttp({ decision: 'deny', reason: 'Server shutting down' })
      this.pending.delete(id)
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    for (const ipcDir of this.watchedDirs) {
      this.removeHeartbeat(ipcDir)
      this.cleanIpcDir(ipcDir)
    }
    this.watchedDirs.clear()

    console.log('[PermissionServer] Stopped')
  }

  resolvePermission(id: string, response: PermissionResponse, alwaysAllow?: boolean): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false

    if (alwaysAllow && response.decision === 'allow') {
      const projectPath = path.dirname(path.dirname(pending.ipcDir))
      PermissionServer.addToAllowlist(projectPath, pending.request.tool_name)
    }

    clearTimeout(pending.timeoutHandle)
    pending.resolveHttp(response)
    this.pending.delete(id)
    console.log(`[PermissionServer] Resolved ${id}: ${response.decision}${alwaysAllow ? ' (always)' : ''}`)
    return true
  }

  private scanForRequests(): void {
    for (const ipcDir of this.watchedDirs) {
      this.scanDirectory(ipcDir)
    }
  }

  private scanDirectory(ipcDir: string): void {
    let files: string[]
    try {
      files = fs.readdirSync(ipcDir)
    } catch {
      return
    }

    for (const file of files) {
      if (!file.endsWith('.request')) continue

      const id = file.replace('.request', '')
      if (this.pending.has(id)) continue

      const requestPath = path.join(ipcDir, file)
      try {
        // Skip and clean up stale request files that outlived the timeout.
        // These are orphans from crashed hooks or failed cleanup that would
        // otherwise be re-queued every 200ms, causing an infinite permission loop.
        const stat = fs.statSync(requestPath)
        const ageMs = Date.now() - stat.mtimeMs
        if (ageMs > PERMISSION_REQUEST_TIMEOUT_MS + 5000) {
          try { fs.unlinkSync(requestPath) } catch {}
          try { fs.unlinkSync(path.join(ipcDir, `${id}.response`)) } catch {}
          console.log(`[PermissionServer] Cleaned up stale request ${id} (age: ${Math.round(ageMs / 1000)}s)`)
          continue
        }

        const raw = fs.readFileSync(requestPath, 'utf8')
        const request: PermissionRequest = JSON.parse(raw)
        this.handleRequest(id, request, ipcDir)
      } catch (err) {
        console.error(`[PermissionServer] Failed to read request ${file}:`, err)
      }
    }
  }

  private handleRequest(id: string, request: PermissionRequest, ipcDir: string): void {
    // Check allowlist — auto-resolve without showing UI
    const projectPath = path.dirname(path.dirname(ipcDir))
    if (PermissionServer.isToolAllowed(projectPath, request.tool_name)) {
      this.writeResponse(ipcDir, id, { decision: 'allow', reason: 'Always allowed' })
      console.log(`[PermissionServer] Auto-allowed ${id}: ${request.tool_name} (allowlisted)`)
      return
    }

    const now = Date.now()

    const timeoutHandle = setTimeout(() => {
      if (this.pending.has(id)) {
        this.writeResponse(ipcDir, id, { decision: 'deny', reason: 'Timed out' })
        this.pending.delete(id)
        this.sendToRenderer('permission:expired', id)
      }
    }, PERMISSION_REQUEST_TIMEOUT_MS)

    const pending: PendingPermission = {
      id,
      request,
      ipcDir,
      receivedAt: now,
      resolveHttp: (response: PermissionResponse) => {
        this.writeResponse(ipcDir, id, response)
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
  }

  private writeResponse(ipcDir: string, id: string, response: PermissionResponse): void {
    const responsePath = path.join(ipcDir, `${id}.response`)
    const requestPath = path.join(ipcDir, `${id}.request`)
    try {
      fs.writeFileSync(responsePath, JSON.stringify(response), 'utf8')
    } catch (err) {
      console.error(`[PermissionServer] Failed to write response ${id}:`, err)
    }
    // Delete request file so the scanner never re-queues it.
    // The hook also tries to delete both files, but if it crashes or
    // fails to clean up, this prevents an infinite permission loop.
    try {
      if (fs.existsSync(requestPath)) {
        fs.unlinkSync(requestPath)
      }
    } catch {
      // Best-effort; hook cleanup is the secondary safeguard
    }
  }

  private writeHeartbeats(): void {
    for (const ipcDir of this.watchedDirs) {
      const heartbeatPath = path.join(ipcDir, HEARTBEAT_FILENAME)
      try {
        writeFileForWsl(heartbeatPath, String(Date.now()))
      } catch (err) {
        console.error(`[PermissionServer] Failed to write heartbeat to ${ipcDir}:`, err)
      }
    }
  }

  private removeHeartbeat(ipcDir: string): void {
    const heartbeatPath = path.join(ipcDir, HEARTBEAT_FILENAME)
    try {
      if (fs.existsSync(heartbeatPath)) {
        fs.unlinkSync(heartbeatPath)
      }
    } catch {}
  }

  private cleanIpcDir(ipcDir: string): void {
    if (!fs.existsSync(ipcDir)) return
    try {
      for (const file of fs.readdirSync(ipcDir)) {
        fs.unlinkSync(path.join(ipcDir, file))
      }
    } catch {}
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

  static getIpcDirPath(projectPath: string): string {
    return path.join(projectPath, '.claude', IPC_DIR_NAME)
  }

  static isHookInstalled(projectPath: string): boolean {
    // Check both local (preferred) and repo-level settings
    const localSettingsPath = path.join(projectPath, '.claude', 'settings.local.json')
    const repoSettingsPath = path.join(projectPath, '.claude', 'settings.json')

    for (const settingsPath of [localSettingsPath, repoSettingsPath]) {
      if (!fs.existsSync(settingsPath)) continue
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        const matcherGroups = settings.hooks?.PreToolUse
        if (!Array.isArray(matcherGroups)) continue
        if (matcherGroups.some((group: { hooks?: Array<{ command?: string }> }) =>
          group.hooks?.some(h => h.command?.includes(PERMISSION_HOOK_FILENAME))
        )) {
          return true
        }
      } catch {
        continue
      }
    }
    return false
  }

  static readAllowlist(projectPath: string): string[] {
    const allowlistPath = path.join(projectPath, '.claude', PERMISSION_ALLOWLIST_FILENAME)
    try {
      const data = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  static isToolAllowed(projectPath: string, toolName: string): boolean {
    return PermissionServer.readAllowlist(projectPath).includes(toolName)
  }

  static addToAllowlist(projectPath: string, toolName: string): void {
    const allowlist = PermissionServer.readAllowlist(projectPath)
    if (allowlist.includes(toolName)) return
    allowlist.push(toolName)
    const allowlistPath = path.join(projectPath, '.claude', PERMISSION_ALLOWLIST_FILENAME)
    writeFileForWsl(allowlistPath, JSON.stringify(allowlist, null, 2))
    console.log(`[PermissionServer] Added "${toolName}" to allowlist for ${projectPath}`)
  }

  static installHook(projectPath: string): { success: boolean; error?: string } {
    const bundledScriptPath = PermissionServer.getHookScriptPath()
    if (!fs.existsSync(bundledScriptPath)) {
      return { success: false, error: `Hook script not found: ${bundledScriptPath}` }
    }

    const claudeDir = path.join(projectPath, '.claude')
    const hooksDir = path.join(claudeDir, 'hooks')
    const settingsPath = path.join(claudeDir, 'settings.local.json')
    const repoSettingsPath = path.join(claudeDir, 'settings.json')
    const ipcDir = path.join(claudeDir, IPC_DIR_NAME)
    const installedScriptPath = path.join(hooksDir, PERMISSION_HOOK_FILENAME)

    // Ensure directories exist
    for (const dir of [claudeDir, hooksDir, ipcDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    // Copy hook script into the project's .claude/hooks/ directory
    const scriptContent = fs.readFileSync(bundledScriptPath, 'utf8')
    writeFileForWsl(installedScriptPath, scriptContent)

    // Use relative paths so the command works in both Git Bash and WSL
    const relativeScript = `.claude/hooks/${PERMISSION_HOOK_FILENAME}`
    const relativeIpcDir = `.claude/${IPC_DIR_NAME}`
    const expectedCommand = `node "${relativeScript}" "${relativeIpcDir}"`

    // Read existing local settings or start fresh
    let settings: Record<string, unknown> = {}
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      } catch {
        // Corrupted file - start fresh
      }
    }

    // Check if the hook is already up-to-date (avoid unnecessary writes that trigger file watchers)
    const existingGroups = (settings.hooks as Record<string, unknown>)?.PreToolUse
    if (Array.isArray(existingGroups)) {
      for (const group of existingGroups as Array<{ hooks?: Array<{ command?: string }> }>) {
        const match = group.hooks?.find(h => h.command?.includes(PERMISSION_HOOK_FILENAME))
        if (match?.command === expectedCommand) {
          // Still migrate old repo settings even if local is up-to-date
          PermissionServer.removeHookFromSettings(repoSettingsPath)
          return { success: true }
        }
      }
    }

    // Build the correctly nested structure: PreToolUse -> [matcher group] -> hooks -> [handler]
    const matcherGroup = {
      hooks: [{ type: 'command' as const, command: expectedCommand }],
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {}
    }
    const hooks = settings.hooks as Record<string, unknown>

    if (!Array.isArray(hooks.PreToolUse)) {
      hooks.PreToolUse = []
    }

    // Remove any existing entries (old absolute-path format or stale)
    const filtered = (hooks.PreToolUse as Array<{ hooks?: Array<{ command?: string }>; command?: string }>)
      .filter(group => {
        if (group.command?.includes(PERMISSION_HOOK_FILENAME)) return false
        if (group.hooks?.some(h => h.command?.includes(PERMISSION_HOOK_FILENAME))) return false
        return true
      })
    filtered.push(matcherGroup)
    hooks.PreToolUse = filtered

    writeFileForWsl(settingsPath, JSON.stringify(settings, null, 2))

    // Migrate: remove hook from repo-level settings.json if present
    PermissionServer.removeHookFromSettings(repoSettingsPath)

    console.log(`[PermissionServer] Hook installed at ${settingsPath}`)
    return { success: true }
  }

  /**
   * Remove permission hook entries from a settings file.
   * Used to migrate hooks from repo-level settings.json to local settings.
   */
  private static removeHookFromSettings(settingsPath: string): void {
    if (!fs.existsSync(settingsPath)) return

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      const matcherGroups = settings.hooks?.PreToolUse
      if (!Array.isArray(matcherGroups)) return

      const filtered = matcherGroups.filter((group: { hooks?: Array<{ command?: string }>; command?: string }) => {
        if (group.command?.includes(PERMISSION_HOOK_FILENAME)) return false
        if (group.hooks?.some(h => h.command?.includes(PERMISSION_HOOK_FILENAME))) return false
        return true
      })

      if (filtered.length === matcherGroups.length) return // Nothing to remove

      settings.hooks.PreToolUse = filtered

      // Clean up empty structures
      if (filtered.length === 0) {
        delete settings.hooks.PreToolUse
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks
      }

      writeFileForWsl(settingsPath, JSON.stringify(settings, null, 2))
      console.log(`[PermissionServer] Removed hook from ${settingsPath} (migrated to local)`)
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * On Windows, files written by Electron's fs.writeFileSync get NTFS metadata
 * that WSL2 cannot read (shows as ??????? permissions). Since the Claude CLI
 * runs inside WSL, it must be able to read settings.json.
 * Write via bash.exe so the file is created from the WSL context with proper permissions.
 */
function writeFileForWsl(windowsPath: string, content: string): void {
  if (process.platform === 'win32') {
    const wslPath = winToWsl(windowsPath)
    try {
      execSync(`bash.exe -c 'cat > "${wslPath}"'`, {
        input: content,
        timeout: 10000,
      })
      return
    } catch (err) {
      console.warn('[PermissionServer] WSL write failed, falling back to fs:', err)
    }
  }
  fs.writeFileSync(windowsPath, content, 'utf8')
}

function winToWsl(winPath: string): string {
  const drive = winPath[0].toLowerCase()
  return `/mnt/${drive}/${winPath.slice(3).replace(/\\/g, '/')}`
}
