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
import { ReviewDetector } from './output-monitors/review-detector.js'
import { BackgroundClaudeManager } from './background-claude-manager.js'
import { readFileSync } from 'fs'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { generateFileId, type FileId } from './file-id-util.js'
import { registerGitHandlers, cleanupGitWatchers } from './services/git-service.js'
import { registerFsHandlers } from './services/fs-service.js'

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

// Execute a command in the appropriate context (local, WSL, or SSH)
// This is the main abstraction that routes commands correctly
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

// Execute a command asynchronously in the appropriate context (local, WSL, or SSH)
// This automatically detects and routes to the correct execution method
export async function execInContextAsync(command: string, projectPath: string, projectId?: string): Promise<string> {
  console.log(`[execInContextAsync] Called with projectId=${projectId}, command="${command}"`)

  // First check if this is an SSH project
  if (projectId && sshManager) {
    const projectMasterStatus = sshManager.getProjectMasterStatus(projectId)
    console.log(`[execInContextAsync] Project master status:`, projectMasterStatus)
    if (projectMasterStatus.connected) {
      // Execute via SSH using ControlMaster
      console.log(`[execInContextAsync] Executing via SSH for project ${projectId}: ${command}`)
      try {
        const result = await sshManager.execViaProjectMaster(projectId, `cd "${projectPath}" && ${command}`)
        console.log(`[execInContextAsync] SSH command result: ${result.substring(0, 100)}...`)
        return result
      } catch (error: any) {
        console.error(`[execInContextAsync] SSH command failed:`, error)
        throw new Error(`SSH command failed: ${error.message}`)
      }
    } else {
      console.log(`[execInContextAsync] Project ${projectId} master not connected, falling back to local/WSL`)
    }
  } else {
    console.log(`[execInContextAsync] No projectId or sshManager, using local/WSL execution`)
  }

  // Fall back to local/WSL execution
  return new Promise((resolve, reject) => {
    const wslInfo = detectWslPath(projectPath)

    let cmd: string
    let execOptions: any

    if (process.platform === 'win32' && wslInfo.isWslPath) {
      const linuxPath = wslInfo.linuxPath || projectPath
      const distroArg = wslInfo.distro ? `-d ${wslInfo.distro} ` : ''
      const escapedCmd = command.replace(/"/g, '\\"')
      cmd = `wsl ${distroArg}bash -c "cd '${linuxPath}' && ${escapedCmd}"`
      execOptions = { encoding: 'utf-8' }
    } else {
      cmd = command
      execOptions = { cwd: projectPath, encoding: 'utf-8' }
    }

    exec(cmd, execOptions, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    })
  })
}

// Resolve path for file system operations (converts WSL paths to UNC on Windows)
export function resolvePathForFs(inputPath: string): string {
  if (process.platform !== 'win32') return inputPath

  // Already a valid UNC path, return as-is
  if (inputPath.startsWith('\\\\wsl')) {
    return inputPath
  }

  // Already a Windows path (e.g., C:\...), return as-is
  if (/^[a-zA-Z]:\\/.test(inputPath)) {
    return inputPath
  }

  // Detect WSL paths and convert them
  const wslInfo = detectWslPath(inputPath)
  if (wslInfo.isWslPath && wslInfo.linuxPath) {
    const uncPath = convertToWslUncPath(wslInfo.linuxPath, wslInfo.distro)
    console.log(`[resolvePathForFs] Converted Linux path to UNC: ${inputPath} -> ${uncPath}`)
    return uncPath
  }

  // Fallback: return original path
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

// Helper to check if an update was recently dismissed
async function isUpdateDismissed(version: string): Promise<boolean> {
  await waitForDb()
  if (!dbReady) return false

  const dismissalKey = `update-dismissed-${version}`
  const dismissalData = db.get(dismissalKey) as { dismissedAt: number } | undefined

  if (!dismissalData) return false

  const dismissedAt = dismissalData.dismissedAt
  const now = Date.now()
  const twentyFourHours = 24 * 60 * 60 * 1000

  // If dismissed within the last 24 hours, don't show it
  const isDismissed = now - dismissedAt < twentyFourHours

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
  const FIVE_MINUTES = 5 * 60 * 1000
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, FIVE_MINUTES)
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
let reviewDetector: ReviewDetector | null = null
let backgroundClaude: BackgroundClaudeManager | null = null

// Track active reviews
interface ActiveReview {
  reviewId: string
  projectPath: string
  files: string[]
  classifications?: any[]
  lowRiskFiles?: string[]
  highRiskFiles?: string[]
  currentHighRiskIndex: number
}

const activeReviews = new Map<string, ActiveReview>()

// Git watching for detecting branch and file changes

async function createWindow() {
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

  // Set PTY manager reference in SSH manager (needed for creating tunnel terminals)
  sshManager.setPtyManager(ptyManager)

  // Initialize BackgroundClaudeManager
  backgroundClaude = new BackgroundClaudeManager(ptyManager)
  await backgroundClaude.initialize()
  console.log('[Main] BackgroundClaudeManager initialized')

  // Register ReviewDetector for code review functionality
  reviewDetector = new ReviewDetector()
  ptyManager.getDetectorManager().registerDetector(reviewDetector)

  // Listen for review detector events
  ptyManager.getDetectorManager().onEvent((event) => {
    if (event.type === 'review-completed') {
      const { reviewId, findings } = event.data

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:completed', {
          reviewId,
          findings: findings.map((f: any, index: number) => ({
            ...f,
            id: `${reviewId}-finding-${index}`,
          })),
        })
      }

      // Cleanup
      const review = activeReviews.get(reviewId)
      if (review) {
        ptyManager?.kill(review.terminalId)
        activeReviews.delete(reviewId)
      }

      console.log(`[Review] Completed review ${reviewId} with ${findings.length} findings`)
    } else if (event.type === 'review-failed') {
      const { reviewId, error } = event.data

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:failed', reviewId, error)
      }

      // Cleanup
      const review = activeReviews.get(reviewId)
      if (review) {
        ptyManager?.kill(review.terminalId)
        activeReviews.delete(reviewId)
      }

      console.log(`[Review] Failed review ${reviewId}: ${error}`)
    }
  })

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
// Code Review Helper Functions
// ============================================================================

/**
 * Get git diff for a file
 */
function getFileDiff(file: string, projectPath: string): string {
  try {
    return execInContext(`git diff HEAD -- "${file}"`, projectPath)
  } catch (error) {
    return ''
  }
}

/**
 * Get file contents
 */
function getFileContent(file: string, projectPath: string): string {
  try {
    const fsPath = resolvePathForFs(projectPath)
    return readFileSync(join(fsPath, file), 'utf-8')
  } catch (error) {
    return ''
  }
}

/**
 * Get imports from a file
 */
function getFileImports(file: string, projectPath: string): string {
  const content = getFileContent(file, projectPath)
  const imports = content.match(/^import .* from .*/gm) || []
  return imports.join('\n')
}

/**
 * Generate hash from file's git diff
 */
function hashFileDiff(file: string, projectPath: string): string {
  const diff = getFileDiff(file, projectPath)
  return createHash('sha256').update(diff).digest('hex')
}

/**
 * Generate per-file diff hashes for all files
 */
function generatePerFileDiffHashes(files: string[], projectPath: string): Map<string, string> {
  const hashes = new Map<string, string>()

  for (const file of files) {
    const hash = hashFileDiff(file, projectPath)
    hashes.set(file, hash)
    console.log(`[Review] Hash for ${file}: ${hash.slice(0, 8)}...`)
  }

  return hashes
}

/**
 * Build classification prompt (with FileId for exact matching)
 */
function buildClassificationPrompt(files: string[], projectPath: string): string {
  // Build file list with FileIds
  const filesWithIds = files.map(f => {
    const fileId = generateFileId(projectPath, f)
    const diff = getFileDiff(f, projectPath)
    return {
      fileId,
      path: f,
      diff
    }
  })

  const fileList = filesWithIds.map(f => `- ${f.path} (fileId: ${f.fileId})`).join('\n')
  const diffs = filesWithIds.map(f =>
    `=== ${f.path} ===\nFileId: ${f.fileId}\n${f.diff}\n`
  ).join('\n')

  return `You are analyzing code changes to classify files by risk level.

Classify each file as LOW-RISK or HIGH-RISK based on these criteria:

LOW-RISK:
- Configuration files, docs, type definitions, formatting changes
- Comments, simple refactoring, test files

HIGH-RISK (potential bugs/security):
- Business logic, auth, database queries, API handlers
- Security code, payment processing, user data handling

Files to classify:
${fileList}

Diffs:
${diffs}

Output ONLY valid JSON with EXACTLY these fields (including fileId):
[
  {
    "fileId": "project:src/config.ts",
    "file": "src/config.ts",
    "riskLevel": "low-risk",
    "reasoning": "Only config values changed"
  }
]

CRITICAL: You MUST include the exact fileId from the input for each file in your response!`
}

/**
 * Build low-risk review prompt (with FileId for exact matching)
 */
function buildLowRiskPrompt(files: string[], projectPath: string): string {
  // Build file list with FileIds
  const filesWithIds = files.map(f => {
    const fileId = generateFileId(projectPath, f)
    const diff = getFileDiff(f, projectPath)
    return {
      fileId,
      path: f,
      diff
    }
  })

  const filesWithDiffs = filesWithIds.map(f =>
    `=== ${f.path} ===\nFileId: ${f.fileId}\n${f.diff}\n`
  ).join('\n')

  return `You are reviewing LOW-RISK code changes for simple issues.

Focus ONLY on:
- Typos, unused imports/variables
- Console.log statements, commented code
- Missing null checks, simple style issues

DO NOT report: Complex logic, architecture, pre-existing issues

Files:
${filesWithDiffs}

Output ONLY valid JSON array with fileId AND codeChange fields:
[
  {
    "fileId": "project:src/utils.ts",
    "file": "src/utils.ts",
    "line": 42,
    "severity": "suggestion",
    "category": "Code Quality",
    "title": "Unused import",
    "description": "Import 'fs' is never used",
    "suggestion": "Remove unused import",
    "codeChange": {
      "oldCode": "import fs from 'fs'",
      "newCode": ""
    }
  }
]

CRITICAL: You MUST include the exact fileId from the input for each finding!`
}

/**
 * Build sub-agent reviewer prompt (with FileId for exact matching)
 */
function buildSubAgentPrompt(file: string, projectPath: string, agentNumber: number, riskReasoning: string): string {
  const fileId = generateFileId(projectPath, file)
  const diff = getFileDiff(file, projectPath)
  const content = getFileContent(file, projectPath)
  const imports = getFileImports(file, projectPath)

  return `You are REVIEWER-${agentNumber} conducting independent review of HIGH-RISK file.

⚠️ ONLY analyze MODIFIED code (in the diff)
⚠️ DO NOT report issues in unchanged code

File: ${file}
FileId: ${fileId}
Risk reason: ${riskReasoning}

=== CHANGES (diff) ===
${diff}

=== FULL FILE ===
${content}

=== IMPORTS ===
${imports}

Check for: Logic errors, security flaws, data integrity issues, error handling, breaking changes

Output ONLY valid JSON:
[
  {
    "file": "${file}",
    "line": 42,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection",
    "description": "User input concatenated in query",
    "suggestion": "Use parameterized queries"
  }
]`
}

/**
 * Build coordinator prompt
 */
function buildCoordinatorPrompt(subAgentReviews: any[], file: string, projectPath: string): string {
  const diff = getFileDiff(file, projectPath)
  const content = getFileContent(file, projectPath)
  const reviewsJson = JSON.stringify(subAgentReviews, null, 2)

  return `You are coordinating findings from 3 independent reviewers.

Tasks:
1. Deduplicate similar findings
2. Consolidate descriptions
3. Calculate confidence (3 agents=1.0, 2=0.85, 1=0.65)
4. Filter out false positives
5. Generate EXACT code fixes with old/new code snippets

File: ${file}

Diff:
${diff}

Full file content:
${content}

Sub-agent reviews:
${reviewsJson}

For EACH finding, you MUST provide:
- "aiPrompt": A clear prompt the user can copy to ask AI to fix this issue
- "codeChange": Object with "oldCode" and "newCode" for automatic fixing (if applicable)

Output consolidated findings in this EXACT format:
[
  {
    "file": "${file}",
    "line": 42,
    "endLine": 45,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection vulnerability",
    "description": "User input is directly concatenated into SQL query without sanitization",
    "suggestion": "Use parameterized queries to prevent SQL injection",
    "aiPrompt": "Fix the SQL injection vulnerability on line 42 by converting the string concatenation to use parameterized queries with prepared statements",
    "codeChange": {
      "oldCode": "const query = 'SELECT * FROM users WHERE id = ' + userId",
      "newCode": "const query = 'SELECT * FROM users WHERE id = ?'\\nconst results = await db.execute(query, [userId])"
    },
    "sourceAgents": ["reviewer-1", "reviewer-2", "reviewer-3"],
    "confidence": 1.0
  }
]

IMPORTANT:
- Always include "aiPrompt" for every finding
- Only include "codeChange" if you can provide exact old/new code snippets
- "oldCode" must match EXACTLY what's in the file (including whitespace)
- "newCode" should be the complete fixed version`
}

/**
 * Build accuracy checker prompt
 */
function buildAccuracyPrompt(finding: any, file: string, projectPath: string): string {
  const diff = getFileDiff(file, projectPath)
  const content = getFileContent(file, projectPath)
  const findingJson = JSON.stringify(finding, null, 2)

  return `You are verifying the accuracy of a code review finding.

Verify:
1. Issue exists in MODIFIED code (not pre-existing)
2. Severity is appropriate
3. Suggested fix is valid

Finding:
${findingJson}

File: ${file}

Diff:
${diff}

Full file:
${content}

Output verification:
{
  "findingId": "${finding.id}",
  "isAccurate": true,
  "confidence": 0.95,
  "reasoning": "Confirmed issue in modified code..."
}`
}

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('pty:create', async (_event, options: { cwd?: string; shell?: string; sshConnectionId?: string; remoteCwd?: string; id?: string; projectId?: string }) => {
  if (!ptyManager) return null

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

ipcMain.handle('pty:create-with-command', async (_event, shell: string, args: string[], displayCwd: string, hidden?: boolean) => {
  if (!ptyManager) return null
  return ptyManager.createTerminalWithCommand(shell, args, displayCwd, undefined, hidden)
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
ipcMain.handle('project:get-scripts', async (_event, projectPath: string, projectId?: string) => {
  console.log(`[project:get-scripts] Called with projectPath="${projectPath}", projectId="${projectId}"`)

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
  async function findPackageJsonFiles(dir: string, rootDir: string, depth: number = 0): Promise<string[]> {
    if (depth > 10) return [] // Prevent infinite recursion

    const results: string[] = []
    const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo']

    try {
      const packageJsonPath = path.join(dir, 'package.json')
      try {
        await fs.promises.access(packageJsonPath)
        const relativePath = path.relative(rootDir, dir)
        results.push(relativePath || '.')
      } catch {
        // package.json doesn't exist in this directory
      }

      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      // Process subdirectories in parallel for better performance
      const subdirPromises: Promise<string[]>[] = []
      for (const entry of entries) {
        if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
          const subdirPath = path.join(dir, entry.name)
          subdirPromises.push(findPackageJsonFiles(subdirPath, rootDir, depth + 1))
        }
      }
      const subdirResults = await Promise.all(subdirPromises)
      for (const subResults of subdirResults) {
        results.push(...subResults)
      }
    } catch (err) {
      // Ignore errors for directories we can't read
    }

    return results
  }

  // Detect package manager for a given directory
  async function detectPackageManager(dir: string): Promise<string> {
    const checkFile = async (filename: string): Promise<boolean> => {
      try {
        await fs.promises.access(path.join(dir, filename))
        return true
      } catch {
        return false
      }
    }

    // Check all lock files in parallel
    const [hasPnpm, hasYarn, hasBun] = await Promise.all([
      checkFile('pnpm-lock.yaml'),
      checkFile('yarn.lock'),
      checkFile('bun.lockb'),
    ])

    if (hasPnpm) return 'pnpm'
    if (hasYarn) return 'yarn'
    if (hasBun) return 'bun'
    return 'npm'
  }

  try {
    // For SSH projects, use remote execution
    if (projectId && sshManager) {
      const projectMasterStatus = sshManager.getProjectMasterStatus(projectId)
      console.log(`[project:get-scripts] SSH manager exists, project master status:`, projectMasterStatus)

      if (projectMasterStatus.connected) {
        console.log(`[project:get-scripts] Using SSH execution for project ${projectId}`)

        // Create a Node.js script to find and read package.json files remotely
        // This is much simpler and more reliable than using bash
        const findPackagesScript = `node -e "
const fs = require('fs');
const path = require('path');

const rootDir = '${projectPath}';
const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo'];

function findPackageJsonFiles(dir, depth = 0) {
  if (depth > 10) return [];
  const results = [];

  try {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      results.push(dir);
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
        results.push(...findPackageJsonFiles(path.join(dir, entry.name), depth + 1));
      }
    }
  } catch (err) {
    // Ignore errors
  }

  return results;
}

function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
  return 'npm';
}

try {
  if (!fs.existsSync(path.join(rootDir, 'package.json'))) {
    console.log(JSON.stringify({ hasPackageJson: false, packages: [], scripts: [] }));
    process.exit(0);
  }

  const packageDirs = findPackageJsonFiles(rootDir);
  const packages = [];

  for (const pkgDir of packageDirs) {
    try {
      const pkgPath = path.join(pkgDir, 'package.json');
      const content = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(content);

      if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
        const scripts = Object.entries(pkg.scripts).map(([name, command]) => ({ name, command }));
        const relativePath = path.relative(rootDir, pkgDir) || '.';

        packages.push({
          packagePath: relativePath,
          packageName: pkg.name || '',
          scripts: scripts,
          packageManager: detectPackageManager(pkgDir)
        });
      }
    } catch (err) {
      // Ignore individual package errors
    }
  }

  console.log(JSON.stringify({ hasPackageJson: true, packages, scripts: [] }));
} catch (err) {
  console.error(JSON.stringify({ hasPackageJson: false, packages: [], scripts: [], error: err.message }));
  process.exit(1);
}
"`

        try {
          console.log(`[project:get-scripts] Executing remote Node.js script...`)
          const result = await sshManager.execViaProjectMaster(projectId, findPackagesScript)
          console.log(`[project:get-scripts] Remote script output:`, result.substring(0, 200))
          const parsed = JSON.parse(result.trim())
          console.log(`[project:get-scripts] Parsed result:`, parsed)
          return parsed
        } catch (error: any) {
          console.error('[project:get-scripts] SSH execution failed:', error)
          return { hasPackageJson: false, packages: [], scripts: [], error: error.message }
        }
      } else {
        console.log(`[project:get-scripts] SSH project master not connected, falling back to local`)
      }
    }

    // For local/WSL projects, use filesystem operations
    const fsPath = resolvePathForFs(projectPath)
    const rootPackageJsonPath = path.join(fsPath, 'package.json')

    // Check if root package.json exists
    try {
      await fs.promises.access(rootPackageJsonPath)
    } catch {
      return { hasPackageJson: false, packages: [], scripts: [] }
    }

    // Find all package.json files in the project (async)
    const packagePaths = await findPackageJsonFiles(fsPath, fsPath)
    const packages: PackageScripts[] = []

    // Read and process each package.json in parallel
    const packagePromises = packagePaths.map(async (relativePath) => {
      try {
        const packageDir = path.join(fsPath, relativePath)
        const packageJsonPath = path.join(packageDir, 'package.json')
        const content = await fs.promises.readFile(packageJsonPath, 'utf-8')
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
          return {
            packagePath: relativePath,
            packageName: packageJson.name,
            scripts,
            packageManager: await detectPackageManager(packageDir),
          }
        }
        return null
      } catch (err) {
        console.error(`Failed to read package.json at ${relativePath}:`, err)
        return null
      }
    })

    const packageResults = await Promise.all(packagePromises)
    for (const pkg of packageResults) {
      if (pkg) packages.push(pkg)
    }

    // Get legacy fields from root package.json for backward compatibility
    const rootContent = await fs.promises.readFile(rootPackageJsonPath, 'utf-8')
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
      packageManager: await detectPackageManager(fsPath),
      projectName: rootPackageJson.name || path.basename(projectPath),
    }
  } catch (err) {
    console.error('Failed to read package.json:', err)
    return { hasPackageJson: false, packages: [], scripts: [], error: String(err) }
  }
})

// Get git info for a directory (supports local, WSL, and SSH projects)



/**
 * Generate per-file diff hashes
 */
ipcMain.handle('review:generateFileHashes', async (_event, projectPath: string, files: string[]) => {
  try {
    const hashes = generatePerFileDiffHashes(files, projectPath)
    // Convert Map to object for IPC
    const hashesObj: Record<string, string> = {}
    hashes.forEach((hash, file) => {
      hashesObj[file] = hash
    })
    return { success: true, hashes: hashesObj }
  } catch (error: any) {
    console.error('[Review] Failed to generate file hashes:', error)
    return { success: false, error: error.message }
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


// Helper function to extract findings from Claude output
function extractFindingsFromOutput(output: string): any[] {
  try {
    // Try to parse as JSON directly
    const trimmed = output.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return JSON.parse(trimmed)
    }

    // Try to extract from markdown code block
    const codeBlockMatch = output.match(/```json\s*\n([\s\S]*?)\n```/)
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1])
    }

    // Try to find any JSON array in the output
    const arrayMatch = output.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0])
    }

    // No valid JSON found, return empty array
    console.warn('[Review] No valid JSON found in output')
    return []
  } catch (e) {
    console.error('[Review] Failed to parse output as JSON:', e)
    console.error('[Review] Output was:', output.slice(0, 500))
    return []
  }
}

// ============================================================================
// Review IPC Handlers - Multi-Stage with Multi-Agent Verification
// ============================================================================

/**
 * Stage 1: Start review with classification
 */
ipcMain.handle('review:start', async (_event, projectPath: string, files: string[], providedReviewId?: string) => {
  const reviewId = providedReviewId || `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  console.log(`[Review] Starting review ${reviewId} for ${files.length} files`)

  try {
    // Store review
    activeReviews.set(reviewId, {
      reviewId,
      projectPath,
      files,
      currentHighRiskIndex: 0
    })

    // Run classification
    const classificationPrompt = buildClassificationPrompt(files, projectPath)

    const result = await backgroundClaude!.runTask({
      taskId: `${reviewId}-classify`,
      prompt: classificationPrompt,
      projectPath,
      timeout: 60000 // 1 minute
    })

    console.log(`[Review] Classification result:`, {
      success: result.success,
      hasParsed: !!result.parsed,
      outputLength: result.output?.length,
      error: result.error
    })

    if (result.success && result.parsed) {
      const classifications = result.parsed

      console.log(`[Review] Sending ${classifications.length} classifications to frontend`)

      // Ensure all classifications have fileId
      const classificationsWithFileId = classifications.map((c: any) => ({
        ...c,
        fileId: c.fileId || generateFileId(projectPath, c.file) // Fallback if AI didn't include it
      }))

      // Send to frontend
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:classifications', {
          reviewId,
          classifications: classificationsWithFileId
        })
      }

      // Update active review
      const review = activeReviews.get(reviewId)
      if (review) {
        review.classifications = classificationsWithFileId
      }

      return { success: true, reviewId }
    } else {
      // Log the raw output to help debug
      console.error(`[Review] Classification failed to parse. Raw output:`, result.output?.substring(0, 500))
      throw new Error('Classification failed: Could not parse JSON from Claude output')
    }
  } catch (error: any) {
    console.error(`[Review] Failed to start review:`, error)
    return { success: false, error: error.message }
  }
})

/**
 * Stage 2: User confirmed classifications, start low-risk review
 */
ipcMain.handle('review:start-low-risk', async (_event, reviewId: string, lowRiskFiles: string[], highRiskFiles: string[]) => {
  const review = activeReviews.get(reviewId)
  if (!review) {
    return { success: false, error: 'Review not found' }
  }

  console.log(`[Review] Starting low-risk review: ${lowRiskFiles.length} files`)

  review.lowRiskFiles = lowRiskFiles
  review.highRiskFiles = highRiskFiles

  // Handle case where all files were cached (0 files to review)
  if (lowRiskFiles.length === 0) {
    console.log('[Review] No files to review (all cached), sending empty findings')
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      mainWindow.webContents.send('review:low-risk-findings', {
        reviewId,
        findings: []
      })
    }
    return { success: true }
  }

  try {
    // Split files into batches for parallel review
    const batchSize = 5
    const batches: string[][] = []
    for (let i = 0; i < lowRiskFiles.length; i += batchSize) {
      batches.push(lowRiskFiles.slice(i, i + batchSize))
    }

    // Run batches in parallel
    const batchPromises = batches.map((batch, idx) => {
      const prompt = buildLowRiskPrompt(batch, review.projectPath)
      return backgroundClaude!.runTask({
        taskId: `${reviewId}-batch-${idx}`,
        prompt,
        projectPath: review.projectPath,
        timeout: 90000 // 1.5 minutes per batch
      })
    })

    const results = await Promise.all(batchPromises)

    // Aggregate findings
    const allFindings: any[] = []
    for (const result of results) {
      if (result.success && result.parsed) {
        allFindings.push(...result.parsed)
      }
    }

    // Add unique IDs and ensure fileId is present
    const findingsWithIds = allFindings.map((f, idx) => ({
      ...f,
      id: `${reviewId}-low-risk-${idx}`,
      fileId: f.fileId || generateFileId(review.projectPath, f.file) // Fallback if AI didn't include it
    }))

    // Send to frontend
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:low-risk-findings', {
        reviewId,
        findings: findingsWithIds
      })
    }

    return { success: true, findingCount: findingsWithIds.length }
  } catch (error: any) {
    console.error(`[Review] Low-risk review failed:`, error)

    // Send failure event to frontend
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:failed', reviewId, error.message || 'Low-risk review failed')
    }

    return { success: false, error: error.message }
  }
})

/**
 * Stage 3: Review next high-risk file with multi-agent verification
 */
ipcMain.handle('review:review-high-risk-file', async (_event, reviewId: string) => {
  const review = activeReviews.get(reviewId)
  if (!review || !review.highRiskFiles || !review.classifications) {
    return { success: false, error: 'Review not found or not ready' }
  }

  const fileIndex = review.currentHighRiskIndex
  if (fileIndex >= review.highRiskFiles.length) {
    return { success: true, complete: true }
  }

  const file = review.highRiskFiles[fileIndex]
  console.log(`[Review] Reviewing high-risk file ${fileIndex + 1}/${review.highRiskFiles.length}: ${file}`)

  try {
    // Get classification reasoning
    const classification = review.classifications.find((c: any) => c.file === file)
    const riskReasoning = classification?.reasoning || 'High-risk file'

    // Update status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:high-risk-status', {
        reviewId,
        file,
        status: 'reviewing'
      })
    }

    // Step 1: Run 3 sub-agents in parallel
    const subAgentPromises = [1, 2, 3].map(agentNum => {
      const prompt = buildSubAgentPrompt(file, review.projectPath, agentNum, riskReasoning)
      return backgroundClaude!.runTask({
        taskId: `${reviewId}-file${fileIndex}-agent${agentNum}`,
        prompt,
        projectPath: review.projectPath,
        timeout: 120000 // 2 minutes per agent
      })
    })

    const subAgentResults = await Promise.all(subAgentPromises)

    // Extract findings from each agent
    const subAgentReviews = subAgentResults.map((result, idx) => ({
      agentId: `reviewer-${idx + 1}`,
      findings: result.success && result.parsed ? result.parsed : [],
      timestamp: Date.now()
    }))

    // Update status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:high-risk-status', {
        reviewId,
        file,
        status: 'coordinating'
      })
    }

    // Step 2: Coordinator consolidates findings
    const coordinatorPrompt = buildCoordinatorPrompt(subAgentReviews, file, review.projectPath)
    const coordinatorResult = await backgroundClaude!.runTask({
      taskId: `${reviewId}-file${fileIndex}-coordinator`,
      prompt: coordinatorPrompt,
      projectPath: review.projectPath,
      timeout: 60000
    })

    if (!coordinatorResult.success || !coordinatorResult.parsed) {
      throw new Error('Coordinator failed')
    }

    const consolidatedFindings = coordinatorResult.parsed

    // Update status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:high-risk-status', {
        reviewId,
        file,
        status: 'verifying'
      })
    }

    // Step 3: Accuracy checkers verify each finding
    const verificationPromises = consolidatedFindings.map((finding: any, idx: number) => {
      finding.id = `${reviewId}-highrisk-${fileIndex}-${idx}`
      const prompt = buildAccuracyPrompt(finding, file, review.projectPath)
      return backgroundClaude!.runTask({
        taskId: `${reviewId}-file${fileIndex}-verify-${idx}`,
        prompt,
        projectPath: review.projectPath,
        timeout: 60000
      })
    })

    const verificationResults = await Promise.all(verificationPromises)

    // Filter to verified findings
    const verifiedFindings = consolidatedFindings
      .map((finding: any, idx: number) => {
        const verification = verificationResults[idx]
        const verificationData = verification.success && verification.parsed ? verification.parsed : null

        return {
          ...finding,
          verificationStatus: verificationData?.isAccurate ? 'verified' : 'rejected',
          verificationResult: verificationData,
          confidence: verificationData?.confidence || 0
        }
      })
      .filter((f: any) => f.verificationStatus === 'verified')

    // Update status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:high-risk-status', {
        reviewId,
        file,
        status: 'complete'
      })

      // Send findings
      mainWindow.webContents.send('review:high-risk-findings', {
        reviewId,
        file,
        findings: verifiedFindings
      })
    }

    // Advance to next file
    review.currentHighRiskIndex++

    return {
      success: true,
      complete: review.currentHighRiskIndex >= review.highRiskFiles.length,
      findingCount: verifiedFindings.length
    }
  } catch (error: any) {
    console.error(`[Review] High-risk file review failed:`, error)

    // Send failure event to frontend
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:failed', reviewId, error.message || 'High-risk file review failed')
    }

    return { success: false, error: error.message }
  }
})

/**
 * Cancel review
 */
ipcMain.handle('review:cancel', async (_event, reviewId: string) => {
  console.log(`[Review] Cancelling review ${reviewId}`)

  const review = activeReviews.get(reviewId)

  // Cancel all active background tasks for this review
  if (backgroundClaude) {
    const stats = backgroundClaude.getStats()
    console.log(`[Review] Active tasks before cancel:`, stats.activeTasks)

    // Cancel all tasks related to this review
    for (const task of stats.tasks) {
      if (task.taskId.startsWith(reviewId)) {
        console.log(`[Review] Cancelling task: ${task.taskId}`)
        backgroundClaude.cancelTask(task.taskId)
      }
    }
  }

  // Kill any terminals associated with this review
  if (review?.terminalId && ptyManager) {
    console.log(`[Review] Killing terminal: ${review.terminalId}`)
    try {
      ptyManager.kill(review.terminalId)
    } catch (error) {
      console.error(`[Review] Failed to kill terminal:`, error)
    }
  }

  // Remove from active reviews
  activeReviews.delete(reviewId)
  console.log(`[Review] Review ${reviewId} cancelled and cleaned up`)

  return { success: true }
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
