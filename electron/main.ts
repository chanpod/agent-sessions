import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { autoUpdater } from 'electron-updater'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PtyManager } from './pty-manager.js'
import { SSHManager } from './ssh-manager.js'
import { ToolChainDB } from './database.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// WSL path detection and conversion utilities
interface WslPathInfo {
  isWslPath: boolean
  distro?: string
  linuxPath?: string
}

function detectWslPath(inputPath: string): WslPathInfo {
  // Check for UNC WSL paths: \\wsl$\Ubuntu\... or \\wsl.localhost\Ubuntu\...
  const uncMatch = inputPath.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(.*)$/i)
  if (uncMatch) {
    return {
      isWslPath: true,
      distro: uncMatch[1],
      linuxPath: uncMatch[2].replace(/\\/g, '/') || '/',
    }
  }

  // Check for Linux-style paths that start with / (common when user types path manually)
  if (process.platform === 'win32' && inputPath.startsWith('/') && !inputPath.startsWith('//')) {
    return {
      isWslPath: true,
      linuxPath: inputPath,
    }
  }

  return { isWslPath: false }
}

function convertToWslUncPath(linuxPath: string, distro?: string): string {
  const dist = distro || getDefaultWslDistro()
  if (!dist) return linuxPath
  return `\\\\wsl$\\${dist}${linuxPath.replace(/\//g, '\\')}`
}

function getDefaultWslDistro(): string | null {
  if (process.platform !== 'win32') return null
  try {
    // Get the default WSL distribution
    const output = execSync('wsl -l -q', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    // Output has UTF-16 encoding issues on Windows, clean it up
    const lines = output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 0)
    return lines[0] || null
  } catch {
    return null
  }
}

function getWslDistros(): string[] {
  if (process.platform !== 'win32') return []
  try {
    const output = execSync('wsl -l -q', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 0)
  } catch {
    return []
  }
}

// Execute a command, routing through WSL if needed
function execInContext(command: string, projectPath: string, options: { encoding: 'utf-8' } = { encoding: 'utf-8' }): string {
  const wslInfo = detectWslPath(projectPath)

  if (process.platform === 'win32' && wslInfo.isWslPath) {
    const linuxPath = wslInfo.linuxPath || projectPath
    const distroArg = wslInfo.distro ? `-d ${wslInfo.distro} ` : ''
    // Escape double quotes in the command for WSL
    const escapedCmd = command.replace(/"/g, '\\"')
    return execSync(`wsl ${distroArg}bash -c "cd '${linuxPath}' && ${escapedCmd}"`, {
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

// Resolve path for file system operations (converts WSL paths to UNC on Windows)
function resolvePathForFs(inputPath: string): string {
  if (process.platform !== 'win32') return inputPath

  const wslInfo = detectWslPath(inputPath)
  if (wslInfo.isWslPath && wslInfo.linuxPath && !inputPath.startsWith('\\\\')) {
    return convertToWslUncPath(wslInfo.linuxPath, wslInfo.distro)
  }

  return inputPath
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

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version)
    // Send to renderer to show non-invasive notification
    mainWindow?.webContents.send('update:downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  // Check for updates immediately
  autoUpdater.checkForUpdatesAndNotify()

  // Poll for updates every 60 seconds
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, 60000)
}

// IPC handler to install update when user clicks "Update Now"
ipcMain.handle('update:install', async () => {
  autoUpdater.quitAndInstall()
})

function createMenu() {
  const isMac = process.platform === 'darwin'

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

// Git watchers for detecting branch and file changes
interface GitWatcherSet {
  watchers: fs.FSWatcher[]
  debounceTimer: NodeJS.Timeout | null
}
const gitWatchers = new Map<string, GitWatcherSet>()

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')
  console.log('[Main] __dirname:', __dirname)
  console.log('[Main] Preload path:', preloadPath)
  console.log('[Main] Preload exists:', fs.existsSync(preloadPath))

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for node-pty
    },
  })

  ptyManager = new PtyManager(mainWindow)
  sshManager = new SSHManager()

  // Forward SSH status changes to renderer
  sshManager.on('status-change', (connectionId: string, connected: boolean, error?: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ssh:status-change', connectionId, connected, error)
    }
  })

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
    for (const watcherSet of gitWatchers.values()) {
      if (watcherSet.debounceTimer) {
        clearTimeout(watcherSet.debounceTimer)
      }
      for (const watcher of watcherSet.watchers) {
        watcher.close()
      }
    }
    gitWatchers.clear()
  })
}

// IPC Handlers
ipcMain.handle('pty:create', async (_event, options: { cwd?: string; shell?: string; sshConnectionId?: string; remoteCwd?: string; id?: string }) => {
  if (!ptyManager) return null

  // If this is an SSH connection, build the SSH command using SSH manager
  if (options.sshConnectionId && sshManager) {
    const sshCommand = sshManager.buildSSHCommand(options.sshConnectionId, options.remoteCwd)
    if (!sshCommand) {
      throw new Error('Failed to build SSH command - connection not found or not connected')
    }

    // Create terminal with SSH shell command
    return ptyManager.createTerminalWithCommand(sshCommand.shell, sshCommand.args, options.remoteCwd || '~', options.id)
  }

  return ptyManager.createTerminal(options)
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

ipcMain.handle('system:get-shells', async () => {
  interface ShellInfo {
    name: string
    path: string
  }

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
ipcMain.handle('project:get-scripts', async (_event, projectPath: string) => {
  interface ScriptInfo {
    name: string
    command: string
  }

  interface PackageScripts {
    packagePath: string
    packageName?: string
    scripts: ScriptInfo[]
    packageManager?: string
  }

  // Recursively find all package.json files, excluding node_modules and other common directories
  function findPackageJsonFiles(dir: string, rootDir: string, depth: number = 0): string[] {
    if (depth > 10) return [] // Prevent infinite recursion

    const results: string[] = []
    const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo']

    try {
      const packageJsonPath = path.join(dir, 'package.json')
      if (fs.existsSync(packageJsonPath)) {
        const relativePath = path.relative(rootDir, dir)
        results.push(relativePath || '.')
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
          const subdirPath = path.join(dir, entry.name)
          results.push(...findPackageJsonFiles(subdirPath, rootDir, depth + 1))
        }
      }
    } catch (err) {
      // Ignore errors for directories we can't read
    }

    return results
  }

  // Detect package manager for a given directory
  function detectPackageManager(dir: string): string {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
      return 'pnpm'
    } else if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
      return 'yarn'
    } else if (fs.existsSync(path.join(dir, 'bun.lockb'))) {
      return 'bun'
    }
    return 'npm'
  }

  try {
    const fsPath = resolvePathForFs(projectPath)
    const rootPackageJsonPath = path.join(fsPath, 'package.json')

    if (!fs.existsSync(rootPackageJsonPath)) {
      return { hasPackageJson: false, packages: [], scripts: [] }
    }

    // Find all package.json files in the project
    const packagePaths = findPackageJsonFiles(fsPath, fsPath)
    const packages: PackageScripts[] = []

    // Read and process each package.json
    for (const relativePath of packagePaths) {
      try {
        const packageDir = path.join(fsPath, relativePath)
        const packageJsonPath = path.join(packageDir, 'package.json')
        const content = fs.readFileSync(packageJsonPath, 'utf-8')
        const packageJson = JSON.parse(content)

        const scripts: ScriptInfo[] = []
        if (packageJson.scripts && typeof packageJson.scripts === 'object') {
          for (const [name, command] of Object.entries(packageJson.scripts)) {
            if (typeof command === 'string') {
              scripts.push({ name, command })
            }
          }
        }

        // Only include packages that have scripts
        if (scripts.length > 0) {
          packages.push({
            packagePath: relativePath,
            packageName: packageJson.name,
            scripts,
            packageManager: detectPackageManager(packageDir),
          })
        }
      } catch (err) {
        console.error(`Failed to read package.json at ${relativePath}:`, err)
      }
    }

    // Get legacy fields from root package.json for backward compatibility
    const rootContent = fs.readFileSync(rootPackageJsonPath, 'utf-8')
    const rootPackageJson = JSON.parse(rootContent)
    const rootScripts: ScriptInfo[] = []
    if (rootPackageJson.scripts && typeof rootPackageJson.scripts === 'object') {
      for (const [name, command] of Object.entries(rootPackageJson.scripts)) {
        if (typeof command === 'string') {
          rootScripts.push({ name, command })
        }
      }
    }

    return {
      hasPackageJson: true,
      packages,
      // Keep legacy fields for backward compatibility
      scripts: rootScripts,
      packageManager: detectPackageManager(fsPath),
      projectName: rootPackageJson.name || path.basename(projectPath),
    }
  } catch (err) {
    console.error('Failed to read package.json:', err)
    return { hasPackageJson: false, packages: [], scripts: [], error: String(err) }
  }
})

// Get git info for a directory
ipcMain.handle('git:get-info', async (_event, projectPath: string) => {
  try {
    // Check if it's a git repo
    const fsPath = resolvePathForFs(projectPath)
    const gitDir = path.join(fsPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { isGitRepo: false }
    }

    // Get current branch
    let branch = ''
    try {
      branch = execInContext('git rev-parse --abbrev-ref HEAD', projectPath).trim()
    } catch {
      // Could be detached HEAD or other issue
      try {
        // Try to get short SHA for detached HEAD
        branch = execInContext('git rev-parse --short HEAD', projectPath).trim()
        branch = `(${branch})`
      } catch {
        branch = 'unknown'
      }
    }

    // Check for uncommitted changes
    let hasChanges = false
    try {
      const status = execInContext('git status --porcelain', projectPath)
      hasChanges = status.trim().length > 0
    } catch {
      // Ignore errors
    }

    // Get ahead/behind counts
    let ahead = 0
    let behind = 0
    try {
      // Check if branch has upstream
      const upstream = execInContext('git rev-parse --abbrev-ref @{upstream}', projectPath).trim()
      if (upstream) {
        // Get ahead/behind counts: "behind\tahead"
        const counts = execInContext('git rev-list --left-right --count @{upstream}...HEAD', projectPath).trim()
        const [behindStr, aheadStr] = counts.split('\t')
        behind = parseInt(behindStr) || 0
        ahead = parseInt(aheadStr) || 0
      }
    } catch {
      // No upstream or error - leave as 0
    }

    return {
      isGitRepo: true,
      branch,
      hasChanges,
      ahead,
      behind,
    }
  } catch (err) {
    console.error('Failed to get git info:', err)
    return { isGitRepo: false, error: String(err) }
  }
})

// List git branches (local and remote)
ipcMain.handle('git:list-branches', async (_event, projectPath: string) => {
  try {
    const fsPath = resolvePathForFs(projectPath)
    const gitDir = path.join(fsPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    // Get current branch
    let currentBranch = ''
    try {
      currentBranch = execInContext('git rev-parse --abbrev-ref HEAD', projectPath).trim()
    } catch {
      currentBranch = ''
    }

    // Get local branches
    const localOutput = execInContext('git branch --format="%(refname:short)"', projectPath)
    const localBranches = localOutput
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b.length > 0)

    // Get remote branches
    const remoteOutput = execInContext('git branch -r --format="%(refname:short)"', projectPath)
    const remoteBranches = remoteOutput
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !b.includes('HEAD'))

    return {
      success: true,
      currentBranch,
      localBranches,
      remoteBranches,
    }
  } catch (err) {
    console.error('Failed to list branches:', err)
    return { success: false, error: String(err) }
  }
})

// Checkout a git branch
ipcMain.handle('git:checkout', async (_event, projectPath: string, branch: string) => {
  try {
    const fsPath = resolvePathForFs(projectPath)
    const gitDir = path.join(fsPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    // If it's a remote branch (e.g., origin/feature), create a local tracking branch
    let checkoutCmd = `git checkout ${branch}`
    if (branch.includes('/')) {
      const localName = branch.split('/').slice(1).join('/')
      // Check if local branch already exists
      try {
        execInContext(`git rev-parse --verify ${localName}`, projectPath)
        // Local branch exists, just checkout
        checkoutCmd = `git checkout ${localName}`
      } catch {
        // Local branch doesn't exist, create tracking branch
        checkoutCmd = `git checkout -b ${localName} ${branch}`
      }
    }

    execInContext(checkoutCmd, projectPath)

    return { success: true }
  } catch (err) {
    console.error('Failed to checkout branch:', err)
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { success: false, error: errorMsg }
  }
})

// Fetch from remote
ipcMain.handle('git:fetch', async (_event, projectPath: string) => {
  try {
    const fsPath = resolvePathForFs(projectPath)
    const gitDir = path.join(fsPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    execInContext('git fetch --all --prune', projectPath)

    return { success: true }
  } catch (err) {
    console.error('Failed to fetch:', err)
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { success: false, error: errorMsg }
  }
})

// Watch a project's git directory for changes (branch switches, commits, staging, file edits)
ipcMain.handle('git:watch', async (_event, projectPath: string) => {
  // Don't double-watch
  if (gitWatchers.has(projectPath)) {
    return { success: true }
  }

  const fsPath = resolvePathForFs(projectPath)
  const gitDir = path.join(fsPath, '.git')
  const headPath = path.join(gitDir, 'HEAD')
  const indexPath = path.join(gitDir, 'index')

  if (!fs.existsSync(headPath)) {
    return { success: false, error: 'Not a git repository' }
  }

  try {
    const watcherSet: GitWatcherSet = {
      watchers: [],
      debounceTimer: null,
    }

    // Debounce to avoid multiple rapid notifications
    const notifyChange = () => {
      if (watcherSet.debounceTimer) clearTimeout(watcherSet.debounceTimer)
      watcherSet.debounceTimer = setTimeout(() => {
        if (mainWindow) {
          mainWindow.webContents.send('git:changed', projectPath)
        }
      }, 200)
    }

    // Watch HEAD for branch changes
    const headWatcher = fs.watch(headPath, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        notifyChange()
      }
    })
    watcherSet.watchers.push(headWatcher)

    // Watch index for commits and staging changes
    if (fs.existsSync(indexPath)) {
      const indexWatcher = fs.watch(indexPath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          notifyChange()
        }
      })
      watcherSet.watchers.push(indexWatcher)
    }

    // Watch refs directory for pushes and fetches
    const refsDir = path.join(gitDir, 'refs')
    if (fs.existsSync(refsDir)) {
      const refsWatcher = fs.watch(refsDir, { persistent: false }, () => {
        notifyChange()
      })
      watcherSet.watchers.push(refsWatcher)
    }

    gitWatchers.set(projectPath, watcherSet)
    return { success: true }
  } catch (err) {
    console.error('Failed to watch git:', err)
    return { success: false, error: String(err) }
  }
})

// Stop watching a project's git directory
ipcMain.handle('git:unwatch', async (_event, projectPath: string) => {
  const watcherSet = gitWatchers.get(projectPath)
  if (watcherSet) {
    if (watcherSet.debounceTimer) {
      clearTimeout(watcherSet.debounceTimer)
    }
    for (const watcher of watcherSet.watchers) {
      watcher.close()
    }
    gitWatchers.delete(projectPath)
  }
  return { success: true }
})

// Get list of changed files with their status
ipcMain.handle('git:get-changed-files', async (_event, projectPath: string) => {
  try {
    const fsPath = resolvePathForFs(projectPath)
    const gitDir = path.join(fsPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    const status = execInContext('git status --porcelain', projectPath)

    interface ChangedFile {
      path: string
      status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'copied'
      staged: boolean
    }

    const files: ChangedFile[] = []

    status.split('\n').forEach((line) => {
      if (!line.trim()) return

      const stagedCode = line[0]
      const unstagedCode = line[1]
      let filePath = line.slice(3)

      // Handle renamed files (format: "R  old -> new")
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ')[1]
      }

      // Determine status based on codes
      const getStatus = (code: string): ChangedFile['status'] => {
        switch (code) {
          case 'M':
            return 'modified'
          case 'A':
            return 'added'
          case 'D':
            return 'deleted'
          case 'R':
            return 'renamed'
          case 'C':
            return 'copied'
          case '?':
            return 'untracked'
          default:
            return 'modified'
        }
      }

      // If file has staged changes, add a staged entry
      if (stagedCode !== ' ' && stagedCode !== '?') {
        const fileStatus = getStatus(stagedCode)
        files.push({
          path: filePath,
          status: fileStatus,
          staged: true,
        })
      }

      // If file has unstaged changes, add an unstaged entry
      if (unstagedCode !== ' ') {
        const fileStatus = unstagedCode === '?' ? 'untracked' : getStatus(unstagedCode)
        files.push({
          path: filePath,
          status: fileStatus,
          staged: false,
        })
      }
    })

    return { success: true, files }
  } catch (err) {
    console.error('Failed to get changed files:', err)
    return { success: false, error: String(err) }
  }
})

// Get file content from git HEAD (for diff view)
ipcMain.handle(
  'git:get-file-content',
  async (_event, projectPath: string, filePath: string) => {
    try {
      const fsPath = resolvePathForFs(projectPath)
      const gitDir = path.join(fsPath, '.git')
      if (!fs.existsSync(gitDir)) {
        return { success: false, error: 'Not a git repository' }
      }

      // Get the file content from HEAD
      const content = execInContext(`git show HEAD:${filePath}`, projectPath)

      return { success: true, content }
    } catch (err) {
      // File might be new (untracked) and not in HEAD
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (errorMsg.includes('does not exist') || errorMsg.includes('fatal:')) {
        return { success: false, error: 'File not in git history', isNew: true }
      }
      console.error('Failed to get git file content:', err)
      return { success: false, error: errorMsg }
    }
  }
)

// Stage a file (git add)
ipcMain.handle(
  'git:stage-file',
  async (_event, projectPath: string, filePath: string) => {
    try {
      execInContext(`git add "${filePath}"`, projectPath)
      return { success: true }
    } catch (err) {
      console.error('Failed to stage file:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }
)

// Unstage a file (git restore --staged)
ipcMain.handle(
  'git:unstage-file',
  async (_event, projectPath: string, filePath: string) => {
    try {
      execInContext(`git restore --staged "${filePath}"`, projectPath)
      return { success: true }
    } catch (err) {
      console.error('Failed to unstage file:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }
)

// Discard changes to a file (git restore)
ipcMain.handle(
  'git:discard-file',
  async (_event, projectPath: string, filePath: string) => {
    try {
      // For untracked files, we need to remove them
      const status = execInContext(`git status --porcelain "${filePath}"`, projectPath).trim()

      if (status.startsWith('??')) {
        // Untracked file - delete it
        const fsPath = resolvePathForFs(projectPath)
        const fullPath = path.join(fsPath, filePath)
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
        }
      } else {
        // Tracked file - restore it
        execInContext(`git restore "${filePath}"`, projectPath)
      }
      return { success: true }
    } catch (err) {
      console.error('Failed to discard file:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }
)
// Commit staged changes (git commit)
ipcMain.handle(
  'git:commit',
  async (_event, projectPath: string, message: string) => {
    try {
      const escapedMessage = message.replace(/"/g, '\\"')
      execInContext(`git commit -m "${escapedMessage}"`, projectPath)
      return { success: true }
    } catch (err) {
      console.error('Failed to commit:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }
)

// Push changes to remote (git push)
ipcMain.handle(
  'git:push',
  async (_event, projectPath: string) => {
    try {
      execInContext(`git push`, projectPath)
      return { success: true }
    } catch (err) {
      console.error('Failed to push:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }
)

// Pull changes from remote (git pull)
ipcMain.handle(
  'git:pull',
  async (_event, projectPath: string) => {
    try {
      execInContext(`git pull`, projectPath)
      return { success: true }
    } catch (err) {
      console.error('Failed to pull:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }
)

// File system IPC handlers
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    const fsPath = resolvePathForFs(filePath)
    if (!fs.existsSync(fsPath)) {
      return { success: false, error: 'File not found' }
    }

    const stats = fs.statSync(fsPath)
    if (stats.isDirectory()) {
      return { success: false, error: 'Path is a directory' }
    }

    // Limit file size to 5MB for safety
    if (stats.size > 5 * 1024 * 1024) {
      return { success: false, error: 'File too large (max 5MB)' }
    }

    const content = fs.readFileSync(fsPath, 'utf-8')
    return {
      success: true,
      content,
      size: stats.size,
      modified: stats.mtime.toISOString(),
    }
  } catch (err) {
    console.error('Failed to read file:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  try {
    const fsPath = resolvePathForFs(filePath)
    fs.writeFileSync(fsPath, content, 'utf-8')

    // Notify git watchers if this file is in a watched project
    // This ensures the changed files list updates when files are edited through the app
    for (const [projectPath, watcherSet] of gitWatchers.entries()) {
      if (filePath.startsWith(projectPath)) {
        // Debounce the notification
        if (watcherSet.debounceTimer) clearTimeout(watcherSet.debounceTimer)
        watcherSet.debounceTimer = setTimeout(() => {
          if (mainWindow) {
            mainWindow.webContents.send('git:changed', projectPath)
          }
        }, 200)
        break
      }
    }

    return { success: true }
  } catch (err) {
    console.error('Failed to write file:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:listDir', async (_event, dirPath: string) => {
  try {
    const fsPath = resolvePathForFs(dirPath)
    if (!fs.existsSync(fsPath)) {
      return { success: false, error: 'Directory not found' }
    }

    const stats = fs.statSync(fsPath)
    if (!stats.isDirectory()) {
      return { success: false, error: 'Path is not a directory' }
    }

    const entries = fs.readdirSync(fsPath, { withFileTypes: true })
    // Keep returning original path format (not UNC) for consistency with user input
    const items = entries.map((entry) => ({
      name: entry.name,
      path: path.posix.join(dirPath, entry.name), // Use posix join to preserve Linux-style paths
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }))

    // Sort: directories first, then files, alphabetically
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    return { success: true, items }
  } catch (err) {
    console.error('Failed to list directory:', err)
    return { success: false, error: String(err) }
  }
})

// Helper to wait for database to be ready
async function waitForDb(timeoutMs = 5000): Promise<boolean> {
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
ipcMain.handle('ssh:connect', async (_event, config: any) => {
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

ipcMain.handle('ssh:test', async (_event, config: any) => {
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
