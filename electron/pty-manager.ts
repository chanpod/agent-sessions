import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import os from 'os'
import { exec, execSync } from 'child_process'
import { promisify } from 'util'
import { DetectorManager } from './output-monitors/detector-manager'
import { ServerDetector } from './output-monitors/server-detector'
import { StreamJsonDetector } from './output-monitors/stream-json-detector'
import { CodexStreamDetector } from './output-monitors/codex-stream-detector'
import { getGitBashPath, isWslPath, parseWslPath, getEnvironment } from './utils/path-service.js'
import { logDetectorEvents } from './utils/event-logger.js'

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

  // Batch detector events to reduce IPC overhead.
  // Without batching, every text delta (100+/sec per agent) sends a separate IPC message
  // that triggers a separate React re-render, overwhelming the renderer process.
  private pendingDetectorEvents: import('./output-monitors/output-detector').DetectedEvent[] = []
  private detectorFlushTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly DETECTOR_BATCH_INTERVAL_MS = 50

  constructor(window: BrowserWindow) {
    this.window = window

    // Initialize output monitoring
    this.detectorManager = new DetectorManager()
    this.detectorManager.registerDetector(new ServerDetector())
    this.detectorManager.registerDetector(new StreamJsonDetector())
    this.detectorManager.registerDetector(new CodexStreamDetector())

    // Batch detected events before forwarding to renderer.
    // Events are accumulated and flushed every 50ms as a single IPC message.
    this.detectorManager.onEvent((event) => {
      if (this.window.isDestroyed()) return
      this.pendingDetectorEvents.push(event)
      if (!this.detectorFlushTimer) {
        this.detectorFlushTimer = setTimeout(() => {
          this.flushDetectorEvents()
        }, PtyManager.DETECTOR_BATCH_INTERVAL_MS)
      }
    })

    // Start single global process monitor (ONE wmic call for ALL terminals)
    this.startGlobalProcessMonitor()
  }

  /**
   * Flush accumulated detector events to the renderer as a single batched IPC message.
   */
  private flushDetectorEvents(): void {
    this.detectorFlushTimer = null
    if (this.pendingDetectorEvents.length > 0 && !this.window.isDestroyed()) {
      // Log full event data to file before sending to renderer
      logDetectorEvents(this.pendingDetectorEvents)
      this.window.webContents.send('detector:events-batch', this.pendingDetectorEvents)
      this.pendingDetectorEvents = []
    }
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

  createTerminal(options: {
    cwd?: string
    shell?: string
    id?: string
    hidden?: boolean
    initialCommand?: string  // Command to execute immediately (e.g., "claude --append-system-prompt '...'")
    title?: string           // Custom title override
  } = {}): TerminalInfo {
    const id = options.id || randomUUID()
    let shell = options.shell || this.getDefaultShell()
    const originalCwd = options.cwd || process.cwd()
    let effectiveCwd = originalCwd
    let shellArgs: string[] = []

    let shellExecutable = shell

    // If we have an initial command, wrap it in a shell
    // This is used for agent terminals (claude, gemini, codex) and any other command execution
    if (options.initialCommand) {
      if (process.platform === 'win32' && isWslPath(originalCwd)) {
        // WSL project — spawn agent inside WSL via wsl.exe
        const parsed = parseWslPath(originalCwd)
        const distro = parsed?.distro || getEnvironment().defaultWslDistro
        const linuxPath = parsed?.linuxPath || '~'
        if (!distro) {
          throw new Error('No WSL distribution found. Please install a Linux distribution from the Microsoft Store.')
        }
        shellExecutable = 'wsl.exe'
        shellArgs = ['-d', distro, '--cd', linuxPath, '--', 'bash', '-l', '-i', '-c', options.initialCommand]
        // node-pty needs a valid Windows-accessible cwd; the UNC path works
        effectiveCwd = originalCwd
      } else if (process.platform === 'win32') {
        // Windows project — use Git Bash with -l -i for login interactive shell
        // -i is needed to properly load PATH for npm-installed tools like codex (which need node)
        // MUST use getGitBashPath() — bare 'bash.exe' resolves to WSL bash on systems with WSL installed
        shellExecutable = getGitBashPath() || 'bash.exe'
        shellArgs = ['-l', '-i', '-c', options.initialCommand]
      } else {
        // On Unix, use default shell with login interactive
        shellExecutable = process.env.SHELL || '/bin/bash'
        shellArgs = ['-l', '-i', '-c', options.initialCommand]
      }
    }

    // For regular (non-agent) terminals with a WSL cwd, spawn wsl.exe
    if (!options.initialCommand && process.platform === 'win32' && isWslPath(originalCwd)) {
      const parsed = parseWslPath(originalCwd)
      const distro = parsed?.distro || getEnvironment().defaultWslDistro
      const linuxPath = parsed?.linuxPath || '~'
      if (distro) {
        shellExecutable = 'wsl.exe'
        shellArgs = ['-d', distro, '--cd', linuxPath]
        effectiveCwd = originalCwd
      }
    }

    const finalArgs = [...shellArgs]

    // For agent/hidden terminals, use very wide terminal to prevent line wrapping
    // that corrupts JSON streaming output. Regular terminals use standard 80x24.
    const isAgentTerminal = options.hidden || !!options.initialCommand
    const cols = isAgentTerminal ? 10000 : 80

    console.log(`[PtyManager] createTerminal: shell="${shellExecutable}", cwd="${effectiveCwd}", initialCommand=${!!options.initialCommand}, args=${JSON.stringify(finalArgs).substring(0, 200)}`)

    const ptyProcess = pty.spawn(shellExecutable, finalArgs, {
      name: 'xterm-256color',
      cols,
      rows: 24,
      cwd: effectiveCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    // Determine title: custom > initialCommand first word > shell executable
    let title = options.title
    if (!title && options.initialCommand) {
      title = options.initialCommand.split(' ')[0] // e.g., "claude" from "claude --append..."
    }
    if (!title) {
      title = shellExecutable.split(/[\\/]/).pop() || shell
    }

    const info: TerminalInfo = {
      id,
      pid: ptyProcess.pid,
      shell: options.initialCommand || shell, // Store command or shell for display
      cwd: originalCwd, // Store original cwd for display
      title,
      createdAt: Date.now(),
      hidden: options.hidden,
    }

    const instance: TerminalInstance = { info, ptyProcess, hidden: options.hidden }
    this.terminals.set(id, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      this.detectorManager.processOutput(id, data)

      if (!options.hidden && !this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.lastChildState.delete(id)
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

  /**
   * Write data in chunks to avoid overflowing PTY input buffers.
   * ConPTY on Windows can silently truncate large single writes, causing
   * the receiving process to see malformed/incomplete data.
   * Returns a promise that resolves when all chunks have been written.
   */
  writeChunked(id: string, data: string, chunkSize = 4096): Promise<void> {
    return new Promise((resolve, reject) => {
      const instance = this.terminals.get(id)
      if (!instance) {
        reject(new Error(`Terminal ${id} not found`))
        return
      }

      if (data.length <= chunkSize) {
        instance.ptyProcess.write(data)
        resolve()
        return
      }

      let offset = 0
      const writeNext = () => {
        const current = this.terminals.get(id)
        if (!current) {
          reject(new Error(`Terminal ${id} was killed during chunked write`))
          return
        }

        const chunk = data.slice(offset, offset + chunkSize)
        if (chunk.length > 0) {
          current.ptyProcess.write(chunk)
          offset += chunkSize
          if (offset < data.length) {
            setTimeout(writeNext, 5)
          } else {
            resolve()
          }
        } else {
          resolve()
        }
      }
      writeNext()
    })
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
    // Flush any remaining detector events before shutdown
    if (this.detectorFlushTimer) {
      clearTimeout(this.detectorFlushTimer)
      this.detectorFlushTimer = null
    }
    this.flushDetectorEvents()

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

  /**
   * Create an agent terminal that runs an AI CLI tool (claude, gemini, codex)
   * and optionally passes context as a command-line argument.
   *
   * @deprecated Use createTerminal with initialCommand option instead
   *
   * @param options.cwd - Working directory for the terminal
   * @param options.agentCommand - The agent command to run (e.g., "claude", "gemini", "codex")
   * @param options.context - Optional context to pass as a command-line argument
   * @param options.id - Optional terminal ID (will be generated if not provided)
   * @returns TerminalInfo with terminal details
   */
  createAgentTerminal(options: {
    cwd: string
    agentCommand: string
    context?: string
    id?: string
  }): TerminalInfo {
    const { cwd, agentCommand, context, id } = options

    // Build the command with optional context as argument
    // Each agent has different context injection syntax
    let fullCommand = agentCommand
    if (context) {
      // Escape the context for shell (handle quotes, special chars)
      const escapedContext = context
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')     // Escape double quotes
        .replace(/\$/g, '\\$')    // Escape dollar signs
        .replace(/`/g, '\\`')     // Escape backticks

      // Agent-specific context injection
      switch (agentCommand) {
        case 'claude':
          fullCommand = `claude --output-format stream-json --append-system-prompt "${escapedContext}"`
          break
        case 'gemini':
          fullCommand = `gemini -p "${escapedContext}"`
          break
        case 'codex':
          fullCommand = `codex "${escapedContext}"`
          break
        default:
          fullCommand = `${agentCommand} --append-system-prompt "${escapedContext}"`
      }
    } else if (agentCommand === 'claude') {
      // Claude without context still needs the output format flag
      fullCommand = 'claude --output-format stream-json'
    }

    // Delegate to unified createTerminal
    return this.createTerminal({
      cwd,
      id,
      initialCommand: fullCommand,
      title: agentCommand.split(' ')[0], // e.g., "claude"
    })
  }

  /**
   * Inject context into an existing terminal's stdin
   *
   * @param terminalId - The terminal ID to inject context into
   * @param context - The context string to inject
   * @returns Object with success status and optional error
   */
  injectContext(terminalId: string, context: string): { success: boolean; error?: string } {
    const instance = this.terminals.get(terminalId)
    if (!instance) {
      return { success: false, error: `Terminal ${terminalId} not found` }
    }

    const CHUNK_SIZE = 4096
    const SUBMIT_DELAY_MS = 100 // Delay between content and submit keystroke

    // Helper function to send the submit keystroke after content is written
    const sendSubmit = () => {
      setTimeout(() => {
        const currentInstance = this.terminals.get(terminalId)
        if (currentInstance) {
          // Use \r (carriage return) for Enter key - more universally recognized by TUIs
          currentInstance.ptyProcess.write('\r')
        }
      }, SUBMIT_DELAY_MS)
    }

    try {
      if (context.length > CHUNK_SIZE) {
        // Chunk large contexts
        let offset = 0
        const writeNextChunk = () => {
          const currentInstance = this.terminals.get(terminalId)
          if (!currentInstance) return

          const chunk = context.slice(offset, offset + CHUNK_SIZE)
          if (chunk.length > 0) {
            currentInstance.ptyProcess.write(chunk)
            offset += CHUNK_SIZE
            if (offset < context.length) {
              setTimeout(writeNextChunk, 10)
            } else {
              // All chunks written, wait then send submit
              sendSubmit()
            }
          }
        }
        writeNextChunk()
      } else {
        instance.ptyProcess.write(context)
        sendSubmit()
      }

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[PtyManager] Failed to inject context:`, error)
      return { success: false, error: errorMessage }
    }
  }
}
