import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { DetectorManager } from './output-monitors/detector-manager'
import { ServerDetector } from './output-monitors/server-detector'

const execAsync = promisify(exec)

export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  title: string
  createdAt: number
}

interface TerminalInstance {
  info: TerminalInfo
  ptyProcess: pty.IPty
  processMonitorInterval?: NodeJS.Timeout
  lastLogTime?: number
}

// WSL path detection for pty-manager
function isWslPath(inputPath: string): boolean {
  if (process.platform !== 'win32') return false
  // Check for UNC WSL paths or Linux-style paths
  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(inputPath) ||
    (inputPath.startsWith('/') && !inputPath.startsWith('//'))
}

function getDefaultWslDistro(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const output = execSync('wsl -l -q', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 0)
    return lines[0] || null
  } catch {
    return null
  }
}

function getLinuxPathFromWslPath(inputPath: string): string {
  // Extract Linux path from UNC path
  const uncMatch = inputPath.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(.*)$/i)
  if (uncMatch) {
    return uncMatch[1].replace(/\\/g, '/') || '/'
  }
  // Already a Linux-style path
  return inputPath
}

/**
 * Check if a process has child processes running (async, non-blocking)
 * Returns true if there ARE child processes (terminal is busy)
 * Returns false if there are NO child processes (terminal is idle at shell prompt)
 */
async function hasChildProcesses(pid: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      // Use WMIC to check for child processes on Windows
      const { stdout } = await execAsync(`wmic process where (ParentProcessId=${pid}) get ProcessId`, {
        timeout: 2000,
        windowsHide: true,
      })
      // Parse output - if there are children, there will be PIDs listed
      const lines = stdout.split('\n').map(l => l.trim()).filter(l => l && l !== 'ProcessId')
      return lines.length > 0
    } else {
      // On Unix, use ps to check for child processes
      const { stdout } = await execAsync(`ps -o pid= --ppid ${pid}`, {
        timeout: 2000,
      })
      return stdout.trim().length > 0
    }
  } catch (error) {
    // If command fails, assume there are children (safer to not trigger false positives)
    return true
  }
}

export class PtyManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow
  private detectorManager: DetectorManager

  constructor(window: BrowserWindow) {
    this.window = window

    // Initialize output monitoring
    this.detectorManager = new DetectorManager()
    this.detectorManager.registerDetector(new ServerDetector())

    // Forward detected events to renderer
    this.detectorManager.onEvent((event) => {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send('detector:event', event)
      }
    })
  }

  /**
   * Start monitoring process changes for a terminal
   * Detects when a foreground process exits back to the shell (no child processes)
   * Uses async non-blocking calls and longer intervals for performance
   */
  private startProcessMonitoring(id: string, ptyProcess: pty.IPty): void {
    console.log(`[PtyManager] Starting process monitoring for terminal ${id}, PID: ${ptyProcess.pid}`)
    const instance = this.terminals.get(id)
    if (!instance) {
      console.error(`[PtyManager] Cannot start monitoring - instance not found for terminal ${id}`)
      return
    }

    // Track if there were children in the last check
    let hadChildrenLastCheck: boolean | undefined = undefined
    let checkInProgress = false

    // Poll every 3 seconds (longer interval to reduce load)
    instance.processMonitorInterval = setInterval(async () => {
      // Skip if previous check still running
      if (checkInProgress) return

      try {
        checkInProgress = true
        const hasChildren = await hasChildProcesses(ptyProcess.pid)

        // Log status periodically for debugging (every 15 seconds)
        const now = Date.now()
        if (!instance.lastLogTime || now - instance.lastLogTime > 15000) {
          console.log(`[PtyManager] Terminal ${id} has child processes: ${hasChildren}`)
          instance.lastLogTime = now
        }

        // Detect transition from "has children" to "no children" (process finished)
        if (hadChildrenLastCheck === true && hasChildren === false) {
          console.log(`[PtyManager] Process finished in terminal ${id} - no more child processes`)
          // Notify detectors that a process has finished
          this.detectorManager.handleTerminalExit(id, 0)
        }

        hadChildrenLastCheck = hasChildren
      } catch (error) {
        console.error(`[PtyManager] Error monitoring process for terminal ${id}:`, error)
      } finally {
        checkInProgress = false
      }
    }, 3000) // Check every 3 seconds instead of every second
  }

  /**
   * Create terminal with custom command (used for SSH)
   */
  createTerminalWithCommand(shell: string, shellArgs: string[], displayCwd: string, id?: string): TerminalInfo {
    const terminalId = id || randomUUID()

    // Clean environment for SSH - remove SSH_ASKPASS and related vars
    const cleanEnv = { ...process.env }
    delete cleanEnv.SSH_ASKPASS
    delete cleanEnv.SSH_ASKPASS_REQUIRE
    delete cleanEnv.DISPLAY // Force SSH to use terminal prompts, not GUI

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: {
        ...cleanEnv,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    const info: TerminalInfo = {
      id: terminalId,
      pid: ptyProcess.pid,
      shell: `${shell} ${shellArgs.slice(0, 3).join(' ')}...`, // Show abbreviated command
      cwd: displayCwd,
      title: 'SSH',
      createdAt: Date.now(),
    }

    const instance: TerminalInstance = { info, ptyProcess }
    this.terminals.set(terminalId, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      // Process through detectors
      this.detectorManager.processOutput(terminalId, data)

      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', terminalId, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Stop process monitoring
      if (instance.processMonitorInterval) {
        clearInterval(instance.processMonitorInterval)
      }

      // Notify detectors of exit
      this.detectorManager.handleTerminalExit(terminalId, exitCode)

      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:exit', terminalId, exitCode)
      }
      this.terminals.delete(terminalId)
    })

    // Start monitoring for process changes
    this.startProcessMonitoring(terminalId, ptyProcess)

    return info
  }

  createTerminal(options: { cwd?: string; shell?: string; id?: string } = {}): TerminalInfo {
    const id = options.id || randomUUID()
    let shell = options.shell || this.getDefaultShell()
    const originalCwd = options.cwd || process.cwd()
    let effectiveCwd = originalCwd
    let shellArgs: string[] = []

    // Handle WSL paths on Windows
    if (process.platform === 'win32' && originalCwd && isWslPath(originalCwd)) {
      const linuxPath = getLinuxPathFromWslPath(originalCwd)
      const distro = getDefaultWslDistro()

      // If shell is not already WSL, switch to WSL
      if (!shell.includes('wsl')) {
        shell = 'wsl.exe'
        if (distro) {
          shellArgs = ['-d', distro, '--cd', linuxPath]
        } else {
          shellArgs = ['--cd', linuxPath]
        }
      }
      // For file operations, use Windows cwd (we'll cd in WSL)
      effectiveCwd = process.cwd()
    }

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: effectiveCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    const info: TerminalInfo = {
      id,
      pid: ptyProcess.pid,
      shell,
      cwd: originalCwd, // Store original cwd for display
      title: shell.split('/').pop() || shell,
      createdAt: Date.now(),
    }

    const instance: TerminalInstance = { info, ptyProcess }
    this.terminals.set(id, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      // Process through detectors
      this.detectorManager.processOutput(id, data)

      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Stop process monitoring
      if (instance.processMonitorInterval) {
        clearInterval(instance.processMonitorInterval)
      }

      // Notify detectors of exit
      this.detectorManager.handleTerminalExit(id, exitCode)

      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:exit', id, exitCode)
      }
      this.terminals.delete(id)
    })

    // Start monitoring for process changes
    this.startProcessMonitoring(id, ptyProcess)

    return info
  }

  write(id: string, data: string): void {
    const instance = this.terminals.get(id)
    if (instance) {
      instance.ptyProcess.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.terminals.get(id)
    if (instance) {
      instance.ptyProcess.resize(cols, rows)
    }
  }

  kill(id: string): void {
    const instance = this.terminals.get(id)
    if (instance) {
      // Stop process monitoring
      if (instance.processMonitorInterval) {
        clearInterval(instance.processMonitorInterval)
      }
      instance.ptyProcess.kill()
      this.terminals.delete(id)
      this.detectorManager.cleanupTerminal(id)
    }
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map((t) => t.info)
  }

  dispose(): void {
    for (const [id] of this.terminals) {
      this.kill(id)
    }
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }
}
