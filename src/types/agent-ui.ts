/**
 * Generic types for agent message UI that work across all agents
 * (Claude, Gemini, Codex, etc.)
 *
 * This module provides a unified interface for rendering agent messages
 * regardless of the underlying agent implementation.
 */

import type { ReactNode } from 'react'

// =============================================================================
// Content Block Types
// =============================================================================

/**
 * Core content block types - common across all agents
 */
export type ContentBlockType =
  | 'text'
  | 'code'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'image'

/**
 * Base interface for all content blocks
 */
export interface BaseContentBlock {
  /** Unique identifier for this block */
  id: string
  /** The type of content block */
  type: ContentBlockType
  /** Optional timestamp when this block was created */
  timestamp?: number
}

/**
 * Plain text content block
 */
export interface TextBlock extends BaseContentBlock {
  type: 'text'
  /** The text content */
  content: string
  /** Whether this block is currently being streamed */
  isStreaming?: boolean
}

/**
 * Code content block with optional language highlighting
 */
export interface CodeBlock extends BaseContentBlock {
  type: 'code'
  /** The code content */
  content: string
  /** Programming language for syntax highlighting */
  language?: string
}

/**
 * Thinking/reasoning content block (e.g., Claude's extended thinking)
 */
export interface ThinkingBlock extends BaseContentBlock {
  type: 'thinking'
  /** The thinking/reasoning content */
  content: string
  /** Whether this block is currently being streamed */
  isStreaming?: boolean
}

/**
 * Tool use content block - represents an agent invoking a tool
 */
export interface ToolUseBlock extends BaseContentBlock {
  type: 'tool_use'
  /** Unique identifier for this tool invocation */
  toolId: string
  /** Name of the tool being used */
  toolName: string
  /** JSON string of the tool input parameters */
  input: string
  /** Current status of the tool execution */
  status: 'pending' | 'running' | 'completed' | 'error'
}

/**
 * Tool result content block - represents the result of a tool invocation
 */
export interface ToolResultBlock extends BaseContentBlock {
  type: 'tool_result'
  /** ID of the corresponding tool use block */
  toolId: string
  /** The result content (may be truncated for display) */
  result: string
  /** Whether the tool execution resulted in an error */
  isError?: boolean
}

/**
 * Error content block - represents an error in the conversation
 */
export interface ErrorBlock extends BaseContentBlock {
  type: 'error'
  /** Human-readable error message */
  message: string
  /** Optional error code for programmatic handling */
  code?: string
}

/**
 * Image content block - represents an image in the conversation
 */
export interface ImageBlock extends BaseContentBlock {
  type: 'image'
  /** Image source (URL or base64 data) */
  source: string
  /** MIME type of the image */
  mediaType?: string
  /** Alt text for accessibility */
  alt?: string
}

/**
 * Union type of all content block types
 */
export type ContentBlock =
  | TextBlock
  | CodeBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ErrorBlock
  | ImageBlock

// =============================================================================
// Message Types
// =============================================================================

/**
 * Generic agent message that can represent any agent's response
 */
export interface AgentMessage {
  /** Unique identifier for this message */
  id: string
  /** The type of agent that generated this message */
  agentType: string
  /** The role of the message sender */
  role: 'assistant' | 'user' | 'system'
  /** Content blocks that make up this message */
  blocks: ContentBlock[]
  /** Current status of the message */
  status: 'streaming' | 'completed' | 'error'
  /** Unix timestamp when this message was created */
  timestamp: number
  /** Agent-specific metadata (token usage, model info, etc.) */
  metadata?: Record<string, unknown>
}

/**
 * Represents an ongoing conversation with an agent
 */
export interface AgentConversation {
  /** ID of the terminal this conversation belongs to */
  terminalId: string
  /** The type of agent for this conversation */
  agentType: string
  /** All messages in the conversation */
  messages: AgentMessage[]
  /** The message currently being streamed, if any */
  currentMessage: AgentMessage | null
  /** Current status of the conversation */
  status: 'idle' | 'streaming' | 'completed' | 'error'
}

// =============================================================================
// Rendering Types (Composer Pattern)
// =============================================================================

/**
 * Context provided to all render functions
 */
export interface RenderContext {
  /** ID of the terminal being rendered */
  terminalId: string
  /** The type of agent being rendered */
  agentType: string
  /** Whether content is currently streaming */
  isStreaming: boolean
  /** Current theme */
  theme?: 'light' | 'dark'
}

/**
 * Composer interface for agent-specific rendering customization.
 *
 * Agents can provide custom render functions for any content block type.
 * If a renderer is not provided, the default renderer will be used.
 *
 * @example
 * ```typescript
 * const claudeComposer: AgentUIComposer = {
 *   renderThinkingBlock: (block, context) => (
 *     <ClaudeThinkingPanel content={block.content} />
 *   ),
 *   renderMetadata: (metadata) => (
 *     <ClaudeTokenUsage usage={metadata.tokenUsage} />
 *   ),
 * }
 * ```
 */
export interface AgentUIComposer {
  /** Custom renderer for text blocks */
  renderTextBlock?: (block: TextBlock, context: RenderContext) => ReactNode
  /** Custom renderer for code blocks */
  renderCodeBlock?: (block: CodeBlock, context: RenderContext) => ReactNode
  /** Custom renderer for thinking/reasoning blocks */
  renderThinkingBlock?: (block: ThinkingBlock, context: RenderContext) => ReactNode
  /** Custom renderer for tool use blocks */
  renderToolUseBlock?: (block: ToolUseBlock, context: RenderContext) => ReactNode
  /** Custom renderer for tool result blocks */
  renderToolResultBlock?: (block: ToolResultBlock, context: RenderContext) => ReactNode
  /** Custom renderer for error blocks */
  renderErrorBlock?: (block: ErrorBlock, context: RenderContext) => ReactNode
  /** Custom renderer for image blocks */
  renderImageBlock?: (block: ImageBlock, context: RenderContext) => ReactNode
  /** Custom renderer for message header (avatar, name, etc.) */
  renderMessageHeader?: (message: AgentMessage, context: RenderContext) => ReactNode
  /** Custom renderer for message footer (actions, metadata summary, etc.) */
  renderMessageFooter?: (message: AgentMessage, context: RenderContext) => ReactNode
  /** Custom renderer for agent-specific metadata */
  renderMetadata?: (metadata: Record<string, unknown>, context: RenderContext) => ReactNode
}

// =============================================================================
// Token Usage Types
// =============================================================================

/**
 * Common token usage tracking interface.
 *
 * All agents track some form of token usage. This interface provides
 * the common fields, with support for agent-specific fields via
 * index signature.
 */
export interface TokenUsage {
  /** Number of tokens in the input/prompt */
  inputTokens?: number
  /** Number of tokens in the output/response */
  outputTokens?: number
  /** Total tokens used (input + output) */
  totalTokens?: number
  /** Cache-related token counts (if supported) */
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  /** Agent-specific token fields */
  [key: string]: number | undefined
}

// =============================================================================
// Agent Registry Types
// =============================================================================

/**
 * Known agent types. Extensible via string for custom agents.
 */
export type AgentType = 'claude' | 'gemini' | 'codex' | string

/**
 * Configuration for registering an agent with the UI system.
 *
 * @example
 * ```typescript
 * const claudeConfig: AgentConfig = {
 *   type: 'claude',
 *   displayName: 'Claude',
 *   icon: 'claude-icon',
 *   composer: claudeComposer,
 * }
 * ```
 */
export interface AgentConfig {
  /** Unique identifier for this agent type */
  type: AgentType
  /** Human-readable display name */
  displayName: string
  /** Optional icon identifier or path */
  icon?: string
  /** Optional custom UI composer for this agent */
  composer?: AgentUIComposer
  /** Agent-specific configuration options */
  options?: Record<string, unknown>
}

/**
 * Registry of all configured agents
 */
export type AgentRegistry = Map<AgentType, AgentConfig>

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Type guard to check if a content block is a TextBlock
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text'
}

/**
 * Type guard to check if a content block is a CodeBlock
 */
export function isCodeBlock(block: ContentBlock): block is CodeBlock {
  return block.type === 'code'
}

/**
 * Type guard to check if a content block is a ThinkingBlock
 */
export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking'
}

/**
 * Type guard to check if a content block is a ToolUseBlock
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use'
}

/**
 * Type guard to check if a content block is a ToolResultBlock
 */
export function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result'
}

/**
 * Type guard to check if a content block is an ErrorBlock
 */
export function isErrorBlock(block: ContentBlock): block is ErrorBlock {
  return block.type === 'error'
}

/**
 * Type guard to check if a content block is an ImageBlock
 */
export function isImageBlock(block: ContentBlock): block is ImageBlock {
  return block.type === 'image'
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a unique ID for content blocks and messages
 */
export function createBlockId(): string {
  return `block_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Creates a new text block
 */
export function createTextBlock(content: string, isStreaming = false): TextBlock {
  return {
    id: createBlockId(),
    type: 'text',
    content,
    isStreaming,
    timestamp: Date.now(),
  }
}

/**
 * Creates a new code block
 */
export function createCodeBlock(content: string, language?: string): CodeBlock {
  return {
    id: createBlockId(),
    type: 'code',
    content,
    language,
    timestamp: Date.now(),
  }
}

/**
 * Creates a new tool use block
 */
export function createToolUseBlock(
  toolId: string,
  toolName: string,
  input: string | Record<string, unknown>,
  status: ToolUseBlock['status'] = 'pending'
): ToolUseBlock {
  return {
    id: createBlockId(),
    type: 'tool_use',
    toolId,
    toolName,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    status,
    timestamp: Date.now(),
  }
}

/**
 * Creates a new tool result block
 */
export function createToolResultBlock(
  toolId: string,
  result: string,
  isError = false
): ToolResultBlock {
  return {
    id: createBlockId(),
    type: 'tool_result',
    toolId,
    result,
    isError,
    timestamp: Date.now(),
  }
}

/**
 * Creates a new agent message
 */
export function createAgentMessage(
  agentType: string,
  role: AgentMessage['role'],
  blocks: ContentBlock[] = [],
  status: AgentMessage['status'] = 'streaming'
): AgentMessage {
  return {
    id: createBlockId(),
    agentType,
    role,
    blocks,
    status,
    timestamp: Date.now(),
  }
}

/**
 * Creates a new agent conversation
 */
export function createAgentConversation(
  terminalId: string,
  agentType: string
): AgentConversation {
  return {
    terminalId,
    agentType,
    messages: [],
    currentMessage: null,
    status: 'idle',
  }
}
