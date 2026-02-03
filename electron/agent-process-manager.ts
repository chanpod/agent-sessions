import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getGitBashPath } from './services/cli-detector.js'

/**
 * Supported agent types for the process manager
 */
export type AgentType = 'claude' | 'codex' | 'gemini'

// =============================================================================
// Claude CLI Print Mode Event Types & Transformer
// =============================================================================

/**
 * Claude CLI print mode events (different from raw API streaming events)
 */
interface ClaudeSystemEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  model: string
  cwd: string
  tools: string[]
  [key: string]: unknown
}

interface ClaudeAssistantEvent {
  type: 'assistant'
  message: {
    id: string
    model: string
    role: 'assistant'
    content: Array<{ type: string; text?: string; [key: string]: unknown }>
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    [key: string]: unknown
  }
  session_id: string
  [key: string]: unknown
}

interface ClaudeResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  result: string
  session_id: string
  duration_ms: number
  total_cost_usd?: number
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  [key: string]: unknown
}

type ClaudePrintModeEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeResultEvent | { type: string; [key: string]: unknown }

/**
 * Transformed agent events (what the UI expects)
 */
interface AgentStreamEvent {
  type: string
  data: unknown
}

/**
 * Transform Claude CLI print-mode events to agent-* events for the UI
 */
function transformClaudeEvent(event: ClaudePrintModeEvent): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = []

  switch (event.type) {
    case 'system': {
      const sysEvent = event as ClaudeSystemEvent
      if (sysEvent.subtype === 'init') {
        events.push({
          type: 'agent-message-start',
          data: {
            messageId: sysEvent.session_id,
            model: sysEvent.model,
          },
        })
      }
      break
    }

    case 'assistant': {
      const assistantEvent = event as ClaudeAssistantEvent
      const content = assistantEvent.message?.content || []

      content.forEach((block, index) => {
        if (block.type === 'text' && block.text) {
          events.push({
            type: 'agent-text-delta',
            data: {
              text: block.text,
              blockIndex: index,
            },
          })
        } else if (block.type === 'thinking' && block.thinking) {
          events.push({
            type: 'agent-thinking-delta',
            data: {
              text: block.thinking as string,
              blockIndex: index,
            },
          })
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'agent-tool-start',
            data: {
              toolId: block.id as string,
              name: block.name as string,
              blockIndex: index,
            },
          })
          if (block.input) {
            events.push({
              type: 'agent-tool-input-delta',
              data: {
                partialJson: JSON.stringify(block.input),
                blockIndex: index,
              },
            })
          }
          events.push({
            type: 'agent-tool-end',
            data: { blockIndex: index },
          })
        }
      })
      break
    }

    case 'result': {
      const resultEvent = event as ClaudeResultEvent
      events.push({
        type: 'agent-message-end',
        data: {
          stopReason: resultEvent.subtype === 'success' ? 'end_turn' : 'error',
          usage: resultEvent.usage
            ? {
                inputTokens: resultEvent.usage.input_tokens,
                outputTokens: resultEvent.usage.output_tokens,
                cacheReadInputTokens: resultEvent.usage.cache_read_input_tokens,
                cacheCreationInputTokens: resultEvent.usage.cache_creation_input_tokens,
              }
            : { inputTokens: 0, outputTokens: 0 },
        },
      })
      break
    }
  }

  return events
}

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
  /** Resume a previous session (for multi-turn conversations) */
  resumeSessionId?: string
}

/**
 * Message types that can be sent to agent processes
 * Claude CLI stream-json format expects: { type: 'user', message: { role: 'user', content: '...' } }
 */
export interface UserMessage {
  type: 'user'
  message: {
    role: 'user'
    content: string
  }
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
    const { agentType, cwd, sessionId, resumeSessionId } = options
    const id = sessionId || randomUUID()

    // Build the command based on agent type (with optional --resume for multi-turn)
    const command = this.buildCommand(agentType, resumeSessionId)

    console.log(`[AgentProcessManager] Spawning ${agentType} process:`, {
      id,
      command,
      cwd,
      resumeSessionId,
    })

    // Spawn the process using Git Bash on Windows for proper PATH resolution
    // Note: We must use the full path to Git Bash, not just 'bash.exe', because
    // WSL's bash.exe may be found first in PATH and it can't resolve Windows node
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? (getGitBashPath() || 'bash.exe') : '/bin/bash'
    const shellArgs = ['-l', '-c', command] // -l for login shell to load PATH properly

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
  private buildCommand(agentType: AgentType, resumeSessionId?: string): string {
    switch (agentType) {
      case 'claude': {
        // Claude CLI with streaming JSON input/output and partial message support
        // --verbose is required when using --print with --output-format=stream-json
        let cmd = 'claude -p --verbose --input-format stream-json --output-format stream-json'
        if (resumeSessionId) {
          cmd += ` --resume ${resumeSessionId}`
        }
        return cmd
      }
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

    console.log(`[AgentProcessManager] stdout from ${id}:`, data.substring(0, 200))

    // Append new data to buffer
    agentProcess.buffer += data

    // Split on newlines, keeping incomplete line in buffer
    const lines = agentProcess.buffer.split('\n')
    agentProcess.buffer = lines.pop() || '' // Keep last incomplete line

    // Parse and emit complete lines
    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const rawEvent = JSON.parse(line) as ClaudePrintModeEvent
        console.log(`[AgentProcessManager] Parsed event type:`, rawEvent.type, (rawEvent as { subtype?: string }).subtype || '')

        // Transform Claude CLI print-mode events to agent-* events
        const transformedEvents = transformClaudeEvent(rawEvent)

        // Emit each transformed event
        for (const event of transformedEvents) {
          console.log(`[AgentProcessManager] Emitting transformed event:`, event.type)
          this.emitToRenderer('agent:stream-event', id, event)
        }

        // Also emit the raw event for any listeners that want it
        this.emitToRenderer('agent:raw-event', id, rawEvent)
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
    console.log(`[AgentProcessManager] Sending message to ${id}:`, message.message.content.substring(0, 100))
    stdin.write(jsonLine)

    // Close stdin to signal end of input - Claude CLI requires EOF to start processing
    // Note: For multi-turn conversations, we'll need to spawn a new process with --resume
    stdin.end()
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
