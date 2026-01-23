import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import os from 'os'
import { exec, execSync } from 'child_process'
import { promisify } from 'util'
import { DetectorManager } from './output-monitors/detector-manager'
import { ServerDetector } from './output-monitors/server-detector'
import { convertToWslUncPath } from './utils/wsl-utils'

const execAsync = promisify(exec)

export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  title: string
  createdAt: number
  hidden?: boolean
}

interface TerminalInstance {
  info: TerminalInfo
  ptyProcess: pty.IPty
  hidden?: boolean
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

function isWslAvailable(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execSync('wsl --status', { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
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
 * Batch check which PIDs have child processes (async, non-blocking)
 * Returns a Set of PIDs that have children
 * This is MUCH more efficient than calling WMIC once per terminal
 */
async function getPidsWithChildren(pids: number[]): Promise<Set<number>> {
  if (pids.length === 0) return new Set()

  try {
    if (process.platform === 'win32') {
      // Single WMIC call to get ALL parent-child relationships
      // This is dramatically faster than one call per PID
      const { stdout } = await execAsync(`wmic process get ParentProcessId,ProcessId /format:csv`, {
        timeout: 5000,
        windowsHide: true,
      })

      const pidSet = new Set(pids)
      const pidsWithChildren = new Set<number>()

      // Parse CSV output: Node,ParentProcessId,ProcessId
      const lines = stdout.split('\n').slice(1) // Skip header
      for (const line of lines) {
        const parts = line.trim().split(',')
        if (parts.length >= 3) {
          const parentPid = parseInt(parts[1], 10)
          if (pidSet.has(parentPid)) {
            pidsWithChildren.add(parentPid)
          }
        }
      }

      return pidsWithChildren
    } else {
      // On Unix, single ps call to get all processes with their parents
      const { stdout } = await execAsync(`ps -eo ppid=,pid=`, {
        timeout: 5000,
      })

      const pidSet = new Set(pids)
      const pidsWithChildren = new Set<number>()

      const lines = stdout.split('\n')
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 2) {
          const parentPid = parseInt(parts[0], 10)
          if (pidSet.has(parentPid)) {
            pidsWithChildren.add(parentPid)
          }
        }
      }

      return pidsWithChildren
    }
  } catch (error) {
    // If command fails, assume all have children (safer)
    return new Set(pids)
  }
}

// Process monitoring interval - 10 seconds is plenty responsive
const PROCESS_MONITOR_INTERVAL_MS = 10000

export class PtyManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow
  private detectorManager: DetectorManager
  private globalMonitorInterval?: NodeJS.Timeout
  private lastChildState: Map<string, boolean> = new Map() // Track previous state per terminal
  private monitorCheckInProgress = false

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

    // Start single global process monitor (ONE wmic call for ALL terminals)
    this.startGlobalProcessMonitor()
  }

  /**
   * Single global monitor that checks ALL terminals in ONE system call
   * This replaces per-terminal polling which was spawning N wmic processes
   */
  private startGlobalProcessMonitor(): void {
    this.globalMonitorInterval = setInterval(async () => {
      if (this.monitorCheckInProgress) return
      if (this.terminals.size === 0) return

      try {
        this.monitorCheckInProgress = true

        // Collect all terminal PIDs
        const terminalPids: Array<{ id: string; pid: number }> = []
        for (const [id, instance] of this.terminals) {
          terminalPids.push({ id, pid: instance.ptyProcess.pid })
        }

        // Single system call for ALL terminals
        const pidsWithChildren = await getPidsWithChildren(terminalPids.map(t => t.pid))

        // Check each terminal for state transitions
        for (const { id, pid } of terminalPids) {
          const hasChildren = pidsWithChildren.has(pid)
          const hadChildren = this.lastChildState.get(id)

          // Detect transition from "has children" to "no children"
          if (hadChildren === true && hasChildren === false) {
            console.log(`[PtyManager] Process finished in terminal ${id}`)
            this.detectorManager.handleTerminalExit(id, 0)
          }

          this.lastChildState.set(id, hasChildren)
        }
      } catch (error) {
        console.error('[PtyManager] Error in global process monitor:', error)
      } finally {
        this.monitorCheckInProgress = false
      }
    }, PROCESS_MONITOR_INTERVAL_MS)
  }


  /**
   * Create terminal with custom command (used for SSH)
   */
  createTerminalWithCommand(shell: string, shellArgs: string[], displayCwd: string, id?: string, hidden?: boolean): TerminalInfo {
    const terminalId = id || randomUUID()

    // Clean environment for SSH - remove SSH_ASKPASS and related vars
    const cleanEnv = { ...process.env }
    delete cleanEnv.SSH_ASKPASS
    delete cleanEnv.SSH_ASKPASS_REQUIRE
    delete cleanEnv.DISPLAY // Force SSH to use terminal prompts, not GUI

    // On Windows, wrap SSH commands in a shell to avoid "getsocketname failed: Not a socket" error
    // This happens because ssh.exe has issues detecting PTY sockets when spawned directly
    let actualShell = shell
    let actualArgs = shellArgs

    if (process.platform === 'win32' && shell.toLowerCase().includes('ssh')) {
      // Use bash.exe (Git Bash/MinGW) which is usually in PATH on Windows
      // Don't use process.env.SHELL as it might be a Unix path like /usr/bin/bash
      const preferredShell = 'bash.exe'

      // Build the full SSH command as a string
      const sshCommand = `${shell} ${shellArgs.map(arg => {
        // Quote arguments that contain spaces or special characters
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
          return `"${arg.replace(/"/g, '\\"')}"`
        }
        return arg
      }).join(' ')}`

      console.log(`[PTYManager] Wrapping SSH in shell: ${preferredShell} -c "${sshCommand}"`)

      actualShell = preferredShell
      actualArgs = ['-c', sshCommand]
    }

    const ptyProcess = pty.spawn(actualShell, actualArgs, {
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
      hidden,
    }

    const instance: TerminalInstance = { info, ptyProcess, hidden }
    this.terminals.set(terminalId, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      // Process through detectors
      this.detectorManager.processOutput(terminalId, data)

      if (!hidden && !this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', terminalId, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Clean up state tracking
      this.lastChildState.delete(terminalId)

      // Notify detectors of exit
      this.detectorManager.handleTerminalExit(terminalId, exitCode)

      if (!hidden && !this.window.isDestroyed()) {
        this.window.webContents.send('pty:exit', terminalId, exitCode)
      }
      this.terminals.delete(terminalId)
    })

    return info
  }

  createTerminal(options: { cwd?: string; shell?: string; id?: string; hidden?: boolean } = {}): TerminalInfo {
    const id = options.id || randomUUID()
    let shell = options.shell || this.getDefaultShell()
    const originalCwd = options.cwd || process.cwd()
    let effectiveCwd = originalCwd
    let shellArgs: string[] = []

    // Parse shell if it contains arguments (e.g., "wsl.exe -d Ubuntu")
    // This handles shells defined with embedded arguments like WSL distro-specific shells
    // Only parse for WSL shells - Windows paths may contain spaces (e.g., "C:\Program Files\...")
    let shellExecutable = shell
    let parsedShellArgs: string[] = []

    if (shell.toLowerCase().includes('wsl') && shell.includes(' ')) {
      const parts = shell.split(' ')
      shellExecutable = parts[0]
      parsedShellArgs = parts.slice(1)
    }

    // Handle WSL paths on Windows
    if (process.platform === 'win32' && originalCwd && isWslPath(originalCwd)) {
      // Validate WSL is available before attempting to use it
      if (!isWslAvailable()) {
        throw new Error('WSL is not available. Please ensure Windows Subsystem for Linux is installed and enabled.')
      }

      const distro = getDefaultWslDistro()
      if (!distro) {
        throw new Error('No WSL distribution found. Please install a Linux distribution from the Microsoft Store.')
      }

      const linuxPath = getLinuxPathFromWslPath(originalCwd)

      // If shell executable is not already WSL, switch to WSL
      // Check the executable name, not the full string with args
      if (!shellExecutable.toLowerCase().includes('wsl')) {
        shellExecutable = 'wsl.exe'
        parsedShellArgs = [] // Clear any parsed args since we're switching to WSL
        shellArgs = ['-d', distro, '--cd', linuxPath]
      }
      // Convert Linux path to UNC path for Windows to access WSL filesystem
      const uncPath = convertToWslUncPath(linuxPath, distro)
      effectiveCwd = uncPath || process.cwd()
    }

    // Combine parsed args with any existing shellArgs
    const finalArgs = [...parsedShellArgs, ...shellArgs]

    const ptyProcess = pty.spawn(shellExecutable, finalArgs, {
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
      title: shellExecutable.split(/[\\/]/).pop() || shell, // Use executable for title
      createdAt: Date.now(),
      hidden: options.hidden,
    }

    const instance: TerminalInstance = { info, ptyProcess, hidden: options.hidden }
    this.terminals.set(id, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      // Process through detectors
      this.detectorManager.processOutput(id, data)

      if (!options.hidden && !this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Clean up state tracking
      this.lastChildState.delete(id)

      // Notify detectors of exit
      this.detectorManager.handleTerminalExit(id, exitCode)

      if (!options.hidden && !this.window.isDestroyed()) {
        this.window.webContents.send('pty:exit', id, exitCode)
      }
      this.terminals.delete(id)
    })

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
      this.lastChildState.delete(id)
      instance.ptyProcess.kill()
      this.terminals.delete(id)
      this.detectorManager.cleanupTerminal(id)
    }
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map((t) => t.info)
  }

  dispose(): void {
    // Stop global process monitor
    if (this.globalMonitorInterval) {
      clearInterval(this.globalMonitorInterval)
    }
    this.lastChildState.clear()

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

  /**
   * Get the detector manager (for registering custom detectors like ReviewDetector)
   */
  getDetectorManager(): DetectorManager {
    return this.detectorManager
  }
}
