import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import { PathService } from '../utils/path-service.js'
import type { SSHManager } from '../ssh-manager.js'

interface GitWatcherSet {
  watcher: fs.FSWatcher | null  // null for WSL projects using polling
  debounceTimer: NodeJS.Timeout | null
  pollingInterval?: NodeJS.Timeout  // Optional: only for WSL projects
  lastHeadContent: string
  lastIndexMtime: number
  lastLogsHeadMtime: number
}

const gitWatchers = new Map<string, GitWatcherSet>()
const GIT_DEBOUNCE_MS = 500 // Debounce rapid changes (increased to allow git operations to complete)

/**
 * Register all git-related IPC handlers
 * @param mainWindow The main BrowserWindow instance
 * @param sshManager The SSHManager instance
 * @param execInContextAsync Function to execute commands in the appropriate context (local, WSL, or SSH)
 */
export function registerGitHandlers(
  mainWindow: BrowserWindow | null,
  sshManager: SSHManager | null,
  execInContextAsync: (command: string, projectPath: string, projectId?: string) => Promise<string>
) {
  // Get git repository information
  ipcMain.handle('git:get-info', async (_event, projectPath: string, projectId?: string) => {
    console.log(`[git:get-info] Called with projectPath="${projectPath}", projectId="${projectId}"`)
    try {
      // For SSH projects, check if git repo exists remotely
      if (projectId && sshManager) {
        const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
        console.log(`[git:get-info] Project master status:`, projectMasterStatus)
        if (projectMasterStatus.connected) {
          // Check for .git directory remotely
          console.log(`[git:get-info] Checking for .git directory remotely...`)
          try {
            await sshManager.execViaProjectMaster(projectId, `test -d "${projectPath}/.git"`)
            console.log(`[git:get-info] .git directory exists remotely`)
          } catch (error) {
            console.log(`[git:get-info] .git directory does not exist remotely:`, error)
            return { isGitRepo: false }
          }
        } else {
          console.log(`[git:get-info] SSH project but not connected, skipping check`)
        }
      } else {
        // For local/WSL projects, check filesystem
        console.log(`[git:get-info] Checking local/WSL filesystem for .git`)
        const fsPath = PathService.toFsPath(projectPath)
        const gitDir = PathService.join(fsPath, '.git')
        if (!fs.existsSync(gitDir)) {
          console.log(`[git:get-info] .git directory does not exist locally at ${gitDir}`)
          return { isGitRepo: false }
        }
        console.log(`[git:get-info] .git directory exists locally`)
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
    console.log(`[git:list-branches] Called with projectPath="${projectPath}", projectId="${projectId}"`)
    try {
      // For SSH projects, check if git repo exists remotely
      if (projectId && sshManager) {
        const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
        console.log(`[git:list-branches] Project master status:`, projectMasterStatus)
        if (projectMasterStatus.connected) {
          // Check for .git directory remotely
          console.log(`[git:list-branches] Checking for .git directory remotely...`)
          try {
            await sshManager.execViaProjectMaster(projectId, `test -d "${projectPath}/.git"`)
            console.log(`[git:list-branches] .git directory exists remotely`)
          } catch (error) {
            console.log(`[git:list-branches] .git directory does not exist remotely:`, error)
            return { success: false, error: 'Not a git repository' }
          }
        }
      } else {
        // For local/WSL projects, check filesystem
        console.log(`[git:list-branches] Checking local/WSL filesystem for .git`)
        const fsPath = PathService.toFsPath(projectPath)
        const gitDir = PathService.join(fsPath, '.git')
        if (!fs.existsSync(gitDir)) {
          console.log(`[git:list-branches] .git directory does not exist locally at ${gitDir}`)
          return { success: false, error: 'Not a git repository' }
        }
        console.log(`[git:list-branches] .git directory exists locally`)
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
    console.log(`[git:checkout] Called with projectPath="${projectPath}", branch="${branch}", projectId="${projectId}"`)
    try {
      // For SSH projects, check if git repo exists remotely
      if (projectId && sshManager) {
        const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
        console.log(`[git:checkout] Project master status:`, projectMasterStatus)
        if (projectMasterStatus.connected) {
          // Check for .git directory remotely
          try {
            await sshManager.execViaProjectMaster(projectId, `test -d "${projectPath}/.git"`)
          } catch (error) {
            return { success: false, error: 'Not a git repository' }
          }
        }
      } else {
        // For local/WSL projects, check filesystem
        const fsPath = PathService.toFsPath(projectPath)
        const gitDir = PathService.join(fsPath, '.git')
        if (!fs.existsSync(gitDir)) {
          return { success: false, error: 'Not a git repository' }
        }
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
    console.log(`[git:fetch] Called with projectPath="${projectPath}", projectId="${projectId}"`)
    try {
      // For SSH projects, check if git repo exists remotely
      if (projectId && sshManager) {
        const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
        if (projectMasterStatus.connected) {
          try {
            await sshManager.execViaProjectMaster(projectId, `test -d "${projectPath}/.git"`)
          } catch (error) {
            return { success: false, error: 'Not a git repository' }
          }
        }
      } else {
        // For local/WSL projects, check filesystem
        const fsPath = PathService.toFsPath(projectPath)
        const gitDir = PathService.join(fsPath, '.git')
        if (!fs.existsSync(gitDir)) {
          return { success: false, error: 'Not a git repository' }
        }
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
    console.log(`[git:watch] Called with projectPath="${projectPath}", projectId="${projectId}"`)

    // Don't double-watch
    if (gitWatchers.has(projectPath)) {
      return { success: true }
    }

    // For SSH projects, we can't use fs.watch since files are remote
    // Skip watching for SSH projects
    if (projectId && sshManager) {
      const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
      if (projectMasterStatus.connected) {
        console.log('[Git Watch] Skipping git watch for SSH project (not supported):', projectPath)
        return { success: false, error: 'Git watching is not supported for SSH projects' }
      }
    }

    const fsPath = PathService.toFsPath(projectPath)
    const gitDir = PathService.join(fsPath, '.git')
    const headPath = PathService.join(gitDir, 'HEAD')
    const indexPath = PathService.join(gitDir, 'index')

    if (!fs.existsSync(gitDir)) {
      return { success: false, error: 'Not a git repository' }
    }

    try {
      // Read initial state to detect changes
      let lastHeadContent = ''
      let lastIndexMtime = 0
      let lastLogsHeadMtime = 0

      try {
        lastHeadContent = fs.readFileSync(headPath, 'utf-8').trim()
      } catch (err) {
        // HEAD might not exist yet
      }

      try {
        const indexStats = fs.statSync(indexPath)
        lastIndexMtime = indexStats.mtimeMs
      } catch (err) {
        // index might not exist yet
      }

      try {
        const logsHeadPath = PathService.join(gitDir, 'logs', 'HEAD')
        const logsHeadStats = fs.statSync(logsHeadPath)
        lastLogsHeadMtime = logsHeadStats.mtimeMs
      } catch (err) {
        // logs/HEAD might not exist yet
      }

      // Check if this is a WSL path - fs.watch doesn't work reliably with WSL paths on Windows
      // Use polling fallback instead
      const isWslPath = PathService.isWslPath(projectPath)
      if (isWslPath) {
        console.log('[Git Watch] WSL path detected, using polling fallback:', projectPath)

        // Set up polling interval for WSL projects
        const pollingInterval = setInterval(async () => {
          // Check if project still exists in watchers
          if (!gitWatchers.has(projectPath)) {
            clearInterval(pollingInterval)
            return
          }

          // Manually check for changes and notify
          try {
            let hasChanged = false

            // Check HEAD (branch changes)
            try {
              const currentHeadContent = fs.readFileSync(headPath, 'utf-8').trim()
              const watcherSet = gitWatchers.get(projectPath)
              if (watcherSet && currentHeadContent !== watcherSet.lastHeadContent) {
                watcherSet.lastHeadContent = currentHeadContent
                hasChanged = true
              }
            } catch (err) {
              // Ignore errors reading HEAD
            }

            // Check index mtime (staging changes)
            try {
              const indexStats = fs.statSync(indexPath)
              const watcherSet = gitWatchers.get(projectPath)
              if (watcherSet && indexStats.mtimeMs !== watcherSet.lastIndexMtime) {
                watcherSet.lastIndexMtime = indexStats.mtimeMs
                hasChanged = true
              }
            } catch (err) {
              // Ignore errors reading index
            }

            // Check logs/HEAD (reflog)
            try {
              const logsHeadPath = PathService.join(gitDir, 'logs', 'HEAD')
              const logsHeadStats = fs.statSync(logsHeadPath)
              const watcherSet = gitWatchers.get(projectPath)
              if (watcherSet && logsHeadStats.mtimeMs !== watcherSet.lastLogsHeadMtime) {
                watcherSet.lastLogsHeadMtime = logsHeadStats.mtimeMs
                hasChanged = true
              }
            } catch (err) {
              // logs/HEAD might not exist
            }

            if (hasChanged && mainWindow && !mainWindow.isDestroyed()) {
              console.log('[Git Watch] Polling detected changes for WSL project:', projectPath)
              mainWindow.webContents.send('git:changed', projectPath)
            }
          } catch (err) {
            console.error('[Git Watch] Polling error for WSL project:', err)
          }
        }, 3000) // Poll every 3 seconds

        // Store the polling interval in the GitWatcherSet
        gitWatchers.set(projectPath, {
          watcher: null, // No fs.watch for WSL
          debounceTimer: null,
          pollingInterval,
          lastHeadContent,
          lastIndexMtime,
          lastLogsHeadMtime,
        })

        console.log(`[Git Watch] Started polling for WSL project ${projectPath}`)
        return { success: true, isPolling: true }
      }

      // Notify function with debouncing
      const notifyChange = () => {
        const watcherSet = gitWatchers.get(projectPath)
        if (!watcherSet) return

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
            } catch (err) {
              // Ignore errors reading HEAD
            }

            // Check index (staging changes)
            try {
              const indexStats = fs.statSync(indexPath)
              if (indexStats.mtimeMs !== watcherSet.lastIndexMtime) {
                watcherSet.lastIndexMtime = indexStats.mtimeMs
                hasChanged = true
              }
            } catch (err) {
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
            } catch (err) {
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
        console.log('[Git Watch] Stopped polling for WSL project:', projectPath)
      }
      gitWatchers.delete(projectPath)
    }
    return { success: true }
  })

  // Get list of changed files with their status
  ipcMain.handle('git:get-changed-files', async (_event, projectPath: string, projectId?: string) => {
    console.log(`[git:get-changed-files] Called with projectPath="${projectPath}", projectId="${projectId}"`)
    try {
      // For SSH projects, check if git repo exists remotely
      if (projectId && sshManager) {
        const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
        console.log(`[git:get-changed-files] Project master status:`, projectMasterStatus)
        if (projectMasterStatus.connected) {
          // Check for .git directory remotely
          console.log(`[git:get-changed-files] Checking for .git directory remotely...`)
          try {
            await sshManager.execViaProjectMaster(projectId, `test -d "${projectPath}/.git"`)
            console.log(`[git:get-changed-files] .git directory exists remotely`)
          } catch (error) {
            console.log(`[git:get-changed-files] .git directory does not exist remotely:`, error)
            return { success: false, error: 'Not a git repository' }
          }
        }
      } else {
        // For local/WSL projects, check filesystem
        console.log(`[git:get-changed-files] Checking local/WSL filesystem for .git`)
        const fsPath = PathService.toFsPath(projectPath)
        const gitDir = PathService.join(fsPath, '.git')
        if (!fs.existsSync(gitDir)) {
          console.log(`[git:get-changed-files] .git directory does not exist locally at ${gitDir}`)
          return { success: false, error: 'Not a git repository' }
        }
        console.log(`[git:get-changed-files] .git directory exists locally`)
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
      console.log(`[git:get-file-content] Called with projectPath="${projectPath}", filePath="${filePath}", projectId="${projectId}"`)
      try {
        // For SSH projects, check if git repo exists remotely
        if (projectId && sshManager) {
          const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
          if (projectMasterStatus.connected) {
            try {
              await sshManager.execViaProjectMaster(projectId, `test -d "${projectPath}/.git"`)
            } catch (error) {
              return { success: false, error: 'Not a git repository' }
            }
          }
        } else {
          // For local/WSL projects, check filesystem
          const fsPath = PathService.toFsPath(projectPath)
          const gitDir = PathService.join(fsPath, '.git')
          if (!fs.existsSync(gitDir)) {
            return { success: false, error: 'Not a git repository' }
          }
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
      console.log(`[git:stage-file] Called with projectPath="${projectPath}", filePath="${filePath}", projectId="${projectId}"`)
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
      console.log(`[git:unstage-file] Called with projectPath="${projectPath}", filePath="${filePath}", projectId="${projectId}"`)
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
      console.log(`[git:discard-file] Called with projectPath="${projectPath}", filePath="${filePath}", projectId="${projectId}"`)
      try {
        const normalizedFilePath = PathService.toGitPath(filePath)
        // For untracked files, we need to remove them
        const status = (await execInContextAsync(`git status --porcelain "${normalizedFilePath}"`, projectPath, projectId)).trim()

        if (status.startsWith('??')) {
          // Untracked file - delete it
          if (projectId && sshManager) {
            const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
            if (projectMasterStatus.connected) {
              // Delete via SSH
              const fullPath = PathService.joinPosix(projectPath, filePath)
              await sshManager.execViaProjectMaster(projectId, `rm -f "${fullPath}"`)
            }
          } else {
            // Delete locally
            const fsPath = PathService.toFsPath(projectPath)
            const fullPath = PathService.join(fsPath, filePath)
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath)
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
      console.log(`[git:commit] Called with projectPath="${projectPath}", projectId="${projectId}"`)
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
      console.log(`[git:push] Called with projectPath="${projectPath}", projectId="${projectId}"`)
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
      console.log(`[git:pull] Called with projectPath="${projectPath}", projectId="${projectId}"`)
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
