/**
 * StreamJsonDetector - Parses Claude CLI NDJSON streaming output
 * Detects and emits events from Claude's streaming JSON responses
 */

import { OutputDetector, DetectedEvent } from './output-detector'
import { stripAnsi, extractCompleteJsonObjects } from './pty-json-utils'

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
  /** Message IDs that have been fully processed via the streaming path (message_start -> message_stop). */
  processedMessageIds: Set<string>
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

    // Strip ANSI codes first, then append to buffer
    const cleanData = stripAnsi(data)
    state.buffer += cleanData

    // Extract complete JSON objects using brace-matching
    // This handles PTY corruption where newlines are inserted mid-JSON
    const { jsonObjects, remaining } = extractCompleteJsonObjects(state.buffer)
    state.buffer = remaining

    // Process each extracted JSON object
    for (const jsonStr of jsonObjects) {
      try {
        const parsed = JSON.parse(jsonStr)

        // Handle Claude CLI's stream_event wrapper format:
        // {"type":"stream_event","event":{"type":"message_start",...}}
        let event: ClaudeStreamEvent
        if (parsed.type === 'stream_event' && parsed.event) {
          event = parsed.event as ClaudeStreamEvent
        } else {
          event = parsed as ClaudeStreamEvent
        }

        const detectedEvents = this.processStreamEvent(terminalId, state, event)
        events.push(...detectedEvents)
      } catch (e) {
        // Failed to parse JSON - skip silently
      }
    }

    return events
  }

  onTerminalExit(terminalId: string, exitCode: number): DetectedEvent[] {
    const events: DetectedEvent[] = []
    const state = this.terminalStates.get(terminalId)

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
    }

    // Always emit process exit event so the renderer can clear activity state.
    // This fires regardless of whether a message was in progress.
    events.push({
      terminalId,
      type: 'agent-process-exit',
      timestamp: Date.now(),
      data: {
        exitCode,
      },
    })

    return events
  }

  cleanup(terminalId: string): void {
    this.terminalStates.delete(terminalId)
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
        processedMessageIds: new Set(),
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
              // Use 'toolId' and 'name' to match AgentToolStartData interface
              // (print-mode 'assistant' path already uses these field names)
              toolId: event.content_block.id,
              name: event.content_block.name,
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

        // Track this message ID so the duplicate `assistant` print-mode event is skipped
        if (state.messageId) {
          state.processedMessageIds.add(state.messageId)
        }

        // Reset message state for potential next message
        state.messageId = null
        state.model = null
        state.currentBlockIndex = -1
        state.currentBlockType = null
        state.usage = null
        state.stopReason = null
        break

      // ========================================
      // Claude CLI Print Mode Events
      // These provide complete content blocks (not streaming deltas)
      // ========================================

      case 'system': {
        // System events carry session lifecycle info (init, compaction, etc.)
        const sysEvent = event as unknown as { subtype?: string; session_id?: string; model?: string }
        if (sysEvent.subtype === 'init' && sysEvent.session_id) {
          state.messageId = sysEvent.session_id
          state.model = sysEvent.model || null
          // Emit session init event so the renderer can capture the session_id
          events.push({
            terminalId,
            type: 'agent-session-init',
            timestamp,
            data: {
              sessionId: sysEvent.session_id,
              model: sysEvent.model || '',
            },
          })
        } else if (sysEvent.subtype && sysEvent.subtype !== 'init') {
          // Forward non-init system events (e.g. compaction) to the renderer
          events.push({
            terminalId,
            type: 'agent-system-event',
            timestamp,
            data: {
              subtype: sysEvent.subtype,
            },
          })
        }
        break
      }

      case 'assistant': {
        // Assistant message with complete content - emit as full message.
        // Claude CLI may emit BOTH streaming events (message_start/content_block_*/message_stop)
        // AND a complete `assistant` event for the same message. Skip the duplicate.
        const assistantEvent = event as unknown as {
          message?: {
            id?: string
            model?: string
            content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>
            stop_reason?: string
            usage?: { input_tokens?: number; output_tokens?: number }
          }
          session_id?: string
        }

        if (assistantEvent.message) {
          const msgId = assistantEvent.message.id

          // Skip if this message was already fully processed via streaming, OR if
          // streaming is currently in progress for this message. The CLI emits both
          // streaming events and a complete 'assistant' event. When the 'assistant'
          // event arrives mid-stream (between message_delta and message_stop), its
          // state reset (messageId=null, stopReason=null, etc.) corrupts the
          // streaming state, causing message_stop to emit stopReason=null.
          if (msgId && (
            state.processedMessageIds.has(msgId) ||
            state.messageId === msgId
          )) {
            break
          }
          const msg = assistantEvent.message
          state.messageId = msg.id || state.messageId
          state.model = msg.model || state.model

          // Emit message start
          events.push({
            terminalId,
            type: 'agent-message-start',
            timestamp,
            data: {
              messageId: state.messageId,
              model: state.model,
              usage: msg.usage ? {
                inputTokens: msg.usage.input_tokens || 0,
                outputTokens: msg.usage.output_tokens || 0,
              } : undefined,
            },
          })

          // Process each content block
          const content = msg.content || []
          content.forEach((block, index) => {
            if (block.type === 'text' && block.text) {
              // Emit text block as a single delta (complete content)
              events.push({
                terminalId,
                type: 'agent-text-delta',
                timestamp,
                data: {
                  messageId: state.messageId,
                  blockIndex: index,
                  blockType: 'text',
                  text: block.text,
                },
              })
            } else if (block.type === 'thinking' && block.thinking) {
              // Emit thinking block
              events.push({
                terminalId,
                type: 'agent-thinking-delta',
                timestamp,
                data: {
                  messageId: state.messageId,
                  blockIndex: index,
                  blockType: 'thinking',
                  thinking: block.thinking,
                },
              })
            } else if (block.type === 'tool_use') {
              // Emit tool use block
              events.push({
                terminalId,
                type: 'agent-tool-start',
                timestamp,
                data: {
                  messageId: state.messageId,
                  blockIndex: index,
                  toolId: block.id,
                  name: block.name,
                },
              })
              if (block.input) {
                events.push({
                  terminalId,
                  type: 'agent-tool-input-delta',
                  timestamp,
                  data: {
                    messageId: state.messageId,
                    blockIndex: index,
                    partialJson: JSON.stringify(block.input),
                  },
                })
              }
            }
          })

          // Emit message end
          events.push({
            terminalId,
            type: 'agent-message-end',
            timestamp,
            data: {
              messageId: state.messageId,
              model: state.model,
              stopReason: msg.stop_reason,
              usage: msg.usage ? {
                inputTokens: msg.usage.input_tokens || 0,
                outputTokens: msg.usage.output_tokens || 0,
              } : undefined,
            },
          })

          // Reset message state so onTerminalExit doesn't emit a spurious synthetic agent-message-end
          state.messageId = null
          state.model = null
          state.currentBlockIndex = -1
          state.currentBlockType = null
          state.usage = null
          state.stopReason = null
        }
        break
      }

      case 'user': {
        // User message containing tool_result blocks — extract error status
        const userEvent = event as unknown as {
          message?: {
            role?: string
            content?: Array<{
              type: string
              tool_use_id?: string
              content?: string | Array<{ type: string; text?: string }>
              is_error?: boolean
            }>
          }
        }
        if (userEvent.message?.content) {
          for (const block of userEvent.message.content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              // Extract result text from content (may be string or array of text blocks)
              let resultText = ''
              if (typeof block.content === 'string') {
                resultText = block.content
              } else if (Array.isArray(block.content)) {
                resultText = block.content
                  .filter((c) => c.type === 'text' && c.text)
                  .map((c) => c.text)
                  .join('\n')
              }
              events.push({
                terminalId,
                type: 'agent-tool-result',
                timestamp,
                data: {
                  toolId: block.tool_use_id,
                  result: resultText,
                  isError: !!block.is_error,
                },
              })
            }
          }
        }
        break
      }

      case 'result': {
        // Result event - final summary with cost and usage data
        const resultEvent = event as unknown as {
          subtype?: string
          result?: string
          total_cost_usd?: number
          duration_ms?: number
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
        }
        if (resultEvent.subtype === 'success' || resultEvent.subtype === 'error') {
          events.push({
            terminalId,
            type: 'agent-session-result',
            timestamp,
            data: {
              subtype: resultEvent.subtype,
              totalCostUsd: resultEvent.total_cost_usd,
              durationMs: resultEvent.duration_ms,
              usage: resultEvent.usage ? {
                inputTokens: resultEvent.usage.input_tokens ?? 0,
                outputTokens: resultEvent.usage.output_tokens ?? 0,
                cacheReadInputTokens: resultEvent.usage.cache_read_input_tokens,
                cacheCreationInputTokens: resultEvent.usage.cache_creation_input_tokens,
              } : undefined,
            },
          })
        }
        break
      }
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
