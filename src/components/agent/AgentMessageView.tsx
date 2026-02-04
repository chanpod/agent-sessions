import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import {
  IconLoader2,
  IconUser,
  IconSettings,
  IconActivity,
  IconBolt,
  IconTerminal2,
  IconSparkles,
} from '@tabler/icons-react'

import type {
  AgentConversation,
  AgentMessage,
  AgentUIComposer,
  RenderContext,
  ContentBlock,
  TextBlock,
  CodeBlock,
  ThinkingBlock as ThinkingBlockType,
  ToolUseBlock,
  ToolResultBlock,
  ErrorBlock,
  ImageBlock,
} from '@/types/agent-ui'
import type { TokenUsage } from '@/types/stream-json'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBlock } from '@/components/agent/MessageBlock'
import { ThinkingInline } from '@/components/agent/ThinkingInline'
import { ToolCallInline } from '@/components/agent/ToolCallInline'
import { ContextUsageIndicator } from '@/components/agent/ContextUsageIndicator'
import { cn } from '@/lib/utils'

// =============================================================================
// Types
// =============================================================================

interface AgentMessageViewProps {
  conversation: AgentConversation
  composer?: AgentUIComposer
  className?: string
  autoScroll?: boolean
  agentType?: string
}

interface DefaultBlockRendererProps {
  block: ContentBlock
  context: RenderContext
  composer?: AgentUIComposer
  toolResults?: Map<string, ToolResultBlock>
}

// Group of tool blocks (tool_use + optional tool_result)
interface ToolGroup {
  toolUse: ToolUseBlock
  toolResult?: ToolResultBlock
}

// A "turn" groups consecutive assistant messages into one logical unit
interface AssistantTurn {
  kind: 'assistant-turn'
  messages: AgentMessage[]
  activityBlocks: (ContentBlock | ToolGroup)[]
  responseBlocks: ContentBlock[]
  toolResults: Map<string, ToolResultBlock>
  cumulativeUsage: TokenUsage
  isStreaming: boolean
  latestModel?: string
}

interface StandaloneMessage {
  kind: 'standalone'
  message: AgentMessage
  cumulativeUsage: TokenUsage
}

type DisplayItem = AssistantTurn | StandaloneMessage

// =============================================================================
// Helper Functions
// =============================================================================

/** Block types that count as "activity" (tool chain) vs "response" (actual reply) */
const ACTIVITY_TYPES = new Set(['tool_use', 'tool_result', 'thinking'])

function isActivityBlock(block: ContentBlock): boolean {
  return ACTIVITY_TYPES.has(block.type)
}

/**
 * Check if a grouped item is a ToolGroup
 */
function isToolGroup(item: ContentBlock | ToolGroup): item is ToolGroup {
  return 'toolUse' in item
}

/**
 * Groups consecutive assistant messages into turns, leaves user/system as standalone.
 * Also splits each turn's blocks into activity (tools, thinking) and response (text, code, etc.)
 */
function groupIntoDisplayItems(allMessages: AgentMessage[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let cumulativeUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  let currentTurnMessages: AgentMessage[] = []

  function flushTurn() {
    if (currentTurnMessages.length === 0) return

    // Collect all blocks from all messages in this turn
    const allBlocks: ContentBlock[] = []
    const toolResultMap = new Map<string, ToolResultBlock>()
    let latestModel: string | undefined
    let isStreaming = false

    for (const msg of currentTurnMessages) {
      for (const block of msg.blocks) {
        allBlocks.push(block)
        if (block.type === 'tool_result') {
          toolResultMap.set(block.toolId, block)
        }
      }
      const model = msg.metadata?.model as string | undefined
      if (model) latestModel = model
      if (msg.status === 'streaming') isStreaming = true
    }

    // Split into activity blocks (with tool grouping) and response blocks
    const activityBlocks: (ContentBlock | ToolGroup)[] = []
    const responseBlocks: ContentBlock[] = []

    for (const block of allBlocks) {
      if (block.type === 'tool_use') {
        const toolResult = toolResultMap.get(block.toolId)
        activityBlocks.push({ toolUse: block, toolResult })
      } else if (block.type === 'tool_result') {
        // Skip - grouped with tool_use above
        continue
      } else if (isActivityBlock(block)) {
        activityBlocks.push(block)
      } else {
        responseBlocks.push(block)
      }
    }

    items.push({
      kind: 'assistant-turn',
      messages: currentTurnMessages,
      activityBlocks,
      responseBlocks,
      toolResults: toolResultMap,
      cumulativeUsage: { ...cumulativeUsage },
      isStreaming,
      latestModel,
    })

    currentTurnMessages = []
  }

  for (const msg of allMessages) {
    const usage = msg.metadata?.usage as TokenUsage | undefined
    if (usage) {
      cumulativeUsage = {
        inputTokens: cumulativeUsage.inputTokens + (usage.inputTokens || 0),
        outputTokens: cumulativeUsage.outputTokens + (usage.outputTokens || 0),
      }
    }

    if (msg.role === 'assistant') {
      currentTurnMessages.push(msg)
    } else {
      // Flush any pending assistant turn before a user/system message
      flushTurn()
      items.push({
        kind: 'standalone',
        message: msg,
        cumulativeUsage: { ...cumulativeUsage },
      })
    }
  }

  // Flush remaining assistant messages
  flushTurn()

  return items
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * AgentMessageView - Main container that renders an agent conversation
 *
 * Features:
 * - Renders all messages in a conversation
 * - Groups consecutive assistant messages into unified "turns"
 * - Splits turns into activity box (tools) and response box (text)
 * - Supports composer pattern for custom rendering
 * - Auto-scrolls to bottom when streaming
 */
export function AgentMessageView({
  conversation,
  composer,
  className,
  autoScroll = true,
  agentType,
}: AgentMessageViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isStreaming = conversation.status === 'streaming'
  const [isAtBottom, setIsAtBottom] = useState(true)
  const skipNextScrollCheck = useRef(false)

  // Build render context
  const context: RenderContext = useMemo(
    () => ({
      terminalId: conversation.terminalId,
      agentType: conversation.agentType,
      isStreaming,
      theme: 'dark',
    }),
    [conversation.terminalId, conversation.agentType, isStreaming]
  )

  // Combine completed messages with current streaming message
  const allMessages = useMemo(() => {
    const messages = [...conversation.messages]
    if (conversation.currentMessage) {
      messages.push(conversation.currentMessage)
    }
    return messages
  }, [conversation.messages, conversation.currentMessage])

  // Group into display items (turns + standalone messages)
  const displayItems = useMemo(
    () => groupIntoDisplayItems(allMessages),
    [allMessages]
  )

  // Handle scroll events to detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (skipNextScrollCheck.current) {
      skipNextScrollCheck.current = false
      return
    }
    if (!scrollRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const threshold = 50
    const atBottom = scrollHeight - scrollTop - clientHeight < threshold
    setIsAtBottom(atBottom)
  }, [])

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (autoScroll && isAtBottom && scrollRef.current) {
      skipNextScrollCheck.current = true
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [autoScroll, isAtBottom, allMessages, conversation.currentMessage?.blocks])

  // Reset to bottom when streaming starts
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      setIsAtBottom(true)
      skipNextScrollCheck.current = true
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isStreaming])

  const hasMessages = displayItems.length > 0

  return (
    <ScrollArea
      className={cn('h-full', className)}
      viewportRef={scrollRef}
      onScroll={handleScroll}
    >
      {!hasMessages && !isStreaming ? (
        <WelcomeScreen agentType={agentType} />
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-6">
          <div className="flex flex-col gap-5">
            {displayItems.map((item) => {
              if (item.kind === 'standalone') {
                return (
                  <StandaloneMessageRenderer
                    key={item.message.id}
                    message={item.message}
                    context={context}
                    composer={composer}
                    cumulativeUsage={item.cumulativeUsage}
                  />
                )
              }

              return (
                <AssistantTurnRenderer
                  key={item.messages[0]?.id ?? 'turn'}
                  turn={item}
                  context={context}
                  composer={composer}
                />
              )
            })}

            {isStreaming && <StreamingIndicator />}
          </div>
        </div>
      )}
    </ScrollArea>
  )
}

// =============================================================================
// Assistant Turn Renderer (Activity Box + Response Box)
// =============================================================================

function AssistantTurnRenderer({
  turn,
  context,
  composer,
}: {
  turn: AssistantTurn
  context: RenderContext
  composer?: AgentUIComposer
}) {
  const hasActivity = turn.activityBlocks.length > 0
  const hasResponse = turn.responseBlocks.length > 0

  const showContextUsage = turn.latestModel && turn.cumulativeUsage &&
    (turn.cumulativeUsage.inputTokens > 0 || turn.cumulativeUsage.outputTokens > 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Activity Box - tool calls, thinking */}
      {hasActivity && (
        <div
          className={cn(
            'flex flex-col gap-1',
            'rounded-lg border border-border/30',
            'bg-muted/10 px-3 py-2.5',
          )}
        >
          {/* Activity header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconActivity className="size-3.5 text-muted-foreground/60" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Activity
              </span>
              {turn.isStreaming && (
                <IconLoader2 className="size-3 animate-spin text-primary/60" />
              )}
            </div>
            {showContextUsage && !hasResponse && (
              <ContextUsageIndicator
                model={turn.latestModel!}
                usage={turn.cumulativeUsage}
                showTokens={true}
              />
            )}
          </div>

          {/* Activity items */}
          <div className="flex flex-col gap-0.5 pl-5">
            {turn.activityBlocks.map((item) => {
              if (isToolGroup(item)) {
                return (
                  <ToolCallInline
                    key={item.toolUse.id}
                    toolUse={item.toolUse}
                    toolResult={item.toolResult}
                  />
                )
              }
              // Thinking blocks
              if (item.type === 'thinking') {
                return (
                  <ThinkingInline
                    key={item.id}
                    block={item as ThinkingBlockType}
                  />
                )
              }
              return null
            })}
          </div>
        </div>
      )}

      {/* Response Box - text, code, images, errors */}
      {hasResponse && (
        <div className="flex flex-col gap-2">
          {/* Response header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-full bg-primary/15">
                <IconSparkles className="size-3.5 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground">
                Assistant
              </span>
              {turn.isStreaming && (
                <IconLoader2 className="size-3 animate-spin text-muted-foreground" />
              )}
            </div>
            {showContextUsage && (
              <ContextUsageIndicator
                model={turn.latestModel!}
                usage={turn.cumulativeUsage}
                showTokens={true}
              />
            )}
          </div>

          {/* Response content */}
          <div className="flex flex-col gap-3 pl-8">
            {turn.responseBlocks.map((block) => (
              <DefaultBlockRenderer
                key={block.id}
                block={block}
                context={context}
                composer={composer}
                toolResults={turn.toolResults}
              />
            ))}
          </div>
        </div>
      )}

      {/* If only activity and still streaming, show that we're waiting */}
      {hasActivity && !hasResponse && turn.isStreaming && (
        <div className="flex items-center gap-2 pl-1">
          <div className="flex size-6 items-center justify-center rounded-full bg-primary/15">
            <IconSparkles className="size-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-foreground">
            Assistant
          </span>
          <IconLoader2 className="size-3 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Standalone Message Renderer (user/system messages)
// =============================================================================

function StandaloneMessageRenderer({
  message,
  context,
  composer,
  cumulativeUsage,
}: {
  message: AgentMessage
  context: RenderContext
  composer?: AgentUIComposer
  cumulativeUsage?: TokenUsage
}) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        isUser && 'items-end',
      )}
    >
      {isUser ? (
        // User message - bubble style, right-aligned
        <div className="max-w-[85%]">
          <div
            className={cn(
              'rounded-2xl rounded-br-md',
              'bg-primary/15 px-4 py-2.5',
            )}
          >
            <div className="flex flex-col gap-2">
              {message.blocks.map((block) => (
                <DefaultBlockRenderer
                  key={block.id}
                  block={block}
                  context={context}
                  composer={composer}
                />
              ))}
            </div>
          </div>
        </div>
      ) : isSystem ? (
        // System message - subtle centered
        <div className="w-full">
          <div
            className={cn(
              'flex flex-col gap-1.5',
              'rounded-lg border border-yellow-500/20',
              'bg-yellow-500/5 px-3 py-2',
            )}
          >
            {composer?.renderMessageHeader ? (
              composer.renderMessageHeader(message, context)
            ) : (
              <DefaultMessageHeader message={message} cumulativeUsage={cumulativeUsage} />
            )}
            <div className="flex flex-col gap-2 pl-8">
              {message.blocks.map((block) => (
                <DefaultBlockRenderer
                  key={block.id}
                  block={block}
                  context={context}
                  composer={composer}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        // Other messages - default card
        <div className="w-full">
          <div
            className={cn(
              'flex flex-col gap-1.5',
              'rounded-lg border border-border/30',
              'bg-card/10 px-3 py-2',
            )}
          >
            {composer?.renderMessageHeader ? (
              composer.renderMessageHeader(message, context)
            ) : (
              <DefaultMessageHeader message={message} cumulativeUsage={cumulativeUsage} />
            )}
            <div className="flex flex-col gap-2 pl-8">
              {message.blocks.map((block) => (
                <DefaultBlockRenderer
                  key={block.id}
                  block={block}
                  context={context}
                  composer={composer}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {composer?.renderMessageFooter?.(message, context)}
    </div>
  )
}

// =============================================================================
// Default Renderers
// =============================================================================

function DefaultMessageHeader({ message, cumulativeUsage }: { message: AgentMessage; cumulativeUsage?: TokenUsage }) {
  const roleConfig = {
    assistant: {
      icon: IconSparkles,
      label: 'Assistant',
      iconBg: 'bg-primary/15',
      iconClass: 'text-primary',
      labelClass: 'text-foreground',
    },
    user: {
      icon: IconUser,
      label: 'You',
      iconBg: 'bg-muted/30',
      iconClass: 'text-muted-foreground',
      labelClass: 'text-muted-foreground',
    },
    system: {
      icon: IconSettings,
      label: 'System',
      iconBg: 'bg-yellow-500/15',
      iconClass: 'text-yellow-500',
      labelClass: 'text-yellow-500',
    },
  }

  const config = roleConfig[message.role]
  const Icon = config.icon

  const model = message.metadata?.model as string | undefined
  const showContextUsage = message.role === 'assistant' && model && cumulativeUsage &&
    (cumulativeUsage.inputTokens > 0 || cumulativeUsage.outputTokens > 0)

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={cn('flex size-6 items-center justify-center rounded-full', config.iconBg)}>
          <Icon className={cn('size-3.5', config.iconClass)} />
        </div>
        <span className={cn('text-sm font-medium', config.labelClass)}>
          {config.label}
        </span>
        {message.status === 'streaming' && (
          <IconLoader2 className="size-3 animate-spin text-muted-foreground" />
        )}
      </div>
      {showContextUsage && (
        <ContextUsageIndicator model={model} usage={cumulativeUsage} showTokens={true} />
      )}
    </div>
  )
}

/**
 * Default block renderer - switches on block type and checks for composer overrides
 */
function DefaultBlockRenderer({
  block,
  context,
  composer,
  toolResults,
}: DefaultBlockRendererProps) {
  switch (block.type) {
    case 'text': {
      if (composer?.renderTextBlock) {
        return <>{composer.renderTextBlock(block as TextBlock, context)}</>
      }
      return <MessageBlock block={block as TextBlock} />
    }

    case 'code': {
      if (composer?.renderCodeBlock) {
        return <>{composer.renderCodeBlock(block as CodeBlock, context)}</>
      }
      return <MessageBlock block={block as CodeBlock} />
    }

    case 'thinking': {
      if (composer?.renderThinkingBlock) {
        return <>{composer.renderThinkingBlock(block as ThinkingBlockType, context)}</>
      }
      return <ThinkingInline block={block as ThinkingBlockType} />
    }

    case 'tool_use': {
      // This shouldn't be reached normally since we group tool blocks,
      // but handle it for safety
      if (composer?.renderToolUseBlock) {
        return <>{composer.renderToolUseBlock(block as ToolUseBlock, context)}</>
      }
      const toolUse = block as ToolUseBlock
      const toolResult = toolResults?.get(toolUse.toolId)
      return <ToolCallInline toolUse={toolUse} toolResult={toolResult} />
    }

    case 'tool_result': {
      // This shouldn't be reached normally since we group tool blocks,
      // but handle it for safety with composer override
      if (composer?.renderToolResultBlock) {
        return <>{composer.renderToolResultBlock(block as ToolResultBlock, context)}</>
      }
      // Standalone tool_result without tool_use - render as simple result
      const result = block as ToolResultBlock
      return (
        <div
          className={cn(
            'rounded-md p-2 font-mono text-xs',
            result.isError
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted/50 text-foreground/90'
          )}
        >
          <pre className="overflow-x-auto whitespace-pre-wrap">{result.result}</pre>
        </div>
      )
    }

    case 'error': {
      if (composer?.renderErrorBlock) {
        return <>{composer.renderErrorBlock(block as ErrorBlock, context)}</>
      }
      const error = block as ErrorBlock
      return <DefaultErrorBlock error={error} />
    }

    case 'image': {
      if (composer?.renderImageBlock) {
        return <>{composer.renderImageBlock(block as ImageBlock, context)}</>
      }
      const image = block as ImageBlock
      return <DefaultImageBlock image={image} />
    }

    default:
      return null
  }
}

/**
 * Default error block renderer
 */
function DefaultErrorBlock({ error }: { error: ErrorBlock }) {
  return (
    <div
      className={cn(
        'rounded-md border border-destructive/50',
        'bg-destructive/10 p-3'
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-destructive font-medium text-sm">Error</span>
        {error.code && (
          <span className="text-destructive/70 text-xs font-mono">
            [{error.code}]
          </span>
        )}
      </div>
      <p className="text-destructive/90 mt-1 text-sm">{error.message}</p>
    </div>
  )
}

/**
 * Default image block renderer
 */
function DefaultImageBlock({ image }: { image: ImageBlock }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/50">
      <img
        src={image.source}
        alt={image.alt || 'Image'}
        className="max-h-96 w-auto object-contain"
      />
    </div>
  )
}

/**
 * Streaming indicator shown at the bottom when conversation is active
 */
function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 py-3">
      <div className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-muted-foreground">Thinking...</span>
    </div>
  )
}

/**
 * Welcome screen shown when conversation is empty
 */
function WelcomeScreen({ agentType }: { agentType?: string }) {
  const agentName = agentType
    ? agentType.charAt(0).toUpperCase() + agentType.slice(1)
    : 'Agent'

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        {/* Icon */}
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <IconTerminal2 className="size-8 text-primary" />
        </div>

        {/* Greeting */}
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-foreground">
            {agentName} is ready
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Send a message to start a conversation. The agent can help you with coding tasks, file operations, and more.
          </p>
        </div>

        {/* Suggestion chips */}
        <div className="flex flex-wrap justify-center gap-2">
          {[
            { icon: IconBolt, label: 'Quick task' },
            { icon: IconTerminal2, label: 'Run command' },
            { icon: IconSparkles, label: 'Generate code' },
          ].map((chip) => (
            <div
              key={chip.label}
              className={cn(
                'flex items-center gap-1.5',
                'rounded-full border border-border/40',
                'bg-muted/10 px-3 py-1.5',
                'text-xs text-muted-foreground',
              )}
            >
              <chip.icon className="size-3" />
              {chip.label}
            </div>
          ))}
        </div>

        {/* Keyboard hint */}
        <p className="text-[11px] text-muted-foreground/50">
          Press <kbd className="rounded border border-border/40 bg-muted/20 px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd> + <kbd className="rounded border border-border/40 bg-muted/20 px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send
        </p>
      </div>
    </div>
  )
}

export { DefaultBlockRenderer }
