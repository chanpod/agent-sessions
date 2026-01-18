/**
 * Background Claude Manager
 * Manages multiple concurrent Claude CLI sessions running in hidden terminals
 * Handles temp file conflicts, timeouts, and proper cleanup
 */

import { PtyManager } from './pty-manager.js'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { randomBytes } from 'crypto'

interface ClaudeTaskOptions {
  prompt: string
  projectPath: string
  taskId?: string
  timeout?: number // milliseconds, default 120000 (2 minutes)
  skipPermissions?: boolean
}

interface ClaudeTaskResult {
  success: boolean
  output?: string
  parsed?: any
  error?: string
  taskId: string
  duration: number
}

interface ActiveTask {
  taskId: string
  terminalId: string
  promptFile: string
  outputFile: string
  startTime: number
  timeout: number
  pollInterval: NodeJS.Timeout
  timeoutHandle: NodeJS.Timeout
  resolve: (result: ClaudeTaskResult) => void
  reject: (error: Error) => void
}

export class BackgroundClaudeManager {
  private ptyManager: PtyManager
  private activeTasks: Map<string, ActiveTask> = new Map()
  private tmpDir: string

  constructor(ptyManager: PtyManager) {
    this.ptyManager = ptyManager
    this.tmpDir = path.join(os.tmpdir(), 'claude-background-tasks')
  }

  async initialize() {
    // Create dedicated temp directory
    await fs.mkdir(this.tmpDir, { recursive: true })
    console.log(`[BackgroundClaude] Initialized with temp dir: ${this.tmpDir}`)
  }

  /**
   * Run a Claude CLI task in the background
   */
  async runTask(options: ClaudeTaskOptions): Promise<ClaudeTaskResult> {
    const taskId = options.taskId || this.generateTaskId()
    const startTime = Date.now()
    const timeout = options.timeout || 120000 // 2 minutes default

    console.log(`[BackgroundClaude] Starting task ${taskId}`)

    return new Promise(async (resolve, reject) => {
      try {
        // Create unique temp files for this task
        const promptFile = path.join(this.tmpDir, `${taskId}-prompt.txt`)
        const outputFile = path.join(this.tmpDir, `${taskId}-output.json`)

        // Write prompt to file
        await fs.writeFile(promptFile, options.prompt, 'utf-8')
        console.log(`[BackgroundClaude] Wrote prompt to ${promptFile} (${options.prompt.length} chars)`)

        // Create hidden terminal
        const terminalInfo = this.ptyManager.createTerminal({
          cwd: options.projectPath,
          hidden: true,
        })

        // Build command based on shell type
        const command = this.buildCommand(terminalInfo.shell, promptFile, outputFile, options.skipPermissions)
        console.log(`[BackgroundClaude] Running command: ${command.trim()}`)

        // Execute command
        this.ptyManager.write(terminalInfo.id, command)

        // Setup polling for output file
        const pollInterval = setInterval(async () => {
          await this.checkTaskCompletion(taskId)
        }, 500) // Check every 500ms

        // Setup timeout
        const timeoutHandle = setTimeout(() => {
          this.handleTaskTimeout(taskId)
        }, timeout)

        // Store active task
        const task: ActiveTask = {
          taskId,
          terminalId: terminalInfo.id,
          promptFile,
          outputFile,
          startTime,
          timeout,
          pollInterval,
          timeoutHandle,
          resolve,
          reject,
        }
        this.activeTasks.set(taskId, task)

      } catch (error: any) {
        console.error(`[BackgroundClaude] Failed to start task ${taskId}:`, error)
        reject(error)
      }
    })
  }

  /**
   * Run multiple Claude tasks in parallel
   */
  async runParallelTasks(taskOptions: ClaudeTaskOptions[]): Promise<ClaudeTaskResult[]> {
    console.log(`[BackgroundClaude] Starting ${taskOptions.length} parallel tasks`)
    const promises = taskOptions.map(opts => this.runTask(opts))
    return Promise.all(promises)
  }

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string) {
    const task = this.activeTasks.get(taskId)
    if (!task) return

    console.log(`[BackgroundClaude] Cancelling task ${taskId}`)

    // Kill terminal
    this.ptyManager.kill(task.terminalId)

    // Cleanup
    this.cleanupTask(taskId, {
      success: false,
      error: 'Task cancelled by user',
      taskId,
      duration: Date.now() - task.startTime,
    })
  }

  /**
   * Check if a task has completed
   */
  private async checkTaskCompletion(taskId: string) {
    const task = this.activeTasks.get(taskId)
    if (!task) return

    try {
      // Check if output file exists and has content
      const stats = await fs.stat(task.outputFile)
      if (stats.size === 0) return // File exists but empty

      // Wait a bit more to ensure file is fully written
      await new Promise(resolve => setTimeout(resolve, 100))

      // Read output
      const output = await fs.readFile(task.outputFile, 'utf-8')
      console.log(`[BackgroundClaude] Task ${taskId} completed (${output.length} chars)`)

      // Try to parse as JSON
      let parsed: any = null
      try {
        // First try: Parse entire output as JSON
        const trimmed = output.trim()
        try {
          parsed = JSON.parse(trimmed)
          console.log(`[BackgroundClaude] Successfully parsed entire output as JSON`)
        } catch {
          // Second try: Extract JSON array from output
          const arrayMatch = output.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            parsed = JSON.parse(arrayMatch[0])
            console.log(`[BackgroundClaude] Extracted JSON array from output`)
          } else {
            // Third try: Extract JSON object from output
            const objectMatch = output.match(/\{[\s\S]*\}/);
            if (objectMatch) {
              parsed = JSON.parse(objectMatch[0])
              console.log(`[BackgroundClaude] Extracted JSON object from output`)
            }
          }
        }
      } catch (parseError) {
        console.warn(`[BackgroundClaude] Failed to parse output as JSON for task ${taskId}:`, parseError)
        console.warn(`[BackgroundClaude] Output preview:`, output.substring(0, 200))
      }

      const duration = Date.now() - task.startTime
      this.cleanupTask(taskId, {
        success: true,
        output,
        parsed,
        taskId,
        duration,
      })

    } catch (error: any) {
      // File doesn't exist yet or can't be read
      if (error.code !== 'ENOENT') {
        console.error(`[BackgroundClaude] Error checking task ${taskId}:`, error)
      }
    }
  }

  /**
   * Handle task timeout
   */
  private handleTaskTimeout(taskId: string) {
    const task = this.activeTasks.get(taskId)
    if (!task) return

    console.error(`[BackgroundClaude] Task ${taskId} timed out after ${task.timeout}ms`)

    // Kill terminal
    this.ptyManager.kill(task.terminalId)

    // Cleanup with error
    this.cleanupTask(taskId, {
      success: false,
      error: `Task timed out after ${task.timeout}ms`,
      taskId,
      duration: Date.now() - task.startTime,
    })
  }

  /**
   * Cleanup task resources
   */
  private async cleanupTask(taskId: string, result: ClaudeTaskResult) {
    const task = this.activeTasks.get(taskId)
    if (!task) return

    // Clear intervals/timeouts
    clearInterval(task.pollInterval)
    clearTimeout(task.timeoutHandle)

    // Kill terminal if still running
    try {
      this.ptyManager.kill(task.terminalId)
    } catch (error) {
      // Already killed
    }

    // Delete temp files
    try {
      await fs.unlink(task.promptFile).catch(() => {})
      await fs.unlink(task.outputFile).catch(() => {})
    } catch (error) {
      console.warn(`[BackgroundClaude] Failed to delete temp files for task ${taskId}`)
    }

    // Remove from active tasks
    this.activeTasks.delete(taskId)

    // Resolve/reject promise
    if (result.success) {
      task.resolve(result)
    } else {
      task.reject(new Error(result.error || 'Unknown error'))
    }
  }

  /**
   * Build shell-specific command
   */
  private buildCommand(shell: string, promptFile: string, outputFile: string, skipPermissions: boolean = true): string {
    const shellLower = shell.toLowerCase()
    const isCmd = shellLower.includes('cmd.exe')
    const isPowerShell = shellLower.includes('powershell') || shellLower.includes('pwsh')
    const isWsl = shellLower.includes('wsl')
    const isGitBash = shellLower.includes('bash.exe') || shellLower.includes('git')

    const claudeArgs = skipPermissions ? '-p --dangerously-skip-permissions' : ''

    if (isCmd) {
      return `type "${promptFile}" | claude ${claudeArgs} > "${outputFile}"\r\n`
    } else if (isPowerShell) {
      return `Get-Content "${promptFile}" | claude ${claudeArgs} > "${outputFile}"\r\n`
    } else if (isWsl) {
      // Convert Windows paths to WSL paths
      const wslPrompt = this.toWslPath(promptFile)
      const wslOutput = this.toWslPath(outputFile)
      return `cat "${wslPrompt}" | claude ${claudeArgs} > "${wslOutput}"\n`
    } else {
      // Unix/Mac/Git Bash
      return `cat "${promptFile}" | claude ${claudeArgs} > "${outputFile}"\n`
    }
  }

  /**
   * Convert Windows path to WSL path
   */
  private toWslPath(winPath: string): string {
    return winPath
      .replace(/^([A-Z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
      .replace(/\\/g, '/')
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    const timestamp = Date.now()
    const random = randomBytes(4).toString('hex')
    return `task-${timestamp}-${random}`
  }

  /**
   * Get stats about active tasks
   */
  getStats() {
    return {
      activeTasks: this.activeTasks.size,
      tasks: Array.from(this.activeTasks.values()).map(t => ({
        taskId: t.taskId,
        duration: Date.now() - t.startTime,
        timeout: t.timeout,
      })),
    }
  }

  /**
   * Cleanup all tasks (for shutdown)
   */
  async cleanup() {
    console.log(`[BackgroundClaude] Cleaning up ${this.activeTasks.size} active tasks`)

    const taskIds = Array.from(this.activeTasks.keys())
    for (const taskId of taskIds) {
      this.cancelTask(taskId)
    }

    // Clean up temp directory
    try {
      const files = await fs.readdir(this.tmpDir)
      for (const file of files) {
        await fs.unlink(path.join(this.tmpDir, file)).catch(() => {})
      }
    } catch (error) {
      // Directory doesn't exist or can't be cleaned
    }
  }
}
