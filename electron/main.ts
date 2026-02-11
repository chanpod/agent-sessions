import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { autoUpdater } from 'electron-updater'
import { exec, execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PtyManager } from './pty-manager.js'
import { AgentProcessManager } from './agent-process-manager.js'
import { SSHManager, type SSHConnectionConfig } from './ssh-manager.js'
import { ToolChainDB } from './database.js'
import { BackgroundClaudeManager } from './background-claude-manager.js'
import { registerGitHandlers, cleanupGitWatchers } from './services/git-service.js'
import { registerFsHandlers } from './services/fs-service.js'
import {
  getPackageScriptsLocal,
  getPackageScriptsRemote,
  type PackageScripts,
  type ScriptInfo,
} from './services/package-scripts.js'
import { CONSTANTS } from './constants.js'
import {
  type ExecError,
  getErrorMessage,
  isExecError
} from './types/index.js'

import { PathService, getPlatformForInstall, getGitBashPath, type ExecutionContext } from './utils/path-service.js'
import {
  detectCliTool,
  detectAllCliTools,
  checkAgentUpdate,
  checkAgentUpdates,
  setCliDetectorDatabase,
  type CliToolDetectionResult,
  type AllCliToolsResult,
  type UpdateCheckResult
} from './services/cli-detector.js'
import { BUILTIN_CLI_TOOLS, getAgentModels, type AgentModelOption } from './services/cli-config.js'
import { installCliTool } from './services/cli-installer.js'
import { PermissionServer } from './services/permission-server.js'
import { serviceManager } from './services/service-manager.js'
import { dockerComposeHandler } from './services/docker/docker-compose-handler.js'
import { dockerCli } from './services/docker/docker-cli.js'
import { ptyServiceHandler, setPtyManager } from './services/pty/pty-service-handler.js'
import { logger, getLogPath } from './utils/logger.js'
import { initEventLogger, getEventLogPath, closeEventLogger } from './utils/event-logger.js'

// Global crash handlers - must be set up early
process.on('uncaughtException', (error) => {
  logger.error('Main', 'Uncaught exception:', error)
  // Don't exit on render process errors forwarded to main
})

process.on('unhandledRejection', (reason) => {
  logger.error('Main', 'Unhandled rejection:', reason as any)
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface ShellInfo {
  name: string
  path: string
}

// ScriptInfo and PackageScripts interfaces moved to services/package-scripts.ts

// Execute a command in the appropriate context (local or SSH)
// This is the main abstraction that routes commands correctly
function execInContext(command: string, projectPath: string, options: { encoding: 'utf-8' } = { encoding: 'utf-8' }): string {
  return execSync(command, {
    cwd: projectPath,
    ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

// Execute a command asynchronously in the appropriate context (local or SSH)
// This automatically detects and routes to the correct execution method using PathService
export async function execInContextAsync(command: string, projectPath: string, projectId?: string): Promise<string> {
  // Determine execution context using PathService
  const context = await PathService.getExecutionContext(projectPath, projectId, sshManager || undefined)

  switch (context) {
    case 'ssh-remote': {
      // Must use SSH, throw if not connected
      if (!projectId || !sshManager) {
        throw new Error(`SSH connection required but not configured for path: ${projectPath}`)
      }

      const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
      if (!projectMasterStatus.connected) {
        throw new Error(`SSH connection not available for project. Please reconnect to the SSH host.`)
      }

      try {
        const escapedPath = PathService.escapeForSSHRemote(projectPath)
        return await sshManager.execViaProjectMaster(projectId, `cd ${escapedPath} && ${command}`)
      } catch (error: unknown) {
        console.error(`[execInContextAsync] SSH command failed:`, error)
        throw new Error(`SSH command failed: ${getErrorMessage(error)}`)
      }
    }

    case 'wsl': {
      // WSL project — run command inside WSL via execFile (bypasses cmd.exe quoting issues)
      const parsed = PathService.parseWslPath(projectPath)
      const distro = parsed?.distro || PathService.getEnvironment().defaultWslDistro
      const linuxPath = parsed?.linuxPath || projectPath
      if (!distro) {
        throw new Error('No WSL distribution found for path: ' + projectPath)
      }
      return new Promise((resolve, reject) => {
        execFile(
          'wsl',
          ['-d', distro, '--cd', linuxPath, '--', 'bash', '-lc', command],
          { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
          (error, stdout) => {
            if (error) {
              console.error(`[execInContextAsync] WSL command failed: ${command.substring(0, 50)}...`, error.message)
              reject(error)
            } else {
              resolve(stdout)
            }
          }
        )
      })
    }

    case 'local-windows':
    case 'local-unix': {
      // Execute directly on local system
      return new Promise((resolve, reject) => {
        exec(command, { cwd: projectPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            const execError = error as ExecError
            console.error(`[execInContextAsync] Local command failed: ${command.substring(0, 50)}...`, execError.message)
            reject(error)
          } else {
            resolve(stdout)
          }
        })
      })
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = context
      throw new Error(`Unknown execution context: ${context}`)
    }
  }
}

// Initialize SQLite database for persistent storage
const db = new ToolChainDB()
let dbReady = false

// Initialize database asynchronously
;(async () => {
  try {
    await db.initialize()
    dbReady = true
    // Set database instance on CLI detector for persistent caching
    setCliDetectorDatabase(db)
    console.log('[Database] Ready')
  } catch (err) {
    console.error('[Database] Initialization failed:', err)
  }
})()

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Configure auto-updater
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

// Helper to check if an update was recently dismissed
async function isUpdateDismissed(version: string): Promise<boolean> {
  await waitForDb()
  if (!dbReady) return false

  const dismissalKey = `update-dismissed-${version}`
  const dismissalData = db.get(dismissalKey) as { dismissedAt: number } | undefined

  if (!dismissalData) return false

  const dismissedAt = dismissalData.dismissedAt
  const now = Date.now()

  // If dismissed within the last 24 hours, don't show it
  const isDismissed = now - dismissedAt < CONSTANTS.UPDATE_DISMISS_TIMEOUT_MS

  if (isDismissed) {
    console.log(`[Update] Version ${version} was dismissed ${Math.floor((now - dismissedAt) / (60 * 60 * 1000))} hours ago, skipping notification`)
  }

  return isDismissed
}

function setupAutoUpdater() {
  if (isDev) {
    // Skip auto-updates in development
    return
  }

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info)
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', progress)
  })

  autoUpdater.on('update-downloaded', async (info) => {

    // Check if user has dismissed this version recently
    const isDismissed = await isUpdateDismissed(info.version)
    if (isDismissed) {
      console.log(`[Update] Not showing notification for ${info.version} - recently dismissed`)
      return
    }

    // Send to renderer to show non-invasive notification
    mainWindow?.webContents.send('update:downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  // Check for updates immediately
  autoUpdater.checkForUpdatesAndNotify()

  // Poll for updates every 5 minutes for active development
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, CONSTANTS.UPDATE_CHECK_INTERVAL_MS)
}

// IPC handler to install update when user clicks "Update Now"
ipcMain.handle('update:install', async () => {
  autoUpdater.quitAndInstall()
})

// IPC handler to dismiss an update (user clicked "Later")
ipcMain.handle('update:dismiss', async (_event, version: string) => {
  await waitForDb()
  if (!dbReady) {
    console.error('[Update] Cannot dismiss update - database not ready')
    return
  }

  const dismissalKey = `update-dismissed-${version}`
  const dismissalData = {
    dismissedAt: Date.now(),
    version,
  }

  db.set(dismissalKey, dismissalData)
  console.log(`[Update] Dismissed version ${version} for 24 hours`)
})

function createMenu() {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'

  // Windows gets the same native menu as other platforms
  // (custom TitleBar is no longer used)

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const }
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const }
        ])
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Log File',
          click: async () => {
            const logPath = getLogPath()
            shell.showItemInFolder(logPath)
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: async () => {
            if (isDev) {
              dialog.showMessageBox(mainWindow!, {
                type: 'info',
                title: 'Updates Disabled',
                message: 'Auto-updates are disabled in development mode.',
              })
              return
            }

            try {
              const result = await autoUpdater.checkForUpdates()
              if (result) {
                dialog.showMessageBox(mainWindow!, {
                  type: 'info',
                  title: 'Checking for Updates',
                  message: 'Checking for updates...',
                })
              }
            } catch (err) {
              dialog.showMessageBox(mainWindow!, {
                type: 'error',
                title: 'Update Check Failed',
                message: 'Failed to check for updates.',
                detail: String(err),
              })
            }
          }
        },
        { type: 'separator' as const },
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/chanpod/agent-sessions')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null
let sshManager: SSHManager | null = null
let backgroundClaude: BackgroundClaudeManager | null = null
let agentProcessManager: AgentProcessManager | null = null
let permissionServer: PermissionServer | null = null

// Track PTY-based agent terminals (for streaming support)
interface AgentTerminalInfo {
  id: string
  agentType: 'claude' | 'codex' | 'gemini'
  cwd: string
  sessionId?: string
  createdAt: number
}
const agentTerminals: Map<string, AgentTerminalInfo> = new Map()


// Git watching for detecting branch and file changes

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')

  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: CONSTANTS.WINDOW_DEFAULT_WIDTH,
    height: CONSTANTS.WINDOW_DEFAULT_HEIGHT,
    minWidth: CONSTANTS.WINDOW_MIN_WIDTH,
    minHeight: CONSTANTS.WINDOW_MIN_HEIGHT,
    backgroundColor: '#09090b',
    frame: !isWindows,  // Frameless on Windows only
    ...(isMac && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 15 },
    }),
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for node-pty
    },
  })

  // Windows-specific keyboard shortcut handler
  // On Windows, we use a frameless window (frame: false) and Menu.setApplicationMenu(null)
  // which disables all built-in Electron keyboard shortcuts. We need to manually handle them.
  if (process.platform === 'win32') {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown') {
        // Ctrl+Shift+I or F12 - Toggle DevTools
        if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
          mainWindow.webContents.toggleDevTools()
          event.preventDefault()
          return
        }

        // Ctrl+R - Reload
        if (input.control && !input.shift && input.key.toLowerCase() === 'r') {
          mainWindow.webContents.reload()
          event.preventDefault()
          return
        }

        // Ctrl+Shift+R - Hard Reload (force reload, clear cache)
        if (input.control && input.shift && input.key.toLowerCase() === 'r') {
          mainWindow.webContents.reloadIgnoringCache()
          event.preventDefault()
          return
        }

        // F11 - Toggle Fullscreen
        if (input.key === 'F11') {
          mainWindow.setFullScreen(!mainWindow.isFullScreen())
          event.preventDefault()
          return
        }

        // Ctrl+W - Close window
        if (input.control && !input.shift && input.key.toLowerCase() === 'w') {
          mainWindow.close()
          event.preventDefault()
          return
        }

        // Alt+F4 - Close app (handled natively on Windows, but ensure it works)
        if (input.alt && input.key === 'F4') {
          app.quit()
          event.preventDefault()
          return
        }
      }
    })
  }

  ptyManager = new PtyManager(mainWindow)
  sshManager = new SSHManager()

  // Set PTY manager reference in SSH manager (needed for creating tunnel terminals)
  sshManager.setPtyManager(ptyManager)

  // Register service handlers for unified service management
  setPtyManager(ptyManager)
  serviceManager.registerHandler(ptyServiceHandler)
  serviceManager.registerHandler(dockerComposeHandler)

  // Wire up context-aware command execution for Docker CLI
  // This routes docker commands through Git Bash (Windows) or WSL bash as appropriate
  dockerCli.setExecInContext((cmd, projectPath) => execInContextAsync(cmd, projectPath))

  // Initialize BackgroundClaudeManager
  backgroundClaude = new BackgroundClaudeManager(ptyManager)
  await backgroundClaude.initialize()
  console.log('[Main] BackgroundClaudeManager initialized')

  // Initialize AgentProcessManager
  agentProcessManager = new AgentProcessManager(mainWindow)
  console.log('[Main] AgentProcessManager initialized')

  // Initialize Permission Server (starts polling; projects are watched on demand)
  permissionServer = new PermissionServer(mainWindow)
  permissionServer.start()
  console.log('[Main] PermissionServer initialized')


  // Forward SSH status changes to renderer
  sshManager.on('status-change', (connectionId: string, connected: boolean, error?: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ssh:status-change', connectionId, connected, error)
    }
  })

  // Forward SSH project master status changes to renderer
  sshManager.on('project-status-change', (projectId: string, connected: boolean, error?: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ssh:project-status-change', projectId, connected, error)
    }
  })

  // Register all git-related IPC handlers
  registerGitHandlers(mainWindow, sshManager, execInContextAsync)

  // Register all file system related IPC handlers
  registerFsHandlers(sshManager)

  // Open all external links in the user's default browser instead of navigating
  // the Electron window away from the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server reloads and initial load
    if (isDev && url.startsWith('http://localhost:')) return
    // Block all other navigation — open externally instead
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // Dev tools can be opened manually with F12 or Ctrl+Shift+I
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    ptyManager?.dispose()
    ptyManager = null
    sshManager?.disposeAll()
    sshManager = null
    agentProcessManager?.dispose()
    agentProcessManager = null
    permissionServer?.stop()
    permissionServer = null
    // Clean up all git watchers
    cleanupGitWatchers()
  })
}


// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('pty:create', async (_event, options: { cwd?: string; shell?: string; sshConnectionId?: string; remoteCwd?: string; id?: string; projectId?: string; initialCommand?: string; title?: string }) => {
  if (!ptyManager) return null

  try {
    // If this is an SSH connection, build the SSH command using SSH manager
    if (options.sshConnectionId && sshManager) {
      let sshCommand

      // Try to use project tunnel if projectId is provided
      if (options.projectId) {
        console.log(`[Main] Creating SSH terminal through project ${options.projectId} tunnel`)
        sshCommand = sshManager.buildSSHCommandForProject(options.projectId, options.remoteCwd)
      }

      // Fall back to direct connection if no project or tunnel not available
      if (!sshCommand) {
        console.log(`[Main] Creating SSH terminal with direct connection`)
        sshCommand = sshManager.buildSSHCommand(options.sshConnectionId, options.remoteCwd)
      }

      if (!sshCommand) {
        throw new Error('Failed to build SSH command - connection not found or not connected')
      }

      // Create terminal with SSH shell command
      const info = ptyManager.createTerminalWithCommand(sshCommand.shell, sshCommand.args, options.remoteCwd || '~', options.id)
      return info
    }

    // Create terminal
    console.log(`[Main] pty:create options:`, JSON.stringify({ shell: options.shell, cwd: options.cwd, initialCommand: !!options.initialCommand, id: options.id }))
    const info = ptyManager.createTerminal(options)
    return info
  } catch (error) {
    console.error('Failed to create terminal:', error)
    throw new Error(`Failed to create terminal: ${error instanceof Error ? error.message : String(error)}`)
  }
})

ipcMain.handle('pty:write', async (_event, id: string, data: string) => {
  ptyManager?.write(id, data)
})

ipcMain.handle('pty:resize', async (_event, id: string, cols: number, rows: number) => {
  ptyManager?.resize(id, cols, rows)
})

ipcMain.handle('pty:kill', async (_event, id: string) => {
  ptyManager?.kill(id)
})

ipcMain.handle('pty:list', async () => {
  return ptyManager?.list() ?? []
})

ipcMain.handle('pty:create-with-command', async (_event, shell: string, args: string[], displayCwd: string, hidden?: boolean) => {
  if (!ptyManager) return null
  const info = ptyManager.createTerminalWithCommand(shell, args, displayCwd, undefined, hidden)
  return info
})

ipcMain.handle('system:get-shells', async (_event, projectPath?: string) => {
  const shells: ShellInfo[] = []

  // Helper to check if a shell exists
  const shellExists = (shellPath: string): boolean => {
    try {
      // For Windows commands without full path
      if (process.platform === 'win32' && !shellPath.includes('\\')) {
        execSync(`where ${shellPath}`, { stdio: 'ignore' })
        return true
      }
      return fs.existsSync(shellPath)
    } catch {
      return false
    }
  }

  if (process.platform === 'win32') {
    // Windows shells
    if (shellExists('powershell.exe')) {
      shells.push({ name: 'PowerShell', path: 'powershell.exe' })
    }
    if (shellExists('cmd.exe')) {
      shells.push({ name: 'CMD', path: 'cmd.exe' })
    }

    // Git Bash - check common locations
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ]
    for (const gitPath of gitBashPaths) {
      if (shellExists(gitPath)) {
        shells.push({ name: 'Git Bash', path: gitPath })
        break
      }
    }

  } else {
    // Unix-like shells
    const unixShells: ShellInfo[] = [
      { name: 'bash', path: '/bin/bash' },
      { name: 'zsh', path: '/bin/zsh' },
      { name: 'zsh', path: '/usr/bin/zsh' },
      { name: 'fish', path: '/usr/bin/fish' },
      { name: 'fish', path: '/usr/local/bin/fish' },
      { name: 'sh', path: '/bin/sh' },
    ]

    const addedNames = new Set<string>()
    for (const shell of unixShells) {
      if (!addedNames.has(shell.name) && shellExists(shell.path)) {
        shells.push(shell)
        addedNames.add(shell.name)
      }
    }
  }

  return shells
})

ipcMain.handle('system:get-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    cwd: process.cwd(),
  }
})

ipcMain.handle('dialog:open-directory', async () => {
  if (!mainWindow) return null

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Directory',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

// Get package.json scripts from a directory
// Implementation extracted to services/package-scripts.ts
ipcMain.handle('project:get-scripts', async (_event, projectPath: string, projectId?: string) => {
  try {
    // For SSH projects, use remote execution
    if (projectId && sshManager) {
      const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)

      if (projectMasterStatus.connected) {
        try {
          return await getPackageScriptsRemote(sshManager, projectId, projectPath)
        } catch (error: unknown) {
          console.error('[project:get-scripts] SSH execution failed:', error)
          return { hasPackageJson: false, packages: [], scripts: [], error: getErrorMessage(error) }
        }
      }
    }

    // For local projects, use filesystem operations
    const fsPath = PathService.toFsPath(projectPath)
    return await getPackageScriptsLocal(fsPath, projectPath)
  } catch (err) {
    console.error('Failed to read package.json:', err)
    return { hasPackageJson: false, packages: [], scripts: [], error: String(err) }
  }
})

// Helper to wait for database to be ready
async function waitForDb(timeoutMs = CONSTANTS.DB_WAIT_TIMEOUT_MS): Promise<boolean> {
  const startTime = Date.now()
  while (!dbReady) {
    if (Date.now() - startTime > timeoutMs) {
      console.error('[Database] Timeout waiting for database to be ready')
      return false
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return true
}

// Storage IPC handlers (for Zustand persistence)
ipcMain.handle('store:get', async (_event, key: string) => {
  await waitForDb()

  if (!dbReady) {
    console.error(`[Database] Get "${key}" failed - database not ready`)
    return undefined
  }

  const value = db.get(key)
  return value
})

ipcMain.handle('store:set', async (_event, key: string, value: unknown) => {
  await waitForDb()

  if (!dbReady) {
    console.error(`[Database] Set "${key}" failed - database not ready`)
    return
  }

  db.set(key, value)

  // Verify the write completed
  const verification = db.get(key)
  if (!verification) {
    console.error(`[Database] WARNING: Set "${key}" failed to persist!`)
  }
})

ipcMain.handle('store:delete', async (_event, key: string) => {
  await waitForDb()

  if (!dbReady) {
    console.error(`[Database] Delete "${key}" failed - database not ready`)
    return
  }

  db.delete(key)
})

ipcMain.handle('store:clear', async () => {
  await waitForDb()

  if (!dbReady) {
    console.error('[Database] Clear failed - database not ready')
    return
  }

  db.clear()
})

// Window control IPC handlers
ipcMain.handle('window:minimize', async () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', async () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', async () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', async () => {
  return mainWindow?.isMaximized() ?? false
})

// Open a path in the default code editor
ipcMain.handle('system:open-in-editor', async (_event, projectPath: string) => {
  try {
    // Try VS Code first (most common for developers)
    const editors = process.platform === 'win32'
      ? ['code', 'code-insiders', 'cursor']
      : ['code', 'code-insiders', 'cursor', 'subl', 'atom']

    for (const editor of editors) {
      try {
        await new Promise<void>((resolve, reject) => {
          exec(`${editor} "${projectPath}"`, (error) => {
            if (error) reject(error)
            else resolve()
          })
        })
        return { success: true, editor }
      } catch {
        // Try next editor
      }
    }

    // Fall back to system default (open folder in file manager)
    await shell.openPath(projectPath)
    return { success: true, editor: 'system-default' }
  } catch (err) {
    console.error('Failed to open in editor:', err)
    return { success: false, error: String(err) }
  }
})

// Open URL in default browser
ipcMain.handle('system:open-external', async (_event, url: string) => {
  await shell.openExternal(url)
})

// SSH IPC Handlers
ipcMain.handle('ssh:connect', async (_event, config: SSHConnectionConfig) => {
  if (!sshManager) {
    return { success: false, error: 'SSH manager not initialized' }
  }
  return sshManager.connect(config)
})

ipcMain.handle('ssh:disconnect', async (_event, connectionId: string) => {
  if (!sshManager) {
    return { success: false, error: 'SSH manager not initialized' }
  }
  return sshManager.disconnect(connectionId)
})

ipcMain.handle('ssh:test', async (_event, config: SSHConnectionConfig) => {
  if (!sshManager) {
    return { success: false, error: 'SSH manager not initialized' }
  }
  return sshManager.testConnection(config)
})

ipcMain.handle('ssh:get-status', async (_event, connectionId: string) => {
  if (!sshManager) {
    return { connected: false, error: 'SSH manager not initialized' }
  }
  return sshManager.getStatus(connectionId)
})

// Project-level SSH connection IPC handlers
ipcMain.handle('ssh:connect-project', async (_event, projectId: string, sshConnectionId: string) => {
  if (!sshManager) {
    return { success: false, error: 'SSH manager not initialized' }
  }

  // First ensure the SSH connection itself is established
  const connections = sshManager.getConnectionIds()
  if (!connections.includes(sshConnectionId)) {
    // Need to get the SSH config from the store
    // For now, return error - the frontend should establish SSH connection first
    return { success: false, error: 'SSH connection not established. Please connect to SSH first.' }
  }

  return await sshManager.connectProjectMaster(projectId, sshConnectionId)
})

ipcMain.handle('ssh:disconnect-project', async (_event, projectId: string) => {
  if (!sshManager) {
    return { success: false, error: 'SSH manager not initialized' }
  }
  return await sshManager.disconnectProjectMaster(projectId)
})

ipcMain.handle('ssh:get-interactive-master-command', async (_event, projectId: string) => {
  if (!sshManager) {
    return null
  }
  return sshManager.getInteractiveMasterCommand(projectId)
})

ipcMain.handle('ssh:mark-project-connected', async (_event, projectId: string) => {
  if (!sshManager) {
    return { success: false, error: 'SSH manager not available' }
  }
  // Verify the ControlMaster tunnel actually works before declaring success.
  return sshManager.verifyAndMarkProjectConnected(projectId)
})

ipcMain.handle('ssh:connect-project-with-password', async (_event, projectId: string, password: string) => {
  if (!sshManager) {
    return { success: false, error: 'SSH manager not available' }
  }
  return sshManager.connectProjectMasterWithPassword(projectId, password)
})

// CLI Detection IPC Handlers
ipcMain.handle('cli:detect-all', async (_event, projectPath: string, projectId?: string, forceRefresh?: boolean): Promise<AllCliToolsResult> => {
  try {
    const result = await detectAllCliTools(projectPath, {
      projectId,
      sshManager: sshManager || undefined,
      forceRefresh: forceRefresh ?? false
    })
    return result
  } catch (error: unknown) {
    console.error('[CLI] Detection failed:', error)
    return {
      tools: BUILTIN_CLI_TOOLS.map(tool => ({
        id: tool.id,
        name: tool.name,
        installed: false,
        error: getErrorMessage(error)
      })),
      success: false,
      error: getErrorMessage(error)
    }
  }
})

ipcMain.handle('cli:detect', async (_event, toolId: string, projectPath: string, projectId?: string): Promise<CliToolDetectionResult> => {
  try {
    const toolDef = BUILTIN_CLI_TOOLS.find(t => t.id === toolId)
    if (!toolDef) {
      return {
        id: toolId,
        name: toolId,
        installed: false,
        error: `Unknown tool: ${toolId}`
      }
    }
    const result = await detectCliTool(toolDef, projectPath, projectId, sshManager || undefined)
    return result
  } catch (error: unknown) {
    console.error(`[CLI] Detection failed for ${toolId}:`, error)
    return {
      id: toolId,
      name: toolId,
      installed: false,
      error: getErrorMessage(error)
    }
  }
})

ipcMain.handle('cli:install', async (_event, agentId: string, method: 'npm' | 'native' | 'brew') => {
  try {
    console.log('[CLI] Installing', agentId, 'via', method)
    return await installCliTool(agentId, method, process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', '')
  } catch (error: unknown) {
    console.error('[CLI] Install error:', error)
    return { success: false, output: '', error: getErrorMessage(error) }
  }
})

ipcMain.handle('cli:get-platform', async () => {
  try {
    return await getPlatformForInstall()
  } catch (error: unknown) {
    console.error('[CLI] Get platform error:', error)
    // Fallback to process.platform mapping
    return process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
  }
})

ipcMain.handle('cli:check-update', async (_event, agentId: string, currentVersion: string | null): Promise<UpdateCheckResult> => {
  try {
    return await checkAgentUpdate(agentId, currentVersion)
  } catch (error: unknown) {
    console.error(`[CLI] Update check error for ${agentId}:`, error)
    return {
      agentId,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      error: getErrorMessage(error)
    }
  }
})

ipcMain.handle('cli:check-updates', async (_event, agents: Array<{ id: string; version: string | null }>): Promise<UpdateCheckResult[]> => {
  try {
    return await checkAgentUpdates(agents)
  } catch (error: unknown) {
    console.error('[CLI] Update check error:', error)
    return agents.map(agent => ({
      agentId: agent.id,
      currentVersion: agent.version,
      latestVersion: null,
      updateAvailable: false,
      error: getErrorMessage(error)
    }))
  }
})

ipcMain.handle('cli:get-models', async (_event, agentId: string): Promise<AgentModelOption[]> => {
  try {
    return await getAgentModels(agentId)
  } catch (error: unknown) {
    console.error(`[CLI] Get models error for ${agentId}:`, error)
    return []
  }
})

// ============================================================================
// Agent Terminal IPC Handlers
// ============================================================================

/**
 * Create an agent terminal that runs an AI CLI tool and optionally injects context
 */
ipcMain.handle('agent:create-terminal', async (_event, options: {
  projectId: string
  agentId: string  // 'claude' | 'gemini' | 'codex'
  context?: string
  cwd: string
}) => {
  if (!ptyManager) {
    return { success: false, error: 'PTY manager not initialized' }
  }

  const { agentId, context, cwd } = options

  try {
    // The agent command is simply the agent ID (claude, gemini, codex)
    // The cli-detector already validates these are installed
    const info = ptyManager.createAgentTerminal({
      cwd,
      agentCommand: agentId,
      context,
    })

    return {
      success: true,
      terminal: info
    }
  } catch (error: unknown) {
    console.error(`[Agent] Failed to create agent terminal:`, error)
    return {
      success: false,
      error: getErrorMessage(error)
    }
  }
})

/**
 * Inject context into an existing terminal's stdin
 */
ipcMain.handle('agent:inject-context', async (_event, terminalId: string, context: string) => {
  if (!ptyManager) {
    return { success: false, error: 'PTY manager not initialized' }
  }

  return ptyManager.injectContext(terminalId, context)
})

// Agent Process handlers (PTY-based for true streaming support)
ipcMain.handle('agent:spawn', async (_event, options: { agentType: 'claude' | 'codex' | 'gemini', cwd: string, sessionId?: string, resumeSessionId?: string, prompt?: string, model?: string, allowedTools?: string[], projectId?: string, contextContent?: string, skipPermissions?: boolean }) => {
  if (!ptyManager) throw new Error('PTY manager not initialized')

  const { agentType, cwd, resumeSessionId, prompt, model, allowedTools, projectId, contextContent, skipPermissions } = options

  // Build the CLI command based on agent type
  let command: string
  switch (agentType) {
    case 'claude': {
      // -p: print mode (non-interactive, required for --output-format)
      // --output-format stream-json: realtime streaming JSON events
      // --input-format stream-json: accept JSON input via stdin for multi-turn
      // --verbose: include additional metadata
      // --include-partial-messages: get incremental deltas, not just complete blocks
      //
      // `stty -icanon` disables canonical mode on the PTY so that the line
      // discipline does NOT buffer input into ~4096-byte lines. Without this,
      // large single-line JSON messages (e.g. pasted error dumps with URLs)
      // get silently truncated by the kernel's MAX_CANON limit and Claude CLI
      // receives malformed JSON, causing it to never respond.
      //
      // `cat |` keeps a stable child process alive for node-pty's ConPTY
      // process monitoring (without it, AttachConsole fails on Windows).
      let claudeCmd = 'claude -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages'
      if (resumeSessionId) {
        claudeCmd += ` --resume ${resumeSessionId}`
      }
      if (model) {
        claudeCmd += ` --model ${model}`
      }
      if (allowedTools && allowedTools.length > 0) {
        claudeCmd += ' --allowedTools ' + allowedTools.map(t => `"${t}"`).join(' ')
      }
      if (contextContent) {
        const escapedContext = contextContent
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\$/g, '\\$')
          .replace(/`/g, '\\`')
        claudeCmd += ` --append-system-prompt "${escapedContext}"`
      }
      if (skipPermissions) {
        claudeCmd += ' --dangerously-skip-permissions'
      }
      command = `stty -icanon && cat | ${claudeCmd}`
      break
    }
    case 'codex': {
      // Codex CLI uses one-shot `exec` mode with --json for NDJSON streaming.
      // Unlike Claude, the prompt is passed as a CLI argument, not piped via stdin.
      // Each turn spawns a new process; multi-turn uses `exec resume SESSION_ID`.
      //
      // --full-auto: grants workspace-write sandbox + on-request approval.
      //   Without this, Codex defaults to read-only sandbox and can't write
      //   files or execute commands. Interactive approval (JSON-RPC) is only
      //   available in app-server mode, not exec mode.
      if (!prompt && !resumeSessionId) {
        // Initial spawn without prompt — create an idle placeholder process.
        // It will be replaced when the user sends their first message, which
        // triggers a new spawn with the prompt included.
        command = 'sleep infinity'
        break
      }
      // Shell-escape the prompt using single quotes (replace ' with '\'' for safe embedding)
      const escapedPrompt = prompt ? prompt.replace(/'/g, "'\\''") : ''
      const codexModelFlag = model ? ` --model ${model}` : ''
      if (resumeSessionId) {
        // Resume a previous session with an optional follow-up prompt
        command = escapedPrompt
          ? `codex exec --json --full-auto${codexModelFlag} resume ${resumeSessionId} '${escapedPrompt}'`
          : `codex exec --json --full-auto${codexModelFlag} resume ${resumeSessionId}`
      } else {
        command = `codex exec --json --full-auto${codexModelFlag} '${escapedPrompt}'`
      }
      break
    }
    case 'gemini':
      command = 'gemini'
      break
    default:
      throw new Error(`Unknown agent type: ${agentType}`)
  }

  // Check if this is an SSH project — if so, run the agent command on the remote host
  // through the existing ControlMaster tunnel. The NDJSON output streams back through
  // SSH to our local PTY where StreamJsonDetector parses it unchanged.
  let terminalInfo: import('./pty-manager.js').TerminalInfo
  if (projectId && sshManager) {
    const sshCmd = sshManager.buildSSHCommandForAgent(projectId, cwd, command)
    if (sshCmd) {
      console.log(`[Agent] Routing agent through SSH tunnel for project ${projectId}`)
      terminalInfo = ptyManager.createTerminalWithCommand(
        sshCmd.shell,
        sshCmd.args,
        cwd,       // display cwd (remote path)
        undefined, // auto-generate id
        true       // hidden
      )
    } else {
      // SSH project but tunnel not available — fall through to local spawn
      console.warn(`[Agent] SSH tunnel not available for project ${projectId}, spawning locally`)
      terminalInfo = ptyManager.createTerminal({
        cwd,
        initialCommand: command,
        hidden: true,
        title: agentType,
      })
    }
  } else {
    // Local or WSL project — spawn directly (pty-manager auto-detects WSL from cwd)
    if (process.platform === 'win32' && PathService.isWslPath(cwd)) {
      console.log(`[Agent] Routing agent through WSL for cwd: ${cwd}`)
    }
    terminalInfo = ptyManager.createTerminal({
      cwd,
      initialCommand: command,
      hidden: true,
      title: agentType,
    })
  }

  // Track the agent terminal
  const agentInfo: AgentTerminalInfo = {
    id: terminalInfo.id,
    agentType,
    cwd,
    sessionId: resumeSessionId,
    createdAt: Date.now(),
  }
  agentTerminals.set(terminalInfo.id, agentInfo)

  return {
    success: true,
    process: {
      id: terminalInfo.id,
      agentType,
      cwd,
      sessionId: resumeSessionId,
      pid: terminalInfo.pid,
    }
  }
})

ipcMain.handle('agent:send-message', async (_event, id: string, message: Record<string, unknown>) => {
  if (!ptyManager) return { success: false, error: 'PTY manager not initialized' }

  const agentInfo = agentTerminals.get(id)
  if (!agentInfo) {
    console.warn(`[Agent] send-message: terminal ${id} not found (may have been killed)`)
    return { success: false, error: `Agent terminal ${id} not found` }
  }

  // Codex uses one-shot `exec` mode — the prompt is part of the spawn command,
  // not piped via stdin. Multi-turn messages spawn a new process via agent:spawn
  // with resumeSessionId + prompt. Sending messages to stdin is a no-op for Codex.
  if (agentInfo.agentType === 'codex') {
    return { success: true }
  }

  // With --input-format stream-json, Claude expects NDJSON messages
  // Format: {"type": "user", "message": {"role": "user", "content": "..."}}
  const jsonMessage = JSON.stringify(message) + '\n'

  console.log(`[Agent] Sending message to ${id} (${jsonMessage.length} chars, ${agentInfo.agentType})`)

  // Use chunked writes for large messages (e.g. pasted error dumps, URLs).
  // ConPTY on Windows can silently truncate a single large write, causing
  // the Claude CLI to receive malformed JSON and never respond.
  try {
    await ptyManager.writeChunked(id, jsonMessage)
  } catch (err) {
    console.error(`[Agent] Failed to write message to ${id}:`, err)
    return { success: false, error: `Failed to write message: ${err}` }
  }

  return { success: true }
})

ipcMain.handle('agent:kill', async (_event, id: string) => {
  if (!ptyManager) return { success: false, error: 'PTY manager not initialized' }

  if (agentTerminals.has(id)) {
    ptyManager.kill(id)
    agentTerminals.delete(id)
  }

  return { success: true }
})

ipcMain.handle('agent:list', async () => {
  // Return list of active agent terminals
  const processes = Array.from(agentTerminals.values())
  return { success: true, processes }
})

// ============================================================================
// Agent Title Generation
// ============================================================================

ipcMain.handle('agent:generate-title', async (_event, options: { userMessages: string[] }) => {
  if (!backgroundClaude) {
    return { success: false, error: 'BackgroundClaudeManager not initialized' }
  }
  try {
    const messagesText = options.userMessages
      .map((msg, i) => `Message ${i + 1}: ${msg}`)
      .join('\n')

    const prompt = `Given these user messages from a coding assistant session, generate a 1-3 word title that summarizes the topic. Reply with ONLY the title, nothing else. No quotes, no punctuation.\n\n${messagesText}`

    const result = await backgroundClaude.runTask({
      prompt,
      projectPath: process.cwd(),
      model: 'haiku',
      outputFormat: 'text',
      timeout: 30000,
      skipPermissions: true,
    })

    if (result.success && result.output) {
      const title = result.output.trim().replace(/^["']|["']$/g, '')
      return { success: true, title }
    }
    return { success: false, error: result.error || 'No output' }
  } catch (error: any) {
    console.warn('[Main] Title generation failed:', error.message)
    return { success: false, error: error.message }
  }
})

// ============================================================================
// Permission Hook IPC Handlers
// ============================================================================

ipcMain.handle('permission:respond', async (_event, id: string, decision: 'allow' | 'deny', reason?: string, alwaysAllow?: boolean, bashRules?: string[][]) => {
  // Codex approval requests use a composite ID: "codex:<terminalId>:<jsonRpcId>"
  // Route these to the PTY stdin instead of the file-based permission server.
  if (id.startsWith('codex:')) {
    const parts = id.split(':')
    const terminalId = parts[1]
    const jsonRpcId = parseInt(parts[2], 10)

    if (!ptyManager || isNaN(jsonRpcId)) {
      return { success: false, error: 'Invalid Codex approval ID or PTY manager unavailable' }
    }

    // Build JSON-RPC response that Codex expects on stdin
    const codexDecision = decision === 'allow' ? 'accept' : 'decline'
    const jsonRpcResponse = JSON.stringify({
      id: jsonRpcId,
      result: { decision: codexDecision },
    })

    console.log(`[Permission] Codex approval response for terminal ${terminalId}: ${codexDecision}`)
    ptyManager.write(terminalId, jsonRpcResponse + '\n')
    return { success: true }
  }

  // Claude file-based permission flow
  if (!permissionServer) return { success: false, error: 'Permission server not running' }
  const resolved = permissionServer.resolvePermission(id, { decision, reason }, alwaysAllow, bashRules)
  return { success: resolved }
})

ipcMain.handle('permission:check-hook', async (_event, projectPath: string) => {
  const installed = PermissionServer.isHookInstalled(projectPath)
  if (installed) {
    // Re-install to ensure hook command stays current across code changes
    PermissionServer.installHook(projectPath)
    permissionServer?.watchProject(projectPath)
    return true
  }
  // Auto-migrate: if an old .js version of the hook exists, upgrade it to .cjs
  if (PermissionServer.hasLegacyHook(projectPath)) {
    const result = PermissionServer.installHook(projectPath)
    if (result.success) {
      permissionServer?.watchProject(projectPath)
      return true
    }
  }
  return false
})

ipcMain.handle('permission:install-hook', async (_event, projectPath: string) => {
  const result = PermissionServer.installHook(projectPath)
  if (result.success) {
    permissionServer?.watchProject(projectPath)
  }
  return result
})

ipcMain.handle('permission:get-bash-rules', async (_event, projectPath: string) => {
  return PermissionServer.readAllowlistConfig(projectPath).bashRules
})

ipcMain.handle('permission:get-allowlist-config', async (_event, projectPath: string) => {
  return PermissionServer.readAllowlistConfig(projectPath)
})

ipcMain.handle('permission:remove-bash-rule', async (_event, projectPath: string, rule: string[]) => {
  try {
    PermissionServer.removeBashRule(projectPath, rule)
    return { success: true }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) }
  }
})

ipcMain.handle('permission:add-allowed-tool', async (_event, projectPath: string, toolName: string) => {
  try {
    PermissionServer.addToAllowlist(projectPath, toolName)
    return { success: true }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) }
  }
})

ipcMain.handle('permission:remove-allowed-tool', async (_event, projectPath: string, toolName: string) => {
  try {
    PermissionServer.removeFromAllowlist(projectPath, toolName)
    return { success: true }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) }
  }
})

// App version IPC handler
ipcMain.handle('app:get-version', async () => {
  return app.getVersion()
})

// Log file IPC handlers
ipcMain.handle('log:open-folder', async () => {
  const logPath = getLogPath()
  const logDir = path.dirname(logPath)
  await shell.openPath(logDir)
})

ipcMain.handle('log:get-path', () => {
  return getLogPath()
})

ipcMain.handle('log:report-renderer-error', (_event, errorData: { message: string; stack?: string; componentStack?: string }) => {
  logger.error('Renderer', `${errorData.message}${errorData.stack ? '\n' + errorData.stack : ''}${errorData.componentStack ? '\nComponent Stack:\n' + errorData.componentStack : ''}`)
})

// Event log IPC handlers
ipcMain.handle('log:get-event-log-path', () => {
  return getEventLogPath()
})

ipcMain.handle('log:open-event-log-folder', async () => {
  const logPath = getEventLogPath()
  const logDir = path.dirname(logPath)
  await shell.openPath(logDir)
})

// ============================================================================
// Service Manager IPC Handlers
// ============================================================================

ipcMain.handle('service:discover', async (_event, projectPath: string, projectId: string) => {
  try {
    const services = await serviceManager.discoverServices(projectPath, projectId)
    return { success: true, services }
  } catch (error: unknown) {
    console.error('[Service] Discovery failed:', error)
    return { success: false, services: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('service:getStatus', async (_event, serviceId: string) => {
  try {
    const status = await serviceManager.getStatus(serviceId)
    return { success: true, status }
  } catch (error: unknown) {
    console.error('[Service] Get status failed:', error)
    return { success: false, status: 'unknown', error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('service:start', async (_event, serviceId: string) => {
  try {
    await serviceManager.start(serviceId)
    return { success: true }
  } catch (error: unknown) {
    console.error('[Service] Start failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('service:stop', async (_event, serviceId: string) => {
  try {
    await serviceManager.stop(serviceId)
    return { success: true }
  } catch (error: unknown) {
    console.error('[Service] Stop failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('service:restart', async (_event, serviceId: string) => {
  try {
    await serviceManager.restart(serviceId)
    return { success: true }
  } catch (error: unknown) {
    console.error('[Service] Restart failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('service:list', async (_event, projectId?: string) => {
  try {
    const services = projectId
      ? serviceManager.getServicesByProject(projectId)
      : serviceManager.getServices()
    return { success: true, services }
  } catch (error: unknown) {
    console.error('[Service] List failed:', error)
    return { success: false, services: [], error: error instanceof Error ? error.message : String(error) }
  }
})

// ============================================================================
// Docker IPC Handlers
// ============================================================================

ipcMain.handle('docker:isAvailable', async (_event, projectPath?: string) => {
  try {
    const available = await dockerCli.isAvailable(projectPath)
    return { success: true, available }
  } catch (error: unknown) {
    console.error('[Docker] Availability check failed:', error)
    return { success: false, available: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('docker:getLogs', async (_event, serviceId: string, tail?: number) => {
  try {
    const logs = await dockerComposeHandler.getLogs(serviceId, tail || 100)
    return { success: true, logs }
  } catch (error: unknown) {
    console.error('[Docker] Get logs failed:', error)
    return { success: false, logs: '', error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('docker:listStacks', async (_event, projectPath: string) => {
  return dockerCli.listStacks(projectPath)
})

ipcMain.handle('docker:getStackContainers', async (_event, stackName: string, projectPath: string) => {
  return dockerCli.getStackContainers(stackName, projectPath)
})

ipcMain.handle('docker:upStack', async (_event, stackName: string, configFiles: string, projectPath: string) => {
  return dockerCli.upStack(stackName, configFiles, projectPath)
})

ipcMain.handle('docker:stopStack', async (_event, stackName: string, configFiles: string, projectPath: string) => {
  return dockerCli.stopStack(stackName, configFiles, projectPath)
})

ipcMain.handle('docker:downStack', async (_event, stackName: string, configFiles: string, projectPath: string) => {
  return dockerCli.downStack(stackName, configFiles, projectPath)
})

ipcMain.handle('docker:restartStack', async (_event, stackName: string, configFiles: string, projectPath: string) => {
  return dockerCli.restartStack(stackName, configFiles, projectPath)
})

// ─── Skill/Plugin Management IPC ──────────────────────────────────

// Execute a CLI command and return stdout. On Windows, routes through Git Bash
// so that tools installed via npm (e.g. claude) are found in PATH.
async function execCliCommand(command: string, cwd?: string): Promise<string> {
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  if (process.platform === 'win32') {
    const gitBashPath = getGitBashPath()
    if (gitBashPath) {
      const escaped = command.replace(/"/g, '\\"')
      const { stdout } = await execAsync(`"${gitBashPath}" -l -c "${escaped}"`, {
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
        cwd,
      })
      return stdout
    }
  }

  const { stdout } = await execAsync(command, {
    encoding: 'utf-8',
    timeout: 30000,
    cwd,
  })
  return stdout
}

ipcMain.handle('skill:list-installed', async () => {
  try {
    const stdout = await execCliCommand('claude plugin list --json')
    const skills = JSON.parse(stdout)
    return { success: true, skills: Array.isArray(skills) ? skills : [] }
  } catch (error: unknown) {
    console.error('[Skills] List installed failed:', error)
    return { success: false, skills: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('skill:list-available', async () => {
  try {
    const stdout = await execCliCommand('claude plugin list --available --json')
    const parsed = JSON.parse(stdout)
    // The --available flag returns { installed: [...], available: [...] }
    const available = parsed.available || parsed || []
    return { success: true, skills: Array.isArray(available) ? available : [] }
  } catch (error: unknown) {
    console.error('[Skills] List available failed:', error)
    return { success: false, skills: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('skill:install', async (_event, pluginId: string, source: 'anthropic' | 'vercel', scope?: 'user' | 'project' | 'local', projectPath?: string) => {
  try {
    // Use projectPath as cwd so --scope project binds to the correct project
    const cwd = projectPath || undefined
    if (source === 'anthropic') {
      const name = pluginId.split('@')[0] || pluginId
      const scopeFlag = scope ? ` --scope ${scope}` : ''
      await execCliCommand(`claude plugin install ${name}${scopeFlag}`, cwd)
    } else {
      await execCliCommand(`npx skills add ${pluginId} --agent claude-code --yes`, cwd)
    }
    return { success: true }
  } catch (error: unknown) {
    console.error('[Skills] Install failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('skill:uninstall', async (_event, pluginId: string) => {
  try {
    const name = pluginId.split('@')[0] || pluginId
    await execCliCommand(`claude plugin uninstall ${name}`)
    return { success: true }
  } catch (error: unknown) {
    console.error('[Skills] Uninstall failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('skill:search-vercel', async (_event, query: string, limit?: number) => {
  try {
    if (!query || query.trim().length === 0) {
      return { success: true, skills: [] }
    }
    const url = `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=${limit || 20}`
    const response = await fetch(url)
    if (!response.ok) {
      return { success: false, skills: [], error: `Skills.sh API returned ${response.status}` }
    }
    const data = await response.json() as { skills?: Array<{ id: string; skillId: string; name: string; installs: number; source: string }> }
    return { success: true, skills: data.skills || [] }
  } catch (error: unknown) {
    console.error('[Skills] Vercel search failed:', error)
    return { success: false, skills: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('skill:mcp-status', async () => {
  try {
    const stdout = await execCliCommand('claude mcp list')
    const lines = stdout.split('\n').filter((l) => l.includes(' - '))
    const servers = lines.map((line) => {
      // Format: "source:name: endpoint - STATUS"
      const dashIdx = line.lastIndexOf(' - ')
      if (dashIdx === -1) return null
      const prefix = line.substring(0, dashIdx).trim()
      const statusText = line.substring(dashIdx + 3).trim()

      // Parse status
      let status: 'connected' | 'needs_auth' | 'failed' | 'unknown' = 'unknown'
      if (statusText.includes('Connected')) status = 'connected'
      else if (statusText.includes('Needs authentication')) status = 'needs_auth'
      else if (statusText.includes('Failed')) status = 'failed'

      // Parse name and endpoint: "plugin:context7:context7: npx -y @upstash/context7-mcp"
      const colonIdx = prefix.indexOf(': ')
      const source = colonIdx !== -1 ? prefix.substring(0, colonIdx) : prefix
      const endpoint = colonIdx !== -1 ? prefix.substring(colonIdx + 2) : ''

      // Extract short name from source (last segment)
      const parts = source.split(':')
      const name = parts[parts.length - 1] || source

      return { name, source, endpoint, status }
    }).filter(Boolean)
    return { success: true, servers }
  } catch (error: unknown) {
    console.error('[Skills] MCP status failed:', error)
    return { success: false, servers: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('skill:toggle', async (_event, pluginId: string, enabled: boolean) => {
  try {
    const name = pluginId.split('@')[0] || pluginId
    const cmd = enabled ? 'enable' : 'disable'
    await execCliCommand(`claude plugin ${cmd} ${name}`)
    return { success: true }
  } catch (error: unknown) {
    console.error('[Skills] Toggle failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

app.whenReady().then(() => {
  initEventLogger()
  createMenu()
  createWindow()
  setupAutoUpdater()
})

app.on('window-all-closed', () => {
  closeEventLogger()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
