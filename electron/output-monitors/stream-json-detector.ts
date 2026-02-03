/**
 * StreamJsonDetector - Parses Claude CLI NDJSON streaming output
 * Detects and emits events from Claude's streaming JSON responses
 */

import { OutputDetector, DetectedEvent } from './output-detector'

// Strip ANSI codes for parsing
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

/**
 * State tracked per terminal for streaming messages
 */
interface TerminalStreamState {
  buffer: string
  messageId: string | null
  model: string | null
  currentBlockIndex: number
  currentBlockType: 'text' | 'thinking' | 'tool_use' | null
  usage: { inputTokens: number; outputTokens: number } | null
  stopReason: string | null
  lastEventTime: number
}

/**
 * Claude CLI streaming event types
 */
type ClaudeEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'

interface ClaudeStreamEvent {
  type: ClaudeEventType
  message?: {
    id: string
    model: string
    usage?: {
      input_tokens: number
      output_tokens: number
    }
  }
  index?: number
  content_block?: {
    type: 'text' | 'thinking' | 'tool_use'
    id?: string
    name?: string
    text?: string
    thinking?: string
  }
  delta?: {
    type: string
    text?: string
    thinking?: string
    partial_json?: string
    stop_reason?: string
    usage?: {
      output_tokens: number
    }
  }
  usage?: {
    output_tokens: number
  }
}

export class StreamJsonDetector implements OutputDetector {
  readonly id = 'stream-json-detector'

  private terminalStates: Map<string, TerminalStreamState> = new Map()

  processOutput(terminalId: string, data: string): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.getOrCreateState(terminalId)

    // Append new data to buffer
    state.buffer += data

    // Split on newlines, keeping incomplete last line in buffer
    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() || '' // Keep the last (potentially incomplete) line

    // Process each complete line
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) continue

      // Strip ANSI codes and attempt to parse as JSON
      const cleanLine = stripAnsi(trimmedLine)

      try {
        const event = JSON.parse(cleanLine) as ClaudeStreamEvent
        const detectedEvents = this.processStreamEvent(terminalId, state, event)
        events.push(...detectedEvents)
      } catch {
        // Not valid JSON, skip this line
        // This is expected for non-JSON output from the CLI
      }
    }

    return events
  }

  onTerminalExit(terminalId: string, exitCode: number): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.terminalStates.get(terminalId)

    console.log(
      `[StreamJsonDetector] onTerminalExit called for terminal ${terminalId}, ` +
        `has state: ${!!state}, messageId: ${state?.messageId || 'none'}`
    )

    // If a message was in progress, emit synthetic message_end
    if (state && state.messageId) {
      events.push({
        terminalId,
        type: 'agent-message-end',
        timestamp: Date.now(),
        data: {
          messageId: state.messageId,
          model: state.model,
          stopReason: 'terminal_exit',
          exitCode,
          usage: state.usage,
        },
      })
      console.log(
        `[StreamJsonDetector] Emitting synthetic agent-message-end for terminal ${terminalId} ` +
          `(terminal exited with code ${exitCode})`
      )
    }

    return events
  }

  cleanup(terminalId: string): void {
    this.terminalStates.delete(terminalId)
    console.log(`[StreamJsonDetector] Cleaned up state for terminal ${terminalId}`)
  }

  private getOrCreateState(terminalId: string): TerminalStreamState {
    let state = this.terminalStates.get(terminalId)
    if (!state) {
      state = {
        buffer: '',
        messageId: null,
        model: null,
        currentBlockIndex: -1,
        currentBlockType: null,
        usage: null,
        stopReason: null,
        lastEventTime: Date.now(),
      }
      this.terminalStates.set(terminalId, state)
    }
    return state
  }

  private processStreamEvent(
    terminalId: string,
    state: TerminalStreamState,
    event: ClaudeStreamEvent
  ): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const timestamp = Date.now()
    state.lastEventTime = timestamp

    console.log(`[StreamJsonDetector] Parsed event: ${event.type}`)

    switch (event.type) {
      case 'message_start':
        if (event.message) {
          state.messageId = event.message.id
          state.model = event.message.model
          state.currentBlockIndex = -1
          state.currentBlockType = null
          state.stopReason = null

          if (event.message.usage) {
            state.usage = {
              inputTokens: event.message.usage.input_tokens,
              outputTokens: event.message.usage.output_tokens,
            }
          }

          events.push({
            terminalId,
            type: 'agent-message-start',
            timestamp,
            data: {
              messageId: state.messageId,
              model: state.model,
              usage: state.usage,
            },
          })
        }
        break

      case 'content_block_start':
        if (event.content_block) {
          state.currentBlockIndex = event.index ?? state.currentBlockIndex + 1
          state.currentBlockType = event.content_block.type

          const blockStartType = this.getBlockStartEventType(event.content_block.type)
          events.push({
            terminalId,
            type: blockStartType,
            timestamp,
            data: {
              messageId: state.messageId,
              blockIndex: state.currentBlockIndex,
              blockType: state.currentBlockType,
              blockId: event.content_block.id,
              toolName: event.content_block.name,
              // Include initial content if present
              text: event.content_block.text,
              thinking: event.content_block.thinking,
            },
          })
        }
        break

      case 'content_block_delta':
        if (event.delta) {
          const deltaType = this.getDeltaEventType(state.currentBlockType, event.delta.type)
          events.push({
            terminalId,
            type: deltaType,
            timestamp,
            data: {
              messageId: state.messageId,
              blockIndex: state.currentBlockIndex,
              blockType: state.currentBlockType,
              text: event.delta.text,
              thinking: event.delta.thinking,
              partialJson: event.delta.partial_json,
            },
          })
        }
        break

      case 'content_block_stop':
        events.push({
          terminalId,
          type: 'agent-block-end',
          timestamp,
          data: {
            messageId: state.messageId,
            blockIndex: state.currentBlockIndex,
            blockType: state.currentBlockType,
          },
        })

        // TODO: Bug #1920 workaround - Track last event time. If content_block_stop
        // received and no events for 5 seconds, consider adding a timeout mechanism
        // to emit a synthetic message end. This would require a timer-based approach
        // that checks state.lastEventTime periodically.
        break

      case 'message_delta':
        if (event.delta) {
          if (event.delta.stop_reason) {
            state.stopReason = event.delta.stop_reason
          }
        }
        if (event.usage) {
          if (state.usage) {
            state.usage.outputTokens = event.usage.output_tokens
          } else {
            state.usage = {
              inputTokens: 0,
              outputTokens: event.usage.output_tokens,
            }
          }
        }
        break

      case 'message_stop':
        events.push({
          terminalId,
          type: 'agent-message-end',
          timestamp,
          data: {
            messageId: state.messageId,
            model: state.model,
            stopReason: state.stopReason,
            usage: state.usage,
          },
        })

        // Reset message state for potential next message
        state.messageId = null
        state.model = null
        state.currentBlockIndex = -1
        state.currentBlockType = null
        state.usage = null
        state.stopReason = null
        break
    }

    return events
  }

  private getBlockStartEventType(blockType: string): string {
    switch (blockType) {
      case 'text':
        return 'agent-text-start'
      case 'thinking':
        return 'agent-thinking-start'
      case 'tool_use':
        return 'agent-tool-start'
      default:
        return 'agent-block-start'
    }
  }

  private getDeltaEventType(blockType: string | null, deltaType: string): string {
    // Use blockType if available for better accuracy
    if (blockType) {
      switch (blockType) {
        case 'text':
          return 'agent-text-delta'
        case 'thinking':
          return 'agent-thinking-delta'
        case 'tool_use':
          return 'agent-tool-input-delta'
      }
    }

    // Fallback to delta type inference
    switch (deltaType) {
      case 'text_delta':
        return 'agent-text-delta'
      case 'thinking_delta':
        return 'agent-thinking-delta'
      case 'input_json_delta':
        return 'agent-tool-input-delta'
      default:
        return 'agent-content-delta'
    }
  }
}
