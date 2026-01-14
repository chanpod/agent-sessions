import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PtyManager } from './pty-manager.js'
import Store from 'electron-store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Initialize electron-store for persistent storage
const store = new Store({
  name: 'agent-sessions-data',
  defaults: {},
})

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
    mainWindow?.webContents.send('update:downloaded', info)

    // Optionally show a dialog to prompt restart
    dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the app.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  // Check for updates
  autoUpdater.checkForUpdatesAndNotify()
}

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null

// Git watchers for detecting branch and file changes
interface GitWatcherSet {
  watchers: fs.FSWatcher[]
  debounceTimer: NodeJS.Timeout | null
}
const gitWatchers = new Map<string, GitWatcherSet>()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for node-pty
    },
  })

  ptyManager = new PtyManager(mainWindow)

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
ipcMain.handle('pty:create', async (_event, options: { cwd?: string; shell?: string }) => {
  return ptyManager?.createTerminal(options)
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

    // WSL - check if available
    try {
      execSync('wsl --status', { stdio: 'ignore' })
      shells.push({ name: 'WSL', path: 'wsl.exe' })
    } catch {
      // WSL not available
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

  try {
    const packageJsonPath = path.join(projectPath, 'package.json')

    if (!fs.existsSync(packageJsonPath)) {
      return { hasPackageJson: false, scripts: [] }
    }

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

    // Detect package manager
    let packageManager = 'npm'
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm'
    } else if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
      packageManager = 'yarn'
    } else if (fs.existsSync(path.join(projectPath, 'bun.lockb'))) {
      packageManager = 'bun'
    }

    return {
      hasPackageJson: true,
      scripts,
      packageManager,
      projectName: packageJson.name || path.basename(projectPath),
    }
  } catch (err) {
    console.error('Failed to read package.json:', err)
    return { hasPackageJson: false, scripts: [], error: String(err) }
  }
})

// Get git info for a directory
ipcMain.handle('git:get-info', async (_event, projectPath: string) => {
  try {
    // Check if it's a git repo
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { isGitRepo: false }
    }

    // Get current branch
    let branch = ''
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      // Could be detached HEAD or other issue
      try {
        // Try to get short SHA for detached HEAD
        branch = execSync('git rev-parse --short HEAD', {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        branch = `(${branch})`
      } catch {
        branch = 'unknown'
      }
    }

    // Check for uncommitted changes
    let hasChanges = false
    try {
      const status = execSync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      hasChanges = status.trim().length > 0
    } catch {
      // Ignore errors
    }

    return {
      isGitRepo: true,
      branch,
      hasChanges,
    }
  } catch (err) {
    console.error('Failed to get git info:', err)
    return { isGitRepo: false, error: String(err) }
  }
})

// List git branches (local and remote)
ipcMain.handle('git:list-branches', async (_event, projectPath: string) => {
  try {
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    // Get current branch
    let currentBranch = ''
    try {
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      currentBranch = ''
    }

    // Get local branches
    const localOutput = execSync('git branch --format="%(refname:short)"', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const localBranches = localOutput
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b.length > 0)

    // Get remote branches
    const remoteOutput = execSync('git branch -r --format="%(refname:short)"', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    // If it's a remote branch (e.g., origin/feature), create a local tracking branch
    let checkoutCmd = `git checkout ${branch}`
    if (branch.includes('/')) {
      const localName = branch.split('/').slice(1).join('/')
      // Check if local branch already exists
      try {
        execSync(`git rev-parse --verify ${localName}`, {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        // Local branch exists, just checkout
        checkoutCmd = `git checkout ${localName}`
      } catch {
        // Local branch doesn't exist, create tracking branch
        checkoutCmd = `git checkout -b ${localName} ${branch}`
      }
    }

    execSync(checkoutCmd, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

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
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    execSync('git fetch --all --prune', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return { success: true }
  } catch (err) {
    console.error('Failed to fetch:', err)
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { success: false, error: errorMsg }
  }
})

// Watch a project's git directory for branch changes
ipcMain.handle('git:watch', async (_event, projectPath: string) => {
  // Don't double-watch
  if (gitWatchers.has(projectPath)) {
    return { success: true }
  }

  const gitDir = path.join(projectPath, '.git')
  const headPath = path.join(gitDir, 'HEAD')

  if (!fs.existsSync(headPath)) {
    return { success: false, error: 'Not a git repository' }
  }

  try {
    const watcher = fs.watch(headPath, { persistent: false }, (eventType) => {
      if (eventType === 'change' && mainWindow) {
        // Notify renderer that git state changed
        mainWindow.webContents.send('git:changed', projectPath)
      }
    })

    gitWatchers.set(projectPath, watcher)
    return { success: true }
  } catch (err) {
    console.error('Failed to watch git:', err)
    return { success: false, error: String(err) }
  }
})

// Stop watching a project's git directory
ipcMain.handle('git:unwatch', async (_event, projectPath: string) => {
  const watcher = gitWatchers.get(projectPath)
  if (watcher) {
    watcher.close()
    gitWatchers.delete(projectPath)
  }
  return { success: true }
})

// Get list of changed files with their status
ipcMain.handle('git:get-changed-files', async (_event, projectPath: string) => {
  try {
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    const status = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

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

      // Determine if file has staged changes
      const isStaged = stagedCode !== ' ' && stagedCode !== '?'

      // Use staged status if available, otherwise use unstaged
      const statusCode = stagedCode !== ' ' && stagedCode !== '?' ? stagedCode : unstagedCode
      const fileStatus = statusCode === '?' ? 'untracked' : getStatus(statusCode)

      files.push({
        path: filePath,
        status: fileStatus,
        staged: isStaged,
      })
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
      const gitDir = path.join(projectPath, '.git')
      if (!fs.existsSync(gitDir)) {
        return { success: false, error: 'Not a git repository' }
      }

      // Get the file content from HEAD
      const content = execSync(`git show HEAD:${filePath}`, {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })

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

// File system IPC handlers
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' }
    }

    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
      return { success: false, error: 'Path is a directory' }
    }

    // Limit file size to 5MB for safety
    if (stats.size > 5 * 1024 * 1024) {
      return { success: false, error: 'File too large (max 5MB)' }
    }

    const content = fs.readFileSync(filePath, 'utf-8')
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
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    console.error('Failed to write file:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:listDir', async (_event, dirPath: string) => {
  try {
    if (!fs.existsSync(dirPath)) {
      return { success: false, error: 'Directory not found' }
    }

    const stats = fs.statSync(dirPath)
    if (!stats.isDirectory()) {
      return { success: false, error: 'Path is not a directory' }
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const items = entries.map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
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

// Storage IPC handlers (for Zustand persistence)
ipcMain.handle('store:get', async (_event, key: string) => {
  const value = store.get(key)
  console.log(`[Store] Get "${key}":`, value)
  return value
})

ipcMain.handle('store:set', async (_event, key: string, value: unknown) => {
  console.log(`[Store] Set "${key}":`, value)
  store.set(key, value)
})

ipcMain.handle('store:delete', async (_event, key: string) => {
  console.log(`[Store] Delete "${key}"`)
  store.delete(key)
})

ipcMain.handle('store:clear', async () => {
  console.log('[Store] Clear all')
  store.clear()
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

app.whenReady().then(() => {
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
