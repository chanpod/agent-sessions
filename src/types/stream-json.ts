/**
 * TypeScript types for Claude CLI stream-json events
 *
 * The Claude CLI with `--output-format stream-json` emits NDJSON (newline-delimited JSON)
 * with various event types representing the streaming response structure.
 */

// =============================================================================
// Raw Claude CLI Event Types (what comes directly from the CLI)
// =============================================================================

/**
 * Base interface for all raw Claude CLI stream events
 */
export interface ClaudeStreamEventBase {
  type: string
}

/**
 * Message start event - contains message metadata
 */
export interface ClaudeMessageStartEvent extends ClaudeStreamEventBase {
  type: 'message_start'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    model: string
    content: []
    stop_reason: null
    stop_sequence: null
    usage: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

/**
 * Content block types supported by Claude
 */
export type ClaudeContentBlockType = 'text' | 'tool_use' | 'thinking'

/**
 * Text content block start
 */
export interface ClaudeTextBlockStart {
  type: 'text'
  text: string
}

/**
 * Tool use content block start
 */
export interface ClaudeToolUseBlockStart {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Thinking content block start (extended thinking)
 */
export interface ClaudeThinkingBlockStart {
  type: 'thinking'
  thinking: string
}

/**
 * Union of all content block start types
 */
export type ClaudeContentBlock =
  | ClaudeTextBlockStart
  | ClaudeToolUseBlockStart
  | ClaudeThinkingBlockStart

/**
 * Content block start event - signals the beginning of a content block
 */
export interface ClaudeContentBlockStartEvent extends ClaudeStreamEventBase {
  type: 'content_block_start'
  index: number
  content_block: ClaudeContentBlock
}

/**
 * Text delta - incremental text content
 */
export interface ClaudeTextDelta {
  type: 'text_delta'
  text: string
}

/**
 * Input JSON delta - incremental tool input (partial JSON string)
 */
export interface ClaudeInputJsonDelta {
  type: 'input_json_delta'
  partial_json: string
}

/**
 * Thinking delta - incremental thinking content
 */
export interface ClaudeThinkingDelta {
  type: 'thinking_delta'
  thinking: string
}

/**
 * Union of all delta types
 */
export type ClaudeContentDelta =
  | ClaudeTextDelta
  | ClaudeInputJsonDelta
  | ClaudeThinkingDelta

/**
 * Content block delta event - incremental content updates
 */
export interface ClaudeContentBlockDeltaEvent extends ClaudeStreamEventBase {
  type: 'content_block_delta'
  index: number
  delta: ClaudeContentDelta
}

/**
 * Content block stop event - signals end of a content block
 */
export interface ClaudeContentBlockStopEvent extends ClaudeStreamEventBase {
  type: 'content_block_stop'
  index: number
}

/**
 * Stop reasons for message completion
 */
export type ClaudeStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'

/**
 * Message delta event - message-level updates
 */
export interface ClaudeMessageDeltaEvent extends ClaudeStreamEventBase {
  type: 'message_delta'
  delta: {
    stop_reason: ClaudeStopReason
    stop_sequence: string | null
  }
  usage: {
    output_tokens: number
  }
}

/**
 * Message stop event - final event signaling completion
 */
export interface ClaudeMessageStopEvent extends ClaudeStreamEventBase {
  type: 'message_stop'
}

/**
 * Error event - emitted when an error occurs
 */
export interface ClaudeErrorEvent extends ClaudeStreamEventBase {
  type: 'error'
  error: {
    type: string
    message: string
  }
}

/**
 * Ping event - keep-alive signal
 */
export interface ClaudePingEvent extends ClaudeStreamEventBase {
  type: 'ping'
}

/**
 * Union of all raw Claude CLI stream events
 */
export type ClaudeStreamEvent =
  | ClaudeMessageStartEvent
  | ClaudeContentBlockStartEvent
  | ClaudeContentBlockDeltaEvent
  | ClaudeContentBlockStopEvent
  | ClaudeMessageDeltaEvent
  | ClaudeMessageStopEvent
  | ClaudeErrorEvent
  | ClaudePingEvent

/**
 * Type guard to check if an event is a message start event
 */
export function isMessageStartEvent(
  event: ClaudeStreamEvent
): event is ClaudeMessageStartEvent {
  return event.type === 'message_start'
}

/**
 * Type guard to check if an event is a content block start event
 */
export function isContentBlockStartEvent(
  event: ClaudeStreamEvent
): event is ClaudeContentBlockStartEvent {
  return event.type === 'content_block_start'
}

/**
 * Type guard to check if an event is a content block delta event
 */
export function isContentBlockDeltaEvent(
  event: ClaudeStreamEvent
): event is ClaudeContentBlockDeltaEvent {
  return event.type === 'content_block_delta'
}

/**
 * Type guard to check if an event is a content block stop event
 */
export function isContentBlockStopEvent(
  event: ClaudeStreamEvent
): event is ClaudeContentBlockStopEvent {
  return event.type === 'content_block_stop'
}

/**
 * Type guard to check if an event is a message delta event
 */
export function isMessageDeltaEvent(
  event: ClaudeStreamEvent
): event is ClaudeMessageDeltaEvent {
  return event.type === 'message_delta'
}

/**
 * Type guard to check if an event is a message stop event
 */
export function isMessageStopEvent(
  event: ClaudeStreamEvent
): event is ClaudeMessageStopEvent {
  return event.type === 'message_stop'
}

/**
 * Type guard to check if an event is an error event
 */
export function isErrorEvent(
  event: ClaudeStreamEvent
): event is ClaudeErrorEvent {
  return event.type === 'error'
}

// =============================================================================
// Parsed/Semantic Event Types (what our detector emits)
// =============================================================================

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

/**
 * Agent message start event data
 */
export interface AgentMessageStartData {
  messageId: string
  model: string
  usage?: TokenUsage
}

/**
 * Agent session result event data (from the CLI 'result' event at end of turn)
 */
export interface AgentSessionResultData {
  subtype: 'success' | 'error'
  totalCostUsd?: number
  durationMs?: number
  usage?: TokenUsage
}

/**
 * Agent text delta event data
 */
export interface AgentTextDeltaData {
  text: string
  blockIndex: number
}

/**
 * Agent thinking delta event data
 */
export interface AgentThinkingDeltaData {
  text: string
  blockIndex: number
}

/**
 * Agent tool start event data
 */
export interface AgentToolStartData {
  toolId: string
  name: string
  blockIndex: number
}

/**
 * Agent tool input delta event data
 */
export interface AgentToolInputDeltaData {
  partialJson: string
  blockIndex: number
}

/**
 * Agent tool end event data
 */
export interface AgentToolEndData {
  blockIndex: number
}

/**
 * Agent message end event data
 */
export interface AgentMessageEndData {
  stopReason: ClaudeStopReason | string
  usage: TokenUsage
}

/**
 * Agent error event data
 */
export interface AgentErrorData {
  errorType: string
  message: string
}

/**
 * Union type of all agent stream events (parsed/semantic events)
 */
export type AgentStreamEvent =
  | { type: 'agent-message-start'; data: AgentMessageStartData }
  | { type: 'agent-text-delta'; data: AgentTextDeltaData }
  | { type: 'agent-thinking-delta'; data: AgentThinkingDeltaData }
  | { type: 'agent-tool-start'; data: AgentToolStartData }
  | { type: 'agent-tool-input-delta'; data: AgentToolInputDeltaData }
  | { type: 'agent-tool-end'; data: AgentToolEndData }
  | { type: 'agent-block-end'; data: AgentToolEndData }
  | { type: 'agent-message-end'; data: AgentMessageEndData }
  | { type: 'agent-session-result'; data: AgentSessionResultData }
  | { type: 'agent-error'; data: AgentErrorData }

/**
 * Event type literal union for type-safe event handling
 */
export type AgentStreamEventType = AgentStreamEvent['type']

/**
 * Helper type to extract data type for a specific event type
 */
export type AgentStreamEventData<T extends AgentStreamEventType> = Extract<
  AgentStreamEvent,
  { type: T }
>['data']

// =============================================================================
// State Types (for the store)
// =============================================================================

/**
 * Content block types in our state
 */
export type ContentBlockType = 'text' | 'thinking' | 'tool_use'

/**
 * A content block representing a piece of the agent's response
 */
export interface ContentBlock {
  /** Type of content block */
  type: ContentBlockType
  /** The accumulated content (text, thinking text, or tool input JSON) */
  content: string
  /** Tool ID (only for tool_use blocks) */
  toolId?: string
  /** Tool name (only for tool_use blocks) */
  toolName?: string
  /** Accumulated tool input JSON string (only for tool_use blocks) */
  toolInput?: string
  /** Whether this block is complete */
  isComplete?: boolean
}

/**
 * Message status in the streaming lifecycle
 */
export type AgentMessageStatus = 'streaming' | 'completed' | 'error'

/**
 * An agent message containing all content blocks and metadata
 */
export interface AgentMessage {
  /** Unique message ID from Claude */
  id: string
  /** Model that generated the message */
  model: string
  /** Content blocks in this message */
  blocks: ContentBlock[]
  /** Token usage for this message */
  usage?: TokenUsage
  /** Reason the message stopped */
  stopReason?: ClaudeStopReason | string
  /** Current status of the message */
  status: AgentMessageStatus
  /** Timestamp when message started */
  startedAt: number
  /** Timestamp when message completed */
  completedAt?: number
}

/**
 * A debug event entry captured from the raw detector event stream.
 * Used by the DebugEventLog panel to visualize event flow.
 */
export interface DebugEventEntry {
  /** Monotonic index for ordering */
  index: number
  /** Event type (e.g. 'agent-message-start', 'agent-process-exit') */
  type: string
  /** Timestamp of the event */
  timestamp: number
  /** Key details extracted from event.data (kept small to avoid memory bloat) */
  summary: string
  /** Current isActive value AFTER this event was processed */
  isActiveAfter: boolean
  /** Current processExited value AFTER this event was processed */
  processExitedAfter: boolean
}

/**
 * State for a terminal's agent interaction
 */
export interface TerminalAgentState {
  /** The currently streaming message (null if not streaming) */
  currentMessage: AgentMessage | null
  /** History of completed messages */
  messages: AgentMessage[]
  /** Whether the agent is currently active/streaming */
  isActive: boolean
  /** Whether we're waiting for the agent to start responding (message sent, no response yet) */
  isWaitingForResponse: boolean
  /** Whether the agent used AskUserQuestion and we're waiting for the user to answer.
   *  The PreToolUse hook denies this tool so the CLI doesn't auto-resolve it;
   *  the app renders a QuestionCard and delivers the answer via --resume. */
  isWaitingForQuestion: boolean
  /** Whether the backing PTY process has exited. Used as a safety-net: even if isActive
   *  is incorrectly cleared during tool execution, we know the agent isn't done until
   *  the process actually exits. */
  processExited: boolean
  /** Exit code of the backing process, if exited. Non-zero indicates an error. */
  exitCode?: number | null
  /** Error message if something went wrong */
  error?: string
  /** Debug event log for the DebugEventLog panel (capped at 200 entries) */
  debugEvents?: DebugEventEntry[]
}

/**
 * Initial state for a terminal's agent state
 */
export const initialTerminalAgentState: TerminalAgentState = {
  currentMessage: null,
  messages: [],
  isActive: false,
  isWaitingForResponse: false,
  isWaitingForQuestion: false,
  processExited: false,
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Parser state for tracking NDJSON parsing across chunks
 */
export interface StreamParserState {
  /** Buffer for incomplete lines */
  buffer: string
  /** Current block index being processed */
  currentBlockIndex: number
  /** Whether we've received a message_start */
  hasStarted: boolean
  /** Whether we've received a message_stop */
  hasEnded: boolean
}

/**
 * Initial parser state
 */
export const initialStreamParserState: StreamParserState = {
  buffer: '',
  currentBlockIndex: -1,
  hasStarted: false,
  hasEnded: false,
}

/**
 * Result of parsing a chunk of NDJSON data
 */
export interface ParseChunkResult {
  /** Parsed events from the chunk */
  events: AgentStreamEvent[]
  /** Updated parser state */
  state: StreamParserState
  /** Any errors encountered during parsing */
  errors: Error[]
}
