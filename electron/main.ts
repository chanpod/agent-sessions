import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PtyManager } from './pty-manager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null

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

app.whenReady().then(createWindow)

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
