/**
 * CodexStreamDetector - Parses OpenAI Codex CLI NDJSON streaming output
 * Detects and emits normalized agent-* events from Codex's JSON output.
 *
 * Codex CLI event flow:
 *   thread.started → turn.started → item.started/updated/completed → turn.completed
 *
 * This detector maps Codex events to the same agent-* event types that
 * the renderer already understands (originally designed for Claude).
 *
 * Mapping:
 *   thread.started        → agent-session-init
 *   turn.started           → agent-message-start (synthetic, marks start of a turn)
 *   item.started/updated   → agent-text-delta, agent-tool-start, agent-thinking-delta, etc.
 *   item.completed         → agent-block-end (or text/tool finalization)
 *   turn.completed         → agent-message-end (with usage)
 *   turn.failed / error    → agent-error
 */

import { OutputDetector, DetectedEvent } from './output-detector'
import { stripAnsi, extractCompleteJsonObjects } from './pty-json-utils'

// ============================================================
// Codex CLI Event Types
// ============================================================

interface CodexThreadStartedEvent {
  type: 'thread.started'
  thread_id: string
}

interface CodexTurnStartedEvent {
  type: 'turn.started'
}

interface CodexTurnCompletedEvent {
  type: 'turn.completed'
  usage?: {
    input_tokens: number
    cached_input_tokens?: number
    output_tokens: number
  }
}

interface CodexTurnFailedEvent {
  type: 'turn.failed'
  error?: string
}

interface CodexItemEvent {
  type: 'item.started' | 'item.updated' | 'item.completed'
  item: CodexItem
}

interface CodexErrorEvent {
  type: 'error'
  message?: string
  error?: string
}

type CodexEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexTurnCompletedEvent
  | CodexTurnFailedEvent
  | CodexItemEvent
  | CodexErrorEvent

// ============================================================
// Codex JSON-RPC Approval Requests
// These arrive as server-initiated JSON-RPC messages (have `method`
// instead of `type`) when Codex needs permission to execute a tool.
// ============================================================

interface CodexApprovalRequest {
  method: string // e.g. 'item/commandExecution/requestApproval', 'item/fileChange/requestApproval'
  id: number
  params: {
    itemId?: string
    threadId?: string
    turnId?: string
    reason?: string
    risk?: string
    parsedCmd?: string
    command?: string
    [key: string]: unknown
  }
}

// ============================================================
// Codex Item Types
// ============================================================

type CodexItemType =
  | 'agent_message'
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'reasoning'
  | 'web_search'
  | 'plan_update'

interface CodexItem {
  id: string
  type: CodexItemType
  status?: 'in_progress' | 'completed' | 'failed' | 'declined'
  // agent_message fields
  text?: string
  // command_execution fields
  command?: string
  output?: string
  exit_code?: number
  // file_change fields
  filename?: string
  content?: string
  diff?: string
  // mcp_tool_call fields
  tool_name?: string
  arguments?: unknown
  result?: unknown
  // reasoning fields
  reasoning?: string
  // web_search fields
  query?: string
  // plan_update fields
  plan?: string
}

// ============================================================
// Per-Terminal State
// ============================================================

interface TerminalCodexState {
  buffer: string
  sessionId: string | null
  /** Whether we're inside a turn (between turn.started and turn.completed) */
  inTurn: boolean
  /** Whether we've emitted agent-message-start for the current turn */
  emittedMessageStart: boolean
  /** Monotonic block index within the current turn */
  currentBlockIndex: number
  /** Tracks items we've seen start events for (to avoid duplicate block starts) */
  activeItems: Set<string>
  /** Usage from the most recent turn.completed */
  usage: { inputTokens: number; outputTokens: number } | null
  lastEventTime: number
}

// ============================================================
// Detector Implementation
// ============================================================

export class CodexStreamDetector implements OutputDetector {
  readonly id = 'codex-stream-detector'

  private terminalStates: Map<string, TerminalCodexState> = new Map()

  processOutput(terminalId: string, data: string): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.getOrCreateState(terminalId)

    const cleanData = stripAnsi(data)
    state.buffer += cleanData

    const { jsonObjects, remaining } = extractCompleteJsonObjects(state.buffer)
    state.buffer = remaining

    for (const jsonStr of jsonObjects) {
      try {
        const parsed = JSON.parse(jsonStr)

        // JSON-RPC approval requests have `method` instead of `type`.
        // Detect and emit them separately from regular Codex events.
        if (parsed.method && typeof parsed.id === 'number') {
          const approvalEvents = this.processApprovalRequest(terminalId, parsed as CodexApprovalRequest)
          events.push(...approvalEvents)
          continue
        }

        const detectedEvents = this.processCodexEvent(terminalId, state, parsed as CodexEvent)
        events.push(...detectedEvents)
      } catch {
        // Failed to parse JSON - skip silently
      }
    }

    return events
  }

  onTerminalExit(terminalId: string, exitCode: number): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.terminalStates.get(terminalId)

    // If we were mid-turn, emit a synthetic message-end
    if (state && state.inTurn && state.emittedMessageStart) {
      events.push({
        terminalId,
        type: 'agent-message-end',
        timestamp: Date.now(),
        data: {
          messageId: state.sessionId,
          model: null,
          stopReason: 'terminal_exit',
          exitCode,
          usage: state.usage,
        },
      })
    }

    // Always emit process exit
    events.push({
      terminalId,
      type: 'agent-process-exit',
      timestamp: Date.now(),
      data: { exitCode },
    })

    return events
  }

  cleanup(terminalId: string): void {
    this.terminalStates.delete(terminalId)
  }

  // ----------------------------------------------------------
  // JSON-RPC approval handling
  // ----------------------------------------------------------

  /**
   * Process a JSON-RPC approval request from Codex.
   * These arrive when Codex needs permission to execute a command or modify a file.
   * Emits a `codex-approval-request` event so the renderer can show a permission dialog.
   */
  private processApprovalRequest(
    terminalId: string,
    request: CodexApprovalRequest
  ): DetectedEvent[] {
    const timestamp = Date.now()

    // Determine tool name from the JSON-RPC method
    let toolName = 'unknown'
    if (request.method.includes('commandExecution')) {
      toolName = 'command_execution'
    } else if (request.method.includes('fileChange')) {
      toolName = 'file_change'
    } else {
      // Use the method name as fallback
      toolName = request.method.split('/').pop() || 'unknown'
    }

    // Build a human-readable tool input object for the permission modal
    const toolInput: Record<string, unknown> = {}
    if (request.params.command) {
      toolInput.command = request.params.command
    }
    if (request.params.parsedCmd) {
      toolInput.command = request.params.parsedCmd
    }
    if (request.params.reason) {
      toolInput.reason = request.params.reason
    }
    if (request.params.risk) {
      toolInput.risk = request.params.risk
    }
    // Include all params for completeness
    Object.assign(toolInput, request.params)

    return [{
      terminalId,
      type: 'codex-approval-request',
      timestamp,
      data: {
        jsonRpcId: request.id,
        method: request.method,
        toolName,
        toolInput,
        params: request.params,
      },
    }]
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  private getOrCreateState(terminalId: string): TerminalCodexState {
    let state = this.terminalStates.get(terminalId)
    if (!state) {
      state = {
        buffer: '',
        sessionId: null,
        inTurn: false,
        emittedMessageStart: false,
        currentBlockIndex: -1,
        activeItems: new Set(),
        usage: null,
        lastEventTime: Date.now(),
      }
      this.terminalStates.set(terminalId, state)
    }
    return state
  }

  private processCodexEvent(
    terminalId: string,
    state: TerminalCodexState,
    event: CodexEvent
  ): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const timestamp = Date.now()
    state.lastEventTime = timestamp

    switch (event.type) {
      // ======================================================
      // Session initialization
      // ======================================================
      case 'thread.started': {
        const threadEvent = event as CodexThreadStartedEvent
        state.sessionId = threadEvent.thread_id
        events.push({
          terminalId,
          type: 'agent-session-init',
          timestamp,
          data: {
            sessionId: threadEvent.thread_id,
            model: '',
          },
        })
        break
      }

      // ======================================================
      // Turn lifecycle (≈ message lifecycle)
      // ======================================================
      case 'turn.started': {
        state.inTurn = true
        state.emittedMessageStart = false
        state.currentBlockIndex = -1
        state.activeItems.clear()
        state.usage = null
        break
      }

      case 'turn.completed': {
        const turnEvent = event as CodexTurnCompletedEvent
        if (turnEvent.usage) {
          state.usage = {
            inputTokens: turnEvent.usage.input_tokens,
            outputTokens: turnEvent.usage.output_tokens,
          }
        }

        // If message-start was emitted, close it with message-end
        if (state.emittedMessageStart) {
          events.push({
            terminalId,
            type: 'agent-message-end',
            timestamp,
            data: {
              messageId: state.sessionId,
              model: null,
              stopReason: 'end_turn',
              usage: state.usage,
            },
          })
        }

        state.inTurn = false
        state.emittedMessageStart = false
        state.currentBlockIndex = -1
        state.activeItems.clear()
        break
      }

      case 'turn.failed': {
        const failedEvent = event as CodexTurnFailedEvent
        events.push({
          terminalId,
          type: 'agent-error',
          timestamp,
          data: {
            error: failedEvent.error || 'Turn failed',
          },
        })

        // Also close any open message
        if (state.emittedMessageStart) {
          events.push({
            terminalId,
            type: 'agent-message-end',
            timestamp,
            data: {
              messageId: state.sessionId,
              model: null,
              stopReason: 'error',
              usage: state.usage,
            },
          })
        }

        state.inTurn = false
        state.emittedMessageStart = false
        state.currentBlockIndex = -1
        state.activeItems.clear()
        break
      }

      // ======================================================
      // Item lifecycle (≈ content block lifecycle)
      // ======================================================
      case 'item.started': {
        const itemEvent = event as CodexItemEvent
        const item = itemEvent.item

        // Ensure we've emitted message-start for this turn
        this.ensureMessageStart(terminalId, state, events, timestamp)

        // Track this item
        state.activeItems.add(item.id)
        state.currentBlockIndex++

        // Emit the appropriate block-start event
        events.push(...this.emitItemStartEvents(terminalId, state, item, timestamp))
        break
      }

      case 'item.updated': {
        const itemEvent = event as CodexItemEvent
        const item = itemEvent.item

        // Ensure message-start (in case we missed item.started)
        this.ensureMessageStart(terminalId, state, events, timestamp)

        // If we haven't seen this item's start, emit it now
        if (!state.activeItems.has(item.id)) {
          state.activeItems.add(item.id)
          state.currentBlockIndex++
          events.push(...this.emitItemStartEvents(terminalId, state, item, timestamp))
        }

        // Emit delta events
        events.push(...this.emitItemDeltaEvents(terminalId, state, item, timestamp))
        break
      }

      case 'item.completed': {
        const itemEvent = event as CodexItemEvent
        const item = itemEvent.item

        // Ensure message-start
        this.ensureMessageStart(terminalId, state, events, timestamp)

        // If we never saw item.started for this one, emit start + content
        if (!state.activeItems.has(item.id)) {
          state.activeItems.add(item.id)
          state.currentBlockIndex++
          events.push(...this.emitItemStartEvents(terminalId, state, item, timestamp))
        }

        // Emit final content for the completed item
        events.push(...this.emitItemCompletedEvents(terminalId, state, item, timestamp))

        // Emit block-end
        events.push({
          terminalId,
          type: 'agent-block-end',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex: this.getBlockIndexForItem(state, item),
            blockType: this.getBlockType(item.type),
          },
        })

        state.activeItems.delete(item.id)
        break
      }

      // ======================================================
      // Top-level errors
      // ======================================================
      case 'error': {
        const errorEvent = event as CodexErrorEvent
        events.push({
          terminalId,
          type: 'agent-error',
          timestamp,
          data: {
            error: errorEvent.message || errorEvent.error || 'Unknown error',
          },
        })
        break
      }
    }

    return events
  }

  /**
   * Emit a synthetic agent-message-start if we haven't done so for the current turn.
   */
  private ensureMessageStart(
    terminalId: string,
    state: TerminalCodexState,
    events: DetectedEvent[],
    timestamp: number
  ): void {
    if (!state.emittedMessageStart) {
      state.emittedMessageStart = true
      events.push({
        terminalId,
        type: 'agent-message-start',
        timestamp,
        data: {
          messageId: state.sessionId,
          model: null,
          usage: null,
        },
      })
    }
  }

  /**
   * Map a Codex item type to the normalized block type used by the renderer.
   */
  private getBlockType(itemType: CodexItemType): 'text' | 'thinking' | 'tool_use' {
    switch (itemType) {
      case 'agent_message':
      case 'plan_update':
        return 'text'
      case 'reasoning':
        return 'thinking'
      case 'command_execution':
      case 'file_change':
      case 'mcp_tool_call':
      case 'web_search':
      default:
        return 'tool_use'
    }
  }

  /**
   * Get (or approximate) the block index for an item.
   * Since items may arrive out of order or without a start event,
   * we use the current block index as the best available value.
   */
  private getBlockIndexForItem(_state: TerminalCodexState, _item: CodexItem): number {
    return _state.currentBlockIndex
  }

  /**
   * Emit appropriate start events for a Codex item based on its type.
   */
  private emitItemStartEvents(
    terminalId: string,
    state: TerminalCodexState,
    item: CodexItem,
    timestamp: number
  ): DetectedEvent[] {
    const blockType = this.getBlockType(item.type)
    const blockIndex = state.currentBlockIndex

    switch (item.type) {
      case 'agent_message':
        return [{
          terminalId,
          type: 'agent-text-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType: 'text',
          },
        }]

      case 'reasoning':
        return [{
          terminalId,
          type: 'agent-thinking-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType: 'thinking',
          },
        }]

      case 'command_execution':
        return [{
          terminalId,
          type: 'agent-tool-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType: 'tool_use',
            toolId: item.id,
            name: 'command_execution',
            toolName: 'command_execution',
          },
        }]

      case 'file_change':
        return [{
          terminalId,
          type: 'agent-tool-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType: 'tool_use',
            toolId: item.id,
            name: 'file_change',
            toolName: 'file_change',
          },
        }]

      case 'mcp_tool_call':
        return [{
          terminalId,
          type: 'agent-tool-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType: 'tool_use',
            toolId: item.id,
            name: item.tool_name || 'mcp_tool_call',
            toolName: item.tool_name || 'mcp_tool_call',
          },
        }]

      case 'web_search':
        return [{
          terminalId,
          type: 'agent-tool-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType: 'tool_use',
            toolId: item.id,
            name: 'web_search',
            toolName: 'web_search',
          },
        }]

      case 'plan_update':
        // Plan updates are rendered as text blocks
        return [{
          terminalId,
          type: 'agent-text-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType: 'text',
          },
        }]

      default:
        return [{
          terminalId,
          type: 'agent-tool-start',
          timestamp,
          data: {
            messageId: state.sessionId,
            blockIndex,
            blockType,
            toolId: item.id,
            name: item.type,
            toolName: item.type,
          },
        }]
    }
  }

  /**
   * Emit delta (streaming update) events for an item.updated event.
   */
  private emitItemDeltaEvents(
    terminalId: string,
    state: TerminalCodexState,
    item: CodexItem,
    timestamp: number
  ): DetectedEvent[] {
    const blockIndex = state.currentBlockIndex

    switch (item.type) {
      case 'agent_message':
        if (item.text) {
          return [{
            terminalId,
            type: 'agent-text-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              blockType: 'text',
              text: item.text,
            },
          }]
        }
        break

      case 'reasoning':
        if (item.reasoning) {
          return [{
            terminalId,
            type: 'agent-thinking-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              blockType: 'thinking',
              thinking: item.reasoning,
            },
          }]
        }
        break

      case 'command_execution':
        // Stream the command as tool input
        if (item.command) {
          return [{
            terminalId,
            type: 'agent-tool-input-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              partialJson: JSON.stringify({ command: item.command }),
            },
          }]
        }
        break

      case 'file_change':
        if (item.filename) {
          return [{
            terminalId,
            type: 'agent-tool-input-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              partialJson: JSON.stringify({
                filename: item.filename,
                ...(item.diff ? { diff: item.diff } : {}),
              }),
            },
          }]
        }
        break

      case 'mcp_tool_call':
        if (item.arguments) {
          return [{
            terminalId,
            type: 'agent-tool-input-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              partialJson: JSON.stringify(item.arguments),
            },
          }]
        }
        break

      case 'plan_update':
        if (item.plan) {
          return [{
            terminalId,
            type: 'agent-text-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              blockType: 'text',
              text: item.plan,
            },
          }]
        }
        break
    }

    return []
  }

  /**
   * Emit final content events when an item completes.
   * Only emits if the completed item carries content we haven't streamed yet.
   */
  private emitItemCompletedEvents(
    terminalId: string,
    state: TerminalCodexState,
    item: CodexItem,
    timestamp: number
  ): DetectedEvent[] {
    const blockIndex = state.currentBlockIndex

    switch (item.type) {
      case 'agent_message':
        // item.completed carries the full text; emit it as a final delta
        // The renderer accumulates deltas, so for non-streaming cases
        // this is the only delta and contains the full text.
        if (item.text) {
          return [{
            terminalId,
            type: 'agent-text-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              blockType: 'text',
              text: item.text,
            },
          }]
        }
        break

      case 'reasoning':
        if (item.reasoning) {
          return [{
            terminalId,
            type: 'agent-thinking-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              blockType: 'thinking',
              thinking: item.reasoning,
            },
          }]
        }
        break

      case 'command_execution':
        // Emit the final command + output as tool input
        if (item.command || item.output) {
          return [{
            terminalId,
            type: 'agent-tool-input-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              partialJson: JSON.stringify({
                command: item.command,
                ...(item.output ? { output: item.output } : {}),
                ...(item.exit_code !== undefined ? { exit_code: item.exit_code } : {}),
              }),
            },
          }]
        }
        break

      case 'file_change':
        if (item.filename) {
          return [{
            terminalId,
            type: 'agent-tool-input-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              partialJson: JSON.stringify({
                filename: item.filename,
                ...(item.diff ? { diff: item.diff } : {}),
                ...(item.content ? { content: item.content } : {}),
              }),
            },
          }]
        }
        break

      case 'mcp_tool_call':
        // Emit final arguments + result
        if (item.arguments || item.result) {
          const parts: DetectedEvent[] = []
          if (item.arguments) {
            parts.push({
              terminalId,
              type: 'agent-tool-input-delta',
              timestamp,
              data: {
                messageId: state.sessionId,
                blockIndex,
                partialJson: JSON.stringify(item.arguments),
              },
            })
          }
          return parts
        }
        break

      case 'plan_update':
        if (item.plan) {
          return [{
            terminalId,
            type: 'agent-text-delta',
            timestamp,
            data: {
              messageId: state.sessionId,
              blockIndex,
              blockType: 'text',
              text: item.plan,
            },
          }]
        }
        break
    }

    return []
  }
}
