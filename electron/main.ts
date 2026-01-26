import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { autoUpdater } from 'electron-updater'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PtyManager } from './pty-manager.js'
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
import {
  convertToWslUncPath,
  getWslDistros,
  buildWslCommand,
  type WslPathInfo
} from './utils/wsl-utils.js'
import { PathService, type ExecutionContext } from './utils/path-service.js'
import {
  detectCliTool,
  detectAllCliTools,
  BUILTIN_CLI_TOOLS,
  type CliToolDetectionResult,
  type AllCliToolsResult
} from './services/cli-detector.js'
import { installCliTool, getPlatformForInstall } from './services/cli-installer.js'



const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface ShellInfo {
  name: string
  path: string
}

// ScriptInfo and PackageScripts interfaces moved to services/package-scripts.ts

// Execute a command in the appropriate context (local, WSL, or SSH)
// This is the main abstraction that routes commands correctly
function execInContext(command: string, projectPath: string, options: { encoding: 'utf-8' } = { encoding: 'utf-8' }): string {
  const pathInfo = PathService.analyzePath(projectPath)
  const isWsl = pathInfo.type === 'wsl-unc' || pathInfo.type === 'wsl-linux'

  if (process.platform === 'win32' && isWsl) {
    const wslCommand = buildWslCommand(command, projectPath, { isWslPath: isWsl, linuxPath: pathInfo.linuxPath, distro: pathInfo.wslDistro })
    return execSync(wslCommand.cmd, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  return execSync(command, {
    cwd: projectPath,
    ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

// Execute a command asynchronously in the appropriate context (local, WSL, or SSH)
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
      // Use wsl.exe for WSL paths
      return new Promise((resolve, reject) => {
        const pathInfo = PathService.analyzePath(projectPath)
        const wslCommand = buildWslCommand(command, projectPath, {
          isWslPath: true,
          linuxPath: pathInfo.linuxPath,
          distro: pathInfo.wslDistro
        })

        exec(wslCommand.cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            const execError = error as ExecError
            console.error(`[execInContextAsync] WSL command failed: ${command.substring(0, 50)}...`, execError.message)
            reject(error)
          } else {
            resolve(stdout)
          }
        })
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

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version)
    mainWindow?.webContents.send('update:available', info)
  })

  autoUpdater.on('update-not-available', () => {
    console.log('App is up to date')
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Download progress: ${progress.percent.toFixed(1)}%`)
    mainWindow?.webContents.send('update:progress', progress)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    console.log('Update downloaded:', info.version)

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

  // On Windows, use custom TitleBar menus instead of native menu
  if (isWindows) {
    Menu.setApplicationMenu(null)
    return
  }

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


// Git watching for detecting branch and file changes

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')
  console.log('[Main] __dirname:', __dirname)
  console.log('[Main] Preload path:', preloadPath)
  console.log('[Main] Preload exists:', fs.existsSync(preloadPath))

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

  // Initialize BackgroundClaudeManager
  backgroundClaude = new BackgroundClaudeManager(ptyManager)
  await backgroundClaude.initialize()
  console.log('[Main] BackgroundClaudeManager initialized')


  // Forward SSH status changes to renderer
  sshManager.on('status-change', (connectionId: string, connected: boolean, error?: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ssh:status-change', connectionId, connected, error)
    }
  })

  // Register all git-related IPC handlers
  registerGitHandlers(mainWindow, sshManager, execInContextAsync)

  // Register all file system related IPC handlers
  registerFsHandlers(sshManager)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    ptyManager?.dispose()
    ptyManager = null
    sshManager?.disposeAll()
    sshManager = null
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

    // WSL - list each distro separately
    const distros = getWslDistros()
    for (const distro of distros) {
      shells.push({ name: `WSL (${distro})`, path: `wsl.exe -d ${distro}` })
    }
    // If no specific distros but WSL is available, add generic WSL option
    if (distros.length === 0) {
      try {
        execSync('wsl --status', { stdio: 'ignore' })
        shells.push({ name: 'WSL', path: 'wsl.exe' })
      } catch {
        // WSL not available
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

  // Filter shells for WSL projects - only show WSL shells
  if (process.platform === 'win32' && PathService.isWslPath(projectPath)) {
    return shells.filter(shell => shell.name.includes('WSL'))
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
  console.log(`[project:get-scripts] Called with projectPath="${projectPath}", projectId="${projectId}"`)

  try {
    // For SSH projects, use remote execution
    if (projectId && sshManager) {
      const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
      console.log(`[project:get-scripts] SSH manager exists, project master status:`, projectMasterStatus)

      if (projectMasterStatus.connected) {
        console.log(`[project:get-scripts] Using SSH execution for project ${projectId}`)
        try {
          return await getPackageScriptsRemote(sshManager, projectId, projectPath)
        } catch (error: unknown) {
          console.error('[project:get-scripts] SSH execution failed:', error)
          return { hasPackageJson: false, packages: [], scripts: [], error: getErrorMessage(error) }
        }
      } else {
        console.log(`[project:get-scripts] SSH project master not connected, falling back to local`)
      }
    }

    // For local/WSL projects, use filesystem operations
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
    return { success: false }
  }
  sshManager.markProjectMasterConnected(projectId)
  return { success: true }
})

// CLI Detection IPC Handlers
ipcMain.handle('cli:detect-all', async (_event, projectPath: string, projectId?: string): Promise<AllCliToolsResult> => {
  console.log(`[CLI] Detecting all CLI tools for path="${projectPath}", projectId="${projectId}"`)
  try {
    const result = await detectAllCliTools(projectPath, projectId, sshManager || undefined)
    console.log(`[CLI] Detection complete:`, result.tools.map(t => `${t.id}:${t.installed}`))
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
  console.log(`[CLI] Detecting tool "${toolId}" for path="${projectPath}", projectId="${projectId}"`)
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
    console.log(`[CLI] Detection result for ${toolId}:`, result)
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
  console.log('[Main] agent:create-terminal called:', {
    agentId: options.agentId,
    hasContext: !!options.context,
    contextLength: options.context?.length,
    contextPreview: options.context?.substring(0, 100),
    cwd: options.cwd
  })
  console.log(`[Agent] Creating agent terminal for ${agentId} in ${cwd}`)

  try {
    // The agent command is simply the agent ID (claude, gemini, codex)
    // The cli-detector already validates these are installed
    const info = ptyManager.createAgentTerminal({
      cwd,
      agentCommand: agentId,
      context,
    })

    console.log(`[Agent] Created terminal ${info.id} for ${agentId}`)

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

  console.log(`[Agent] Injecting context into terminal ${terminalId} (${context.length} bytes)`)

  return ptyManager.injectContext(terminalId, context)
})

// App version IPC handler
ipcMain.handle('app:get-version', async () => {
  return app.getVersion()
})

app.whenReady().then(() => {
  createMenu()
  createWindow()
  setupAutoUpdater()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
