import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import { PathService } from '../utils/path-service.js'
import type { SSHManager } from '../ssh-manager.js'

/**
 * Check if the git directory exists for a given project path.
 * Uses the execution context to determine how to check.
 *
 * @returns true if .git exists, false otherwise
 * @throws Error if SSH connection is required but not available
 */
async function checkGitDirExists(
  projectPath: string,
  projectId: string | undefined,
  sshManager: SSHManager | null,
  execInContextAsync: (command: string, projectPath: string, projectId?: string) => Promise<string>
): Promise<boolean> {
  const context = await PathService.getExecutionContext(projectPath, projectId, sshManager || undefined)

  switch (context) {
    case 'ssh-remote': {
      if (!projectId || !sshManager) {
        throw new Error('SSH connection required but not configured')
      }
      const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
      if (!projectMasterStatus.connected) {
        throw new Error('SSH connection not available')
      }
      try {
        const escapedPath = PathService.escapeForSSHRemote(projectPath)
        await sshManager.execViaProjectMaster(projectId, `test -d ${escapedPath}/.git`)
        return true
      } catch {
        return false
      }
    }

    case 'wsl':
    case 'local-windows':
    case 'local-unix': {
      // For WSL paths, Windows can access via UNC path (\\wsl.localhost\...)
      const fsPath = PathService.toFsPath(projectPath)
      const gitDir = PathService.join(fsPath, '.git')
      return fs.existsSync(gitDir)
    }

    default: {
      const _exhaustive: never = context
      throw new Error(`Unknown execution context: ${context}`)
    }
  }
}

interface GitWatcherSet {
  watcher: fs.FSWatcher | null  // null when using polling
  debounceTimer: NodeJS.Timeout | null
  pollingInterval?: NodeJS.Timeout  // Optional polling interval
  lastHeadContent: string
  lastIndexMtime: number
  lastLogsHeadMtime: number
  lastGitStatus?: string  // For polling: output of git status --porcelain
}

const gitWatchers = new Map<string, GitWatcherSet>()
const GIT_DEBOUNCE_MS = 500 // Debounce rapid changes (increased to allow git operations to complete)
const WSL_POLL_INTERVAL_MS = 3000 // Polling interval for WSL projects (fs.watch doesn't work on UNC paths)

/**
 * Register all git-related IPC handlers
 * @param mainWindow The main BrowserWindow instance
 * @param sshManager The SSHManager instance
 * @param execInContextAsync Function to execute commands in the appropriate context (local or SSH)
 */
export function registerGitHandlers(
  mainWindow: BrowserWindow | null,
  sshManager: SSHManager | null,
  execInContextAsync: (command: string, projectPath: string, projectId?: string) => Promise<string>
) {
  // Get git repository information
  ipcMain.handle('git:get-info', async (_event, projectPath: string, projectId?: string) => {
    try {
      // Use execution context to check for .git directory
      await PathService.getExecutionContext(projectPath, projectId, sshManager || undefined)

      try {
        const gitExists = await checkGitDirExists(projectPath, projectId, sshManager, execInContextAsync)
        if (!gitExists) {
          return { isGitRepo: false }
        }
      } catch (error) {
        return { isGitRepo: false, error: error instanceof Error ? error.message : String(error) }
      }

      // Get current branch
      let branch = ''
      try {
        branch = (await execInContextAsync('git rev-parse --abbrev-ref HEAD', projectPath, projectId)).trim()
      } catch {
        // Could be detached HEAD or other issue
        try {
          // Try to get short SHA for detached HEAD
          branch = (await execInContextAsync('git rev-parse --short HEAD', projectPath, projectId)).trim()
          branch = `(${branch})`
        } catch {
          branch = 'unknown'
        }
      }

      // Check for uncommitted changes
      let hasChanges = false
      try {
        const status = await execInContextAsync('git status --porcelain', projectPath, projectId)
        hasChanges = status.trim().length > 0
      } catch {
        // Ignore errors
      }

      // Get ahead/behind counts
      let ahead = 0
      let behind = 0
      try {
        // Check if branch has upstream
        const upstream = (await execInContextAsync('git rev-parse --abbrev-ref @{upstream}', projectPath, projectId)).trim()
        if (upstream) {
          // Get ahead/behind counts: "behind\tahead"
          const counts = (await execInContextAsync('git rev-list --left-right --count @{upstream}...HEAD', projectPath, projectId)).trim()
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
  ipcMain.handle('git:list-branches', async (_event, projectPath: string, projectId?: string) => {
    try {
      // Use execution context to check for .git directory
      await PathService.getExecutionContext(projectPath, projectId, sshManager || undefined)

      try {
        const gitExists = await checkGitDirExists(projectPath, projectId, sshManager, execInContextAsync)
        if (!gitExists) {
          return { success: false, error: 'Not a git repository' }
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }

      // Get current branch
      let currentBranch = ''
      try {
        currentBranch = (await execInContextAsync('git rev-parse --abbrev-ref HEAD', projectPath, projectId)).trim()
      } catch {
        currentBranch = ''
      }

      // Get local branches sorted by most recent commit
      const localOutput = await execInContextAsync('git branch --sort=-committerdate --format="%(refname:short)"', projectPath, projectId)
      const localBranches = localOutput
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b.length > 0)

      // Get remote branches
      const remoteOutput = await execInContextAsync('git branch -r --format="%(refname:short)"', projectPath, projectId)
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
  ipcMain.handle('git:checkout', async (_event, projectPath: string, branch: string, projectId?: string) => {
    try {
      // Use execution context to check for .git directory
      try {
        const gitExists = await checkGitDirExists(projectPath, projectId, sshManager, execInContextAsync)
        if (!gitExists) {
          return { success: false, error: 'Not a git repository' }
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }

      // If it's a remote branch (e.g., origin/feature), create a local tracking branch
      let checkoutCmd = `git checkout ${branch}`
      if (branch.includes('/')) {
        const localName = branch.split('/').slice(1).join('/')
        // Check if local branch already exists
        try {
          await execInContextAsync(`git rev-parse --verify ${localName}`, projectPath, projectId)
          // Local branch exists, just checkout
          checkoutCmd = `git checkout ${localName}`
        } catch {
          // Local branch doesn't exist, create tracking branch
          checkoutCmd = `git checkout -b ${localName} ${branch}`
        }
      }

      await execInContextAsync(checkoutCmd, projectPath, projectId)

      return { success: true }
    } catch (err) {
      console.error('Failed to checkout branch:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  })

  // Fetch from remote
  ipcMain.handle('git:fetch', async (_event, projectPath: string, projectId?: string) => {
    try {
      // Use execution context to check for .git directory
      try {
        const gitExists = await checkGitDirExists(projectPath, projectId, sshManager, execInContextAsync)
        if (!gitExists) {
          return { success: false, error: 'Not a git repository' }
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }

      await execInContextAsync('git fetch --all --prune', projectPath, projectId)

      return { success: true }
    } catch (err) {
      console.error('Failed to fetch:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  })

  // Watch a project's git directory for changes (branch switches, commits, staging, file edits)
  ipcMain.handle('git:watch', async (_event, projectPath: string, projectId?: string) => {
    // Handle projectId being passed as the string "undefined" instead of actual undefined
    const actualProjectId = projectId === 'undefined' ? undefined : projectId

    // Use PathService.getExecutionContext() to determine how to handle this path
    const context = await PathService.getExecutionContext(projectPath, actualProjectId, sshManager || undefined)

    // For SSH remote paths, we cannot watch files in real-time (they're on a remote machine)
    // Return early with an informative message
    if (context === 'ssh-remote') {
      return { success: false, error: 'Git watching is not supported for SSH projects. Use git:get-info to poll for changes.' }
    }

    // Don't double-watch
    if (gitWatchers.has(projectPath)) {
      return { success: true }
    }

    // For WSL projects, fs.watch() fails on UNC paths (EISDIR error).
    // Use polling via execInContextAsync instead.
    if (context === 'wsl') {
      try {
        // Verify it's a git repo first
        const gitExists = await checkGitDirExists(projectPath, actualProjectId, sshManager, execInContextAsync)
        if (!gitExists) {
          return { success: false, error: 'Not a git repository' }
        }

        // Get initial state for comparison
        let lastGitStatus = ''
        let lastHeadContent = ''
        try {
          lastGitStatus = (await execInContextAsync('git status --porcelain', projectPath, actualProjectId)).trim()
        } catch { /* ignore */ }
        try {
          lastHeadContent = (await execInContextAsync('git rev-parse --abbrev-ref HEAD', projectPath, actualProjectId)).trim()
        } catch { /* ignore */ }

        const pollingInterval = setInterval(async () => {
          const watcherSet = gitWatchers.get(projectPath)
          if (!watcherSet) {
            return
          }
          try {
            let hasChanged = false

            // Check branch
            try {
              const currentHead = (await execInContextAsync('git rev-parse --abbrev-ref HEAD', projectPath, actualProjectId)).trim()
              if (currentHead !== watcherSet.lastHeadContent) {
                watcherSet.lastHeadContent = currentHead
                hasChanged = true
              }
            } catch { /* ignore */ }

            // Check status (staging, working tree changes)
            try {
              const currentStatus = (await execInContextAsync('git status --porcelain', projectPath, actualProjectId)).trim()
              if (currentStatus !== watcherSet.lastGitStatus) {
                watcherSet.lastGitStatus = currentStatus
                hasChanged = true
              }
            } catch { /* ignore */ }

            if (hasChanged && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('git:changed', projectPath)
            }
          } catch (err) {
            console.error('[Git Watch] WSL polling error for', projectPath, ':', err)
          }
        }, WSL_POLL_INTERVAL_MS)

        gitWatchers.set(projectPath, {
          watcher: null,
          debounceTimer: null,
          pollingInterval,
          lastHeadContent,
          lastIndexMtime: 0,
          lastLogsHeadMtime: 0,
          lastGitStatus,
        })

        return { success: true }
      } catch (err) {
        console.error('Failed to start WSL git watching:', err)
        return { success: false, error: String(err) }
      }
    }

    // Local projects: use fs.watch() on the .git directory
    const fsPath = PathService.toFsPath(projectPath)
    const gitDir = PathService.join(fsPath, '.git')
    const headPath = PathService.join(gitDir, 'HEAD')
    const indexPath = PathService.join(gitDir, 'index')

    const gitDirExists = fs.existsSync(gitDir)
    if (!gitDirExists) {
      return { success: false, error: 'Not a git repository' }
    }

    try {
      // Read initial state to detect changes
      let lastHeadContent = ''
      let lastIndexMtime = 0
      let lastLogsHeadMtime = 0

      try {
        lastHeadContent = fs.readFileSync(headPath, 'utf-8').trim()
      } catch {
        // HEAD might not exist yet
      }

      try {
        const indexStats = fs.statSync(indexPath)
        lastIndexMtime = indexStats.mtimeMs
      } catch {
        // index might not exist yet
      }

      try {
        const logsHeadPath = PathService.join(gitDir, 'logs', 'HEAD')
        const logsHeadStats = fs.statSync(logsHeadPath)
        lastLogsHeadMtime = logsHeadStats.mtimeMs
      } catch {
        // logs/HEAD might not exist yet
      }

      // Notify function with debouncing
      const notifyChange = () => {
        const watcherSet = gitWatchers.get(projectPath)
        if (!watcherSet) {
          return
        }

        // Clear existing debounce timer
        if (watcherSet.debounceTimer) {
          clearTimeout(watcherSet.debounceTimer)
        }

        // Debounce: only notify after 300ms of no changes
        watcherSet.debounceTimer = setTimeout(async () => {
          try {
            // Check if anything actually changed
            let hasChanged = false

            // Check HEAD (branch changes)
            try {
              const currentHeadContent = fs.readFileSync(headPath, 'utf-8').trim()
              if (currentHeadContent !== watcherSet.lastHeadContent) {
                watcherSet.lastHeadContent = currentHeadContent
                hasChanged = true
              }
            } catch {
              // Ignore errors reading HEAD
            }

            // Check index (staging changes)
            try {
              const indexStats = fs.statSync(indexPath)
              if (indexStats.mtimeMs !== watcherSet.lastIndexMtime) {
                watcherSet.lastIndexMtime = indexStats.mtimeMs
                hasChanged = true
              }
            } catch {
              // Ignore errors reading index
            }

            // Check logs/HEAD (reflog - most reliable for branch changes)
            try {
              const logsHeadPath = PathService.join(gitDir, 'logs', 'HEAD')
              const logsHeadStats = fs.statSync(logsHeadPath)
              if (logsHeadStats.mtimeMs !== watcherSet.lastLogsHeadMtime) {
                watcherSet.lastLogsHeadMtime = logsHeadStats.mtimeMs
                hasChanged = true
              }
            } catch {
              // Ignore errors - logs/HEAD might not exist yet
            }

            // Only notify if something actually changed
            if (hasChanged && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('git:changed', projectPath)
            }
          } catch (err) {
            console.error('[Git Watch] Error checking for changes:', err)
          }
        }, GIT_DEBOUNCE_MS)
      }

      // Watch the .git directory for changes
      // fs.watch is non-blocking and doesn't lock files
      const watcher = fs.watch(gitDir, { recursive: false }, (eventType, filename) => {
        try {
          // We care about changes to HEAD (branch), index (staging), and refs (commits)
          if (!filename) {
            notifyChange()
            return
          }

          const fileStr = filename.toString()
          if (fileStr === 'HEAD' ||
              fileStr === 'index' ||
              fileStr.startsWith('refs') ||
              fileStr.startsWith('logs/HEAD') ||
              fileStr === 'logs' ||
              (fileStr.startsWith('logs') && fileStr.includes('HEAD'))) {
            notifyChange()
          }
        } catch (err) {
          console.error('[Git Watch] Error in watcher callback:', err)
        }
      })

      // Handle watcher errors to prevent crashes
      watcher.on('error', (err) => {
        console.error('[Git Watch] Watcher error for', projectPath, ':', err)
      })

      // Store watcher info
      gitWatchers.set(projectPath, {
        watcher,
        debounceTimer: null,
        lastHeadContent,
        lastIndexMtime,
        lastLogsHeadMtime,
      })

      return { success: true }
    } catch (err) {
      console.error('Failed to start git watching:', err)
      return { success: false, error: String(err) }
    }
  })

  // Stop watching a project's git directory
  ipcMain.handle('git:unwatch', async (_event, projectPath: string) => {
    const watcherSet = gitWatchers.get(projectPath)
    if (watcherSet) {
      if (watcherSet.watcher) {
        watcherSet.watcher.close()
      }
      if (watcherSet.debounceTimer) {
        clearTimeout(watcherSet.debounceTimer)
      }
      if (watcherSet.pollingInterval) {
        clearInterval(watcherSet.pollingInterval)
      }
      gitWatchers.delete(projectPath)
    }
    return { success: true }
  })

  // Get list of changed files with their status
  ipcMain.handle('git:get-changed-files', async (_event, projectPath: string, projectId?: string) => {
    try {
      // Use execution context to check for .git directory
      await PathService.getExecutionContext(projectPath, projectId, sshManager || undefined)

      try {
        const gitExists = await checkGitDirExists(projectPath, projectId, sshManager, execInContextAsync)
        if (!gitExists) {
          return { success: false, error: 'Not a git repository' }
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }

      const status = await execInContextAsync('git status --porcelain', projectPath, projectId)

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
    async (_event, projectPath: string, filePath: string, projectId?: string) => {
      try {
        // Use execution context to check for .git directory
        try {
          const gitExists = await checkGitDirExists(projectPath, projectId, sshManager, execInContextAsync)
          if (!gitExists) {
            return { success: false, error: 'Not a git repository' }
          }
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) }
        }

        // Get the file content from HEAD
        const normalizedFilePath = PathService.toGitPath(filePath)
        const content = await execInContextAsync(`git show HEAD:${normalizedFilePath}`, projectPath, projectId)

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
    async (_event, projectPath: string, filePath: string, projectId?: string) => {
      try {
        const normalizedFilePath = PathService.toGitPath(filePath)
        await execInContextAsync(`git add "${normalizedFilePath}"`, projectPath, projectId)
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
    async (_event, projectPath: string, filePath: string, projectId?: string) => {
      try {
        const normalizedFilePath = PathService.toGitPath(filePath)
        await execInContextAsync(`git restore --staged "${normalizedFilePath}"`, projectPath, projectId)
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
    async (_event, projectPath: string, filePath: string, projectId?: string) => {
      try {
        const normalizedFilePath = PathService.toGitPath(filePath)
        // For untracked files, we need to remove them
        const status = (await execInContextAsync(`git status --porcelain "${normalizedFilePath}"`, projectPath, projectId)).trim()

        if (status.startsWith('??')) {
          // Untracked file - delete it using execution context
          const context = await PathService.getExecutionContext(projectPath, projectId, sshManager || undefined)

          switch (context) {
            case 'ssh-remote': {
              if (!projectId || !sshManager) {
                return { success: false, error: 'SSH connection required but not configured' }
              }
              const fullPath = PathService.joinPosix(projectPath, filePath)
              const escapedFullPath = PathService.escapeForSSHRemote(fullPath)
              await sshManager.execViaProjectMaster(projectId, `rm -f ${escapedFullPath}`)
              break
            }

            case 'wsl':
            case 'local-windows':
            case 'local-unix': {
              // For WSL paths, Windows can access via UNC path
              const fsPath = PathService.toFsPath(projectPath)
              const fullPath = PathService.join(fsPath, filePath)
              if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath)
              }
              break
            }

            default: {
              const _exhaustive: never = context
              throw new Error(`Unknown execution context: ${context}`)
            }
          }
        } else {
          // Tracked file - restore it
          await execInContextAsync(`git restore "${normalizedFilePath}"`, projectPath, projectId)
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
    async (_event, projectPath: string, message: string, projectId?: string) => {
      try {
        const escapedMessage = message.replace(/"/g, '\\"')
        await execInContextAsync(`git commit -m "${escapedMessage}"`, projectPath, projectId)
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
    async (_event, projectPath: string, projectId?: string) => {
      try {
        await execInContextAsync(`git push`, projectPath, projectId)
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
    async (_event, projectPath: string, projectId?: string) => {
      try {
        await execInContextAsync(`git pull`, projectPath, projectId)
        return { success: true }
      } catch (err) {
        console.error('Failed to pull:', err)
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )
}

/**
 * Clean up all git watchers (called on app quit)
 */
export function cleanupGitWatchers() {
  for (const watcherSet of gitWatchers.values()) {
    if (watcherSet.watcher) {
      watcherSet.watcher.close()
    }
    if (watcherSet.debounceTimer) {
      clearTimeout(watcherSet.debounceTimer)
    }
    if (watcherSet.pollingInterval) {
      clearInterval(watcherSet.pollingInterval)
    }
  }
  gitWatchers.clear()
}
