import { useRef, useEffect, useMemo } from 'react'
import { IconLoader2, IconUser, IconRobot, IconSettings } from '@tabler/icons-react'

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
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBlock } from '@/components/agent/MessageBlock'
import { ThinkingBlock } from '@/components/agent/ThinkingBlock'
import { ToolCallCard } from '@/components/agent/ToolCallCard'
import { cn } from '@/lib/utils'

// =============================================================================
// Types
// =============================================================================

interface AgentMessageViewProps {
  conversation: AgentConversation
  composer?: AgentUIComposer
  className?: string
  autoScroll?: boolean
}

interface MessageRendererProps {
  message: AgentMessage
  context: RenderContext
  composer?: AgentUIComposer
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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Groups consecutive tool_use and tool_result blocks by toolId
 */
function groupToolBlocks(blocks: ContentBlock[]): (ContentBlock | ToolGroup)[] {
  const result: (ContentBlock | ToolGroup)[] = []
  const toolResultMap = new Map<string, ToolResultBlock>()

  // First pass: collect all tool results
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      toolResultMap.set(block.toolId, block)
    }
  }

  // Second pass: group tool_use with their results, skip standalone tool_results
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      const toolResult = toolResultMap.get(block.toolId)
      result.push({ toolUse: block, toolResult })
    } else if (block.type === 'tool_result') {
      // Skip - already grouped with tool_use
      continue
    } else {
      result.push(block)
    }
  }

  return result
}

/**
 * Check if a grouped item is a ToolGroup
 */
function isToolGroup(item: ContentBlock | ToolGroup): item is ToolGroup {
  return 'toolUse' in item
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * AgentMessageView - Main container that renders an agent conversation
 *
 * Features:
 * - Renders all messages in a conversation
 * - Supports composer pattern for custom rendering
 * - Auto-scrolls to bottom when streaming
 * - Groups tool_use and tool_result blocks together
 */
export function AgentMessageView({
  conversation,
  composer,
  className,
  autoScroll = true,
}: AgentMessageViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isStreaming = conversation.status === 'streaming'

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

  // Auto-scroll to bottom when streaming
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [autoScroll, allMessages, conversation.currentMessage?.blocks])

  return (
    <ScrollArea
      className={cn('h-full', className)}
    >
      <div ref={scrollRef} className="flex flex-col gap-4 p-4">
        {allMessages.map((message) => (
          <MessageRenderer
            key={message.id}
            message={message}
            context={context}
            composer={composer}
          />
        ))}

        {/* Streaming indicator */}
        {isStreaming && <StreamingIndicator />}
      </div>
    </ScrollArea>
  )
}

// =============================================================================
// Message Renderer
// =============================================================================

/**
 * Renders a single message with optional header/footer from composer
 */
function MessageRenderer({ message, context, composer }: MessageRendererProps) {
  // Group tool blocks
  const groupedBlocks = useMemo(
    () => groupToolBlocks(message.blocks),
    [message.blocks]
  )

  // Build tool result map for standalone block rendering
  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultBlock>()
    for (const block of message.blocks) {
      if (block.type === 'tool_result') {
        map.set(block.toolId, block)
      }
    }
    return map
  }, [message.blocks])

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        'rounded-lg border border-border/30',
        'bg-card/30 p-3',
        message.role === 'user' && 'bg-muted/20',
        message.role === 'system' && 'bg-yellow-500/5 border-yellow-500/20'
      )}
    >
      {/* Message Header */}
      {composer?.renderMessageHeader ? (
        composer.renderMessageHeader(message, context)
      ) : (
        <DefaultMessageHeader message={message} />
      )}

      {/* Message Content Blocks */}
      <div className="flex flex-col gap-3 pl-7">
        {groupedBlocks.map((item) => {
          if (isToolGroup(item)) {
            return (
              <ToolCallCard
                key={item.toolUse.id}
                toolUse={item.toolUse}
                toolResult={item.toolResult}
              />
            )
          }

          return (
            <DefaultBlockRenderer
              key={item.id}
              block={item}
              context={context}
              composer={composer}
              toolResults={toolResults}
            />
          )
        })}
      </div>

      {/* Message Footer */}
      {composer?.renderMessageFooter?.(message, context)}

      {/* Metadata */}
      {message.metadata && composer?.renderMetadata?.(message.metadata, context)}
    </div>
  )
}

// =============================================================================
// Default Renderers
// =============================================================================

/**
 * Default message header showing role indicator
 */
function DefaultMessageHeader({ message }: { message: AgentMessage }) {
  const roleConfig = {
    assistant: {
      icon: IconRobot,
      label: 'Assistant',
      className: 'text-primary',
    },
    user: {
      icon: IconUser,
      label: 'User',
      className: 'text-muted-foreground',
    },
    system: {
      icon: IconSettings,
      label: 'System',
      className: 'text-yellow-500',
    },
  }

  const config = roleConfig[message.role]
  const Icon = config.icon

  return (
    <div className="flex items-center gap-2">
      <Icon className={cn('size-4', config.className)} />
      <span className={cn('text-xs font-medium', config.className)}>
        {config.label}
      </span>
      {message.status === 'streaming' && (
        <IconLoader2 className="size-3 animate-spin text-muted-foreground" />
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
      return <ThinkingBlock block={block as ThinkingBlockType} />
    }

    case 'tool_use': {
      // This shouldn't be reached normally since we group tool blocks,
      // but handle it for safety
      if (composer?.renderToolUseBlock) {
        return <>{composer.renderToolUseBlock(block as ToolUseBlock, context)}</>
      }
      const toolUse = block as ToolUseBlock
      const toolResult = toolResults?.get(toolUse.toolId)
      return <ToolCallCard toolUse={toolUse} toolResult={toolResult} />
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
    <div className="flex items-center gap-2 py-2 text-muted-foreground">
      <IconLoader2 className="size-4 animate-spin" />
      <span className="text-xs">Agent is responding...</span>
    </div>
  )
}

export { MessageRenderer, DefaultBlockRenderer }
