import fs from 'fs'
import path from 'path'
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

/**
 * Tokenize a shell command string into an array of tokens.
 * Handles quoted strings (single/double) as single tokens.
 * Must stay in sync with the copy in permission-handler.cjs.
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
    if (!projectPath) {
      console.warn('[PermissionServer] watchProject called with empty path, skipping')
      return
    }
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

  resolvePermission(id: string, response: PermissionResponse, alwaysAllow?: boolean, bashRule?: string[]): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false

    const projectPath = path.dirname(path.dirname(pending.ipcDir))

    if (response.decision === 'allow') {
      if (bashRule && bashRule.length > 0) {
        // Granular bash rule — save the specific token pattern
        PermissionServer.addBashRule(projectPath, bashRule)
      } else if (alwaysAllow) {
        // Blanket tool allow (non-Bash tools)
        PermissionServer.addToAllowlist(projectPath, pending.request.tool_name)
      }
    }

    clearTimeout(pending.timeoutHandle)
    pending.resolveHttp(response)
    this.pending.delete(id)
    const suffix = bashRule ? ` (bash rule: ${bashRule.join(' ')})` : alwaysAllow ? ' (always)' : ''
    console.log(`[PermissionServer] Resolved ${id}: ${response.decision}${suffix}`)
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
    const config = PermissionServer.readAllowlistConfig(projectPath)

    // For Bash, check granular rules first
    if (request.tool_name === 'Bash' && request.tool_input?.command) {
      const command = String(request.tool_input.command)
      const tokens = tokenizeCommand(command.trim())
      const matched = config.bashRules.some((rule) => {
        if (!Array.isArray(rule) || rule.length === 0) return false
        const isWildcard = rule[rule.length - 1] === '*'
        if (isWildcard) {
          const prefixLen = rule.length - 1
          if (tokens.length < prefixLen) return false
          return rule.slice(0, prefixLen).every((t, i) => t === tokens[i])
        }
        return rule.length === tokens.length && rule.every((t, i) => t === tokens[i])
      })
      if (matched) {
        this.writeResponse(ipcDir, id, { decision: 'allow', reason: 'Bash rule matched' })
        console.log(`[PermissionServer] Auto-allowed ${id}: Bash [${command.slice(0, 80)}] (bash rule)`)
        return
      }
    }

    if (config.tools.includes(request.tool_name)) {
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
        fs.writeFileSync(heartbeatPath, String(Date.now()), 'utf8')
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
      const files = fs.readdirSync(ipcDir)
      if (files.length === 0) return
      for (const file of files) {
        try { fs.unlinkSync(path.join(ipcDir, file)) } catch {}
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
    if (!projectPath) return false
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

  /**
   * Check if a legacy (pre-.cjs) version of the hook is installed.
   * Used to trigger auto-migration from .js → .cjs.
   */
  static hasLegacyHook(projectPath: string): boolean {
    if (!projectPath) return false
    const localSettingsPath = path.join(projectPath, '.claude', 'settings.local.json')
    const repoSettingsPath = path.join(projectPath, '.claude', 'settings.json')

    for (const settingsPath of [localSettingsPath, repoSettingsPath]) {
      if (!fs.existsSync(settingsPath)) continue
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        const matcherGroups = settings.hooks?.PreToolUse
        if (!Array.isArray(matcherGroups)) continue
        if (matcherGroups.some((group: { hooks?: Array<{ command?: string }> }) =>
          group.hooks?.some(h => h.command?.includes('permission-handler.js'))
        )) {
          return true
        }
      } catch {
        continue
      }
    }
    return false
  }

  static readAllowlistConfig(projectPath: string): { tools: string[]; bashRules: string[][] } {
    const allowlistPath = path.join(projectPath, '.claude', PERMISSION_ALLOWLIST_FILENAME)
    try {
      const data = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
      // Legacy format: plain array of tool names
      if (Array.isArray(data)) {
        return { tools: data, bashRules: [] }
      }
      return {
        tools: Array.isArray(data.tools) ? data.tools : [],
        bashRules: Array.isArray(data.bashRules) ? data.bashRules : [],
      }
    } catch {
      return { tools: [], bashRules: [] }
    }
  }

  /** @deprecated Use readAllowlistConfig for the full config */
  static readAllowlist(projectPath: string): string[] {
    return PermissionServer.readAllowlistConfig(projectPath).tools
  }

  static isToolAllowed(projectPath: string, toolName: string): boolean {
    return PermissionServer.readAllowlistConfig(projectPath).tools.includes(toolName)
  }

  static addToAllowlist(projectPath: string, toolName: string): void {
    const config = PermissionServer.readAllowlistConfig(projectPath)
    if (config.tools.includes(toolName)) return
    config.tools.push(toolName)
    const allowlistPath = path.join(projectPath, '.claude', PERMISSION_ALLOWLIST_FILENAME)
    fs.writeFileSync(allowlistPath, JSON.stringify(config, null, 2), 'utf8')
    console.log(`[PermissionServer] Added "${toolName}" to allowlist for ${projectPath}`)
  }

  static removeFromAllowlist(projectPath: string, toolName: string): void {
    const config = PermissionServer.readAllowlistConfig(projectPath)
    const idx = config.tools.indexOf(toolName)
    if (idx === -1) return
    config.tools.splice(idx, 1)
    const allowlistPath = path.join(projectPath, '.claude', PERMISSION_ALLOWLIST_FILENAME)
    fs.writeFileSync(allowlistPath, JSON.stringify(config, null, 2), 'utf8')
    console.log(`[PermissionServer] Removed "${toolName}" from allowlist for ${projectPath}`)
  }

  static addBashRule(projectPath: string, rule: string[]): void {
    const config = PermissionServer.readAllowlistConfig(projectPath)
    // Check for duplicate rule
    const isDuplicate = config.bashRules.some(
      (existing) => existing.length === rule.length && existing.every((t, i) => t === rule[i])
    )
    if (isDuplicate) return
    config.bashRules.push(rule)
    // When adding the first bash rule, remove blanket "Bash" from tools[]
    // so the granular rules actually take effect (Gate 3a before 3b)
    const bashIdx = config.tools.indexOf('Bash')
    if (bashIdx !== -1) {
      config.tools.splice(bashIdx, 1)
      console.log(`[PermissionServer] Removed blanket "Bash" from tools[] (now using granular rules)`)
    }
    const allowlistPath = path.join(projectPath, '.claude', PERMISSION_ALLOWLIST_FILENAME)
    fs.writeFileSync(allowlistPath, JSON.stringify(config, null, 2), 'utf8')
    console.log(`[PermissionServer] Added bash rule [${rule.join(' ')}] for ${projectPath}`)
  }

  static removeBashRule(projectPath: string, rule: string[]): void {
    const config = PermissionServer.readAllowlistConfig(projectPath)
    const idx = config.bashRules.findIndex(
      (existing) => existing.length === rule.length && existing.every((t, i) => t === rule[i])
    )
    if (idx === -1) return
    config.bashRules.splice(idx, 1)
    const allowlistPath = path.join(projectPath, '.claude', PERMISSION_ALLOWLIST_FILENAME)
    fs.writeFileSync(allowlistPath, JSON.stringify(config, null, 2), 'utf8')
    console.log(`[PermissionServer] Removed bash rule [${rule.join(' ')}] for ${projectPath}`)
  }

  static installHook(projectPath: string): { success: boolean; error?: string } {
    if (!projectPath) {
      return { success: false, error: 'No project path provided' }
    }
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
    fs.writeFileSync(installedScriptPath, scriptContent, 'utf8')

    // Clean up old .js version if we've migrated to .cjs
    const oldJsPath = path.join(hooksDir, 'permission-handler.js')
    if (PERMISSION_HOOK_FILENAME !== 'permission-handler.js' && fs.existsSync(oldJsPath)) {
      try { fs.unlinkSync(oldJsPath) } catch {}
      console.log(`[PermissionServer] Removed old hook script: ${oldJsPath}`)
    }

    // Use relative paths so the command works across environments
    const relativeScript = `.claude/hooks/${PERMISSION_HOOK_FILENAME}`
    const relativeIpcDir = `.claude/${IPC_DIR_NAME}`
    const expectedCommand = `node "${relativeScript}" "${relativeIpcDir}"`

    // Helper: check if a command string references any version of the permission hook
    const isPermissionHookCommand = (cmd?: string) =>
      cmd?.includes('permission-handler.js') || cmd?.includes('permission-handler.cjs')

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
      for (const group of existingGroups as Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>) {
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

    // Remove any existing permission hook entries (old .js format, absolute paths, or stale)
    const filtered = (hooks.PreToolUse as Array<{ hooks?: Array<{ command?: string }>; command?: string }>)
      .filter(group => {
        if (isPermissionHookCommand(group.command)) return false
        if (group.hooks?.some(h => isPermissionHookCommand(h.command))) return false
        return true
      })
    filtered.push(matcherGroup)
    hooks.PreToolUse = filtered

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')

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

      const isPermissionHook = (cmd?: string) =>
        cmd?.includes('permission-handler.js') || cmd?.includes('permission-handler.cjs')
      const filtered = matcherGroups.filter((group: { hooks?: Array<{ command?: string }>; command?: string }) => {
        if (isPermissionHook(group.command)) return false
        if (group.hooks?.some(h => isPermissionHook(h.command))) return false
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

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
      console.log(`[PermissionServer] Removed hook from ${settingsPath} (migrated to local)`)
    } catch {
      // Best-effort cleanup
    }
  }
}
