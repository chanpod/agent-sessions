import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'

/**
 * Supported agent types for the process manager
 */
export type AgentType = 'claude' | 'codex' | 'gemini'

/**
 * Internal representation of a running agent process
 */
interface AgentProcess {
  id: string
  process: ChildProcess
  agentType: AgentType
  cwd: string
  isAlive: boolean
  buffer: string // For incomplete NDJSON lines
}

/**
 * Public information about an agent process (excludes internal details)
 */
export interface AgentProcessInfo {
  id: string
  agentType: AgentType
  cwd: string
  isAlive: boolean
}

/**
 * Options for spawning a new agent process
 */
export interface SpawnOptions {
  agentType: AgentType
  cwd: string
  sessionId?: string
}

/**
 * Message types that can be sent to agent processes
 */
export interface UserMessage {
  type: 'user_message'
  content: string
}

/**
 * AgentProcessManager - Manages Claude CLI child processes with bidirectional JSON streaming
 *
 * This manager handles spawning agent CLI processes (claude, codex, gemini) as child processes
 * using stdin/stdout for communication instead of PTY. This enables proper JSON streaming
 * via NDJSON (newline-delimited JSON) protocol.
 *
 * Events emitted to renderer:
 * - 'agent:stream-event' (id, event) - Parsed JSON event from agent stdout
 * - 'agent:process-exit' (id, code) - Agent process exited
 * - 'agent:error' (id, error) - Error occurred
 */
export class AgentProcessManager {
  private processes: Map<string, AgentProcess> = new Map()
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
  }

  /**
   * Spawn a new agent process with JSON streaming enabled
   *
   * @param options - Spawn configuration
   * @returns AgentProcessInfo with process details
   */
  spawn(options: SpawnOptions): AgentProcessInfo {
    const { agentType, cwd, sessionId } = options
    const id = sessionId || randomUUID()

    // Build the command based on agent type
    const command = this.buildCommand(agentType)

    console.log(`[AgentProcessManager] Spawning ${agentType} process:`, {
      id,
      command,
      cwd,
    })

    // Spawn the process using bash.exe on Windows for proper PATH resolution
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'bash.exe' : '/bin/bash'
    const shellArgs = ['-c', command]

    const childProcess = spawn(shell, shellArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure proper terminal behavior
        TERM: 'xterm-256color',
        // Force color output where supported
        FORCE_COLOR: '1',
      },
    })

    const agentProcess: AgentProcess = {
      id,
      process: childProcess,
      agentType,
      cwd,
      isAlive: true,
      buffer: '',
    }

    this.processes.set(id, agentProcess)

    // Set up event handlers
    this.setupProcessHandlers(agentProcess)

    return {
      id,
      agentType,
      cwd,
      isAlive: true,
    }
  }

  /**
   * Build the CLI command for the given agent type
   */
  private buildCommand(agentType: AgentType): string {
    switch (agentType) {
      case 'claude':
        // Claude CLI with streaming JSON input/output and partial message support
        return 'claude -p --input-format stream-json --output-format stream-json --include-partial-messages'
      case 'codex':
        // Codex doesn't support JSON streaming yet - placeholder
        return 'codex'
      case 'gemini':
        // Gemini doesn't support JSON streaming yet - placeholder
        return 'gemini'
      default:
        throw new Error(`Unknown agent type: ${agentType}`)
    }
  }

  /**
   * Set up stdout, stderr, and exit handlers for the process
   */
  private setupProcessHandlers(agentProcess: AgentProcess): void {
    const { id, process: childProcess } = agentProcess

    // Handle stdout data - parse NDJSON lines
    childProcess.stdout?.on('data', (data: Buffer) => {
      const dataStr = data.toString()
      this.handleStdout(id, dataStr)
    })

    // Handle stderr - emit as error events
    childProcess.stderr?.on('data', (data: Buffer) => {
      const errorStr = data.toString()
      console.error(`[AgentProcessManager] stderr from ${id}:`, errorStr)
      this.emitToRenderer('agent:error', id, { message: errorStr })
    })

    // Handle process exit
    childProcess.on('exit', (code: number | null, signal: string | null) => {
      console.log(`[AgentProcessManager] Process ${id} exited:`, { code, signal })

      const proc = this.processes.get(id)
      if (proc) {
        proc.isAlive = false

        // Flush any remaining buffer content
        if (proc.buffer.trim()) {
          try {
            const event = JSON.parse(proc.buffer)
            this.emitToRenderer('agent:stream-event', id, event)
          } catch {
            console.warn(`[AgentProcessManager] Unparseable final buffer:`, proc.buffer)
          }
        }
      }

      this.emitToRenderer('agent:process-exit', id, code ?? -1)
      this.processes.delete(id)
    })

    // Handle process errors (spawn failures, etc.)
    childProcess.on('error', (error: Error) => {
      console.error(`[AgentProcessManager] Process ${id} error:`, error)

      const proc = this.processes.get(id)
      if (proc) {
        proc.isAlive = false
      }

      this.emitToRenderer('agent:error', id, { message: error.message })
    })
  }

  /**
   * Handle stdout data - buffer and parse NDJSON lines
   *
   * NDJSON (Newline Delimited JSON) format: each line is a complete JSON object.
   * We buffer incomplete lines and parse complete ones.
   */
  private handleStdout(id: string, data: string): void {
    const agentProcess = this.processes.get(id)
    if (!agentProcess) return

    // Append new data to buffer
    agentProcess.buffer += data

    // Split on newlines, keeping incomplete line in buffer
    const lines = agentProcess.buffer.split('\n')
    agentProcess.buffer = lines.pop() || '' // Keep last incomplete line

    // Parse and emit complete lines
    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const event = JSON.parse(line)
        this.emitToRenderer('agent:stream-event', id, event)
      } catch (e) {
        console.error(`[AgentProcessManager] Failed to parse NDJSON:`, line)
        // Optionally emit parse errors as events
        this.emitToRenderer('agent:error', id, {
          message: `Failed to parse JSON: ${line.substring(0, 100)}`,
        })
      }
    }
  }

  /**
   * Send a message to an agent process via stdin
   *
   * @param id - Process ID
   * @param message - Message to send (will be JSON stringified with newline)
   */
  sendMessage(id: string, message: UserMessage): void {
    const agentProcess = this.processes.get(id)
    if (!agentProcess) {
      console.error(`[AgentProcessManager] Cannot send message - process ${id} not found`)
      return
    }

    if (!agentProcess.isAlive) {
      console.error(`[AgentProcessManager] Cannot send message - process ${id} is not alive`)
      return
    }

    const stdin = agentProcess.process.stdin
    if (!stdin) {
      console.error(`[AgentProcessManager] Cannot send message - process ${id} has no stdin`)
      return
    }

    // Write JSON message with newline (NDJSON format)
    const jsonLine = JSON.stringify(message) + '\n'
    console.log(`[AgentProcessManager] Sending message to ${id}:`, message.content.substring(0, 100))
    stdin.write(jsonLine)
  }

  /**
   * Kill an agent process
   *
   * @param id - Process ID to kill
   */
  kill(id: string): void {
    const agentProcess = this.processes.get(id)
    if (!agentProcess) {
      console.warn(`[AgentProcessManager] Cannot kill - process ${id} not found`)
      return
    }

    console.log(`[AgentProcessManager] Killing process ${id}`)

    agentProcess.isAlive = false
    agentProcess.process.kill('SIGTERM')

    // Force kill after timeout if still alive
    setTimeout(() => {
      if (!agentProcess.process.killed) {
        console.log(`[AgentProcessManager] Force killing process ${id}`)
        agentProcess.process.kill('SIGKILL')
      }
    }, 5000)

    this.processes.delete(id)
  }

  /**
   * List all managed agent processes
   *
   * @returns Array of AgentProcessInfo objects
   */
  list(): AgentProcessInfo[] {
    return Array.from(this.processes.values()).map((proc) => ({
      id: proc.id,
      agentType: proc.agentType,
      cwd: proc.cwd,
      isAlive: proc.isAlive,
    }))
  }

  /**
   * Get info for a specific process
   *
   * @param id - Process ID
   * @returns AgentProcessInfo or undefined if not found
   */
  get(id: string): AgentProcessInfo | undefined {
    const proc = this.processes.get(id)
    if (!proc) return undefined

    return {
      id: proc.id,
      agentType: proc.agentType,
      cwd: proc.cwd,
      isAlive: proc.isAlive,
    }
  }

  /**
   * Clean up all agent processes
   */
  dispose(): void {
    console.log(`[AgentProcessManager] Disposing ${this.processes.size} processes`)

    const ids = Array.from(this.processes.keys())
    for (const id of ids) {
      this.kill(id)
    }

    this.processes.clear()
  }

  /**
   * Emit an event to the renderer process
   */
  private emitToRenderer(channel: string, id: string, data: unknown): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(channel, id, data)
    }
  }
}
