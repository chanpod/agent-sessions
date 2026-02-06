import { useRef, useMemo, useCallback, useState, useImperativeHandle, forwardRef } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import {
  IconLoader2,
  IconUser,
  IconSettings,
  IconActivity,
  IconBolt,
  IconTerminal2,
  IconSparkles,
  IconChevronDown,
  IconChecklist,
  IconMap,
  IconCopy,
  IconCheck,
  IconMarkdown,
  IconTxt,
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
import { MessageBlock } from '@/components/agent/MessageBlock'
import { ThinkingInline } from '@/components/agent/ThinkingInline'
import { ToolCallInline } from '@/components/agent/ToolCallInline'
import { SpecialToolCard } from '@/components/agent/cards/SpecialToolCard'
// CardNavIndex rendering is now inlined alongside the Tasks floating button
import { CARD_NAV_CONFIG, CARD_NAV_TOOL_NAMES } from '@/components/agent/cards/card-nav-config'
import type { CardNavEntry } from '@/components/agent/cards/card-nav-config'
import { ContextUsageIndicator } from '@/components/agent/ContextUsageIndicator'
import { TodoSheet, extractLatestTodos } from '@/components/agent/TodoSheet'
import { PlanSheet, extractLatestPlan } from '@/components/agent/PlanSheet'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

// =============================================================================
// Types
// =============================================================================

export interface AgentMessageViewHandle {
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void
}

interface AgentMessageViewProps {
  conversation: AgentConversation
  composer?: AgentUIComposer
  className?: string
  autoScroll?: boolean
  agentType?: string
  onAnswerQuestion?: (toolId: string, answers: Record<string, string>) => void
}

interface DefaultBlockRendererProps {
  block: ContentBlock
  context: RenderContext
  composer?: AgentUIComposer
  toolResults?: Map<string, ToolResultBlock>
}

// Group of tool blocks (tool_use + optional tool_result)
export interface ToolGroup {
  toolUse: ToolUseBlock
  toolResult?: ToolResultBlock
}

/** Tool names that get promoted to special cards outside the Activity box */
const SPECIAL_TOOL_NAMES = new Set(['ExitPlanMode', 'AskUserQuestion'])

function isSpecialToolGroup(item: ContentBlock | ToolGroup): boolean {
  return isToolGroup(item) && SPECIAL_TOOL_NAMES.has(item.toolUse.toolName)
}

/**
 * Separate special tools (questions, plans) from regular activity.
 * Special tools get promoted to dedicated card components.
 */
function partitionSpecialTools(
  activityBlocks: (ContentBlock | ToolGroup)[]
): {
  regularActivity: (ContentBlock | ToolGroup)[]
  promotedTools: ToolGroup[]
} {
  const regularActivity: (ContentBlock | ToolGroup)[] = []
  const promotedTools: ToolGroup[] = []

  for (const item of activityBlocks) {
    if (isSpecialToolGroup(item)) {
      promotedTools.push(item as ToolGroup)
    } else {
      regularActivity.push(item)
    }
  }

  return { regularActivity, promotedTools }
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
 * Check whether a message contains visible response content (text, code, images).
 */
function hasResponseContent(msg: AgentMessage): boolean {
  return msg.blocks.some(
    (block) =>
      block.type !== 'tool_use' &&
      block.type !== 'tool_result' &&
      !ACTIVITY_TYPES.has(block.type)
  )
}

/**
 * Check whether a message contains a special tool (question, plan) that should
 * act as a logical boundary in the conversation flow.
 */
function hasSpecialTool(msg: AgentMessage): boolean {
  return msg.blocks.some(
    (block) => block.type === 'tool_use' && SPECIAL_TOOL_NAMES.has(block.toolName)
  )
}

/**
 * Groups messages into display items. Consecutive activity-only assistant messages
 * are merged into a single turn. A turn is flushed when an assistant message contains
 * visible response content (text) or a special tool (question, plan), so the chat
 * shows logical chunks of work rather than one giant merged block.
 *
 * User/system messages are always standalone items.
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
      // Flush the turn when this message has text output or a special tool
      // (question, plan). Activity-only messages keep accumulating.
      if (hasResponseContent(msg) || hasSpecialTool(msg)) {
        flushTurn()
      }
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

  // Flush remaining assistant messages (e.g. streaming activity)
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
export const AgentMessageView = forwardRef<AgentMessageViewHandle, AgentMessageViewProps>(function AgentMessageView({
  conversation,
  composer,
  className,
  autoScroll: _autoScroll = true,
  agentType,
  onAnswerQuestion,
}, ref) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isStreaming = conversation.status === 'streaming'
  const [_isAtBottom, setIsAtBottom] = useState(true)

  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: 'auto' | 'smooth' = 'smooth') => {
      virtuosoRef.current?.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior,
      })
    },
  }), [])
  const [todoSheetOpen, setTodoSheetOpen] = useState(false)
  const [planSheetOpen, setPlanSheetOpen] = useState(false)

  // Extract latest todo state for the floating badge
  const todos = useMemo(() => extractLatestTodos(conversation), [conversation])
  const todoCompletedCount = todos.filter((t) => t.status === 'completed').length
  const todoTotalCount = todos.length

  // Extract latest plan state for the floating badge
  const plan = useMemo(() => extractLatestPlan(conversation), [conversation])

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

  // Combine completed messages with current streaming message.
  // Dedup: don't append currentMessage if a completed message with the same ID already exists.
  const allMessages = useMemo(() => {
    const messages = [...conversation.messages]
    if (conversation.currentMessage) {
      const alreadyExists = messages.some((m) => m.id === conversation.currentMessage!.id)
      if (!alreadyExists) {
        messages.push(conversation.currentMessage)
      }
    }
    return messages
  }, [conversation.messages, conversation.currentMessage])

  // Group into display items (turns + standalone messages)
  const displayItems = useMemo(
    () => groupIntoDisplayItems(allMessages),
    [allMessages]
  )

  // Build card navigation entries — find the LAST display item index
  // for each special tool type
  const cardNavEntries = useMemo<CardNavEntry[]>(() => {
    const lastIndexByTool = new Map<string, number>()

    for (let i = 0; i < displayItems.length; i++) {
      const item = displayItems[i]!
      if (item.kind !== 'assistant-turn') continue

      for (const block of item.activityBlocks) {
        if (isToolGroup(block) && CARD_NAV_TOOL_NAMES.has(block.toolUse.toolName)) {
          lastIndexByTool.set(block.toolUse.toolName, i)
        }
      }
    }

    // Build entries in the stable config order
    const entries: CardNavEntry[] = []
    for (const config of CARD_NAV_CONFIG) {
      const idx = lastIndexByTool.get(config.toolName)
      if (idx !== undefined) {
        entries.push({ ...config, displayItemIndex: idx })
      }
    }
    return entries
  }, [displayItems])

  const handleScrollToCard = useCallback(
    (displayItemIndex: number) => {
      virtuosoRef.current?.scrollToIndex({
        index: displayItemIndex,
        align: 'start',
        behavior: 'smooth',
      })
    },
    []
  )

  const hasMessages = displayItems.length > 0

  return (
    <>
      {!hasMessages && !isStreaming ? (
        <div className={cn('h-full', className)}>
          <div className="flex flex-col gap-5 max-w-3xl mx-auto px-4 py-6">
            <WelcomeScreen agentType={agentType} />
          </div>
        </div>
      ) : (
        <div className="relative h-full">
          {/* Floating side nav — cards + tasks button */}
          <div className="absolute top-1/2 left-4 z-30 hidden -translate-y-1/2 flex-col gap-2 xl:flex">
            {cardNavEntries.map((entry) => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.toolName}
                  onClick={() => handleScrollToCard(entry.displayItemIndex)}
                  className={cn(
                    'flex items-center gap-2 rounded-full border px-3 py-1.5',
                    'transition-colors duration-150 cursor-pointer',
                    'hover:brightness-125',
                    entry.borderClass,
                    entry.bgClass,
                  )}
                >
                  <div
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full',
                      entry.iconBgClass,
                    )}
                  >
                    <Icon className={cn('size-3', entry.textClass)} />
                  </div>
                  <span className={cn('text-xs font-medium', entry.textClass)}>
                    {entry.label}
                  </span>
                </button>
              )
            })}
            {plan && (
              <button
                onClick={() => setPlanSheetOpen(true)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5',
                  'transition-colors duration-150 cursor-pointer',
                  'hover:brightness-125',
                  'border-blue-500/30 bg-blue-500/10',
                )}
              >
                <div className="flex size-5 items-center justify-center rounded-full bg-blue-500/15">
                  <IconMap className="size-3 text-blue-400" />
                </div>
                <span className="text-xs font-medium text-blue-400">
                  Plan
                </span>
              </button>
            )}
            {todoTotalCount > 0 && (
              <button
                onClick={() => setTodoSheetOpen(true)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5',
                  'transition-colors duration-150 cursor-pointer',
                  'hover:brightness-125',
                  'border-emerald-500/30 bg-emerald-500/10',
                )}
              >
                <div className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15">
                  <IconChecklist className="size-3 text-emerald-400" />
                </div>
                <span className="text-xs font-medium text-emerald-400">
                  Tasks
                </span>
                <span className="text-[10px] font-semibold text-emerald-400/70">
                  {todoCompletedCount}/{todoTotalCount}
                </span>
              </button>
            )}
          </div>

          <PlanSheet
            open={planSheetOpen}
            onOpenChange={setPlanSheetOpen}
            conversation={conversation}
          />
          <TodoSheet
            open={todoSheetOpen}
            onOpenChange={setTodoSheetOpen}
            conversation={conversation}
          />
          <Virtuoso
            ref={virtuosoRef}
            className={cn('h-full', className)}
            data={displayItems}
            overscan={200}
            initialTopMostItemIndex={displayItems.length > 0 ? displayItems.length - 1 : 0}
            followOutput={(isAtBottom) => {
              if (!isAtBottom) return false
              return isStreaming ? 'auto' : 'smooth'
            }}
            atBottomThreshold={150}
            increaseViewportBy={{top: 0, bottom: 200}}
            atBottomStateChange={setIsAtBottom}
            computeItemKey={(index, item) =>
              item.kind === 'standalone'
                ? item.message.id
                : item.messages[0]?.id ?? `turn-${index}`
            }
            itemContent={(_index, item) => (
              <div className="max-w-3xl mx-auto px-4 py-2.5">
                {item.kind === 'standalone' ? (
                  <StandaloneMessageRenderer
                    message={item.message}
                    context={context}
                    composer={composer}
                    cumulativeUsage={item.cumulativeUsage}
                  />
                ) : (
                  <AssistantTurnRenderer
                    turn={item}
                    context={context}
                    composer={composer}
                    onAnswerQuestion={onAnswerQuestion}
                  />
                )}
              </div>
            )}
            components={{
              Footer: () => <div className="h-10" />,
            }}
          />
        </div>
      )}
    </>
  )
})

// =============================================================================
// Activity Box (collapsible)
// =============================================================================

function ActivityBox({
  regularActivity,
  isStreaming,
  showContextUsage,
  latestModel,
  cumulativeUsage,
}: {
  regularActivity: (ContentBlock | ToolGroup)[]
  isStreaming: boolean
  showContextUsage: boolean
  latestModel?: string
  cumulativeUsage: TokenUsage
}) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'flex flex-col',
          'rounded-lg border border-border/30',
          'bg-muted/10',
        )}
      >
        {/* Activity header / trigger */}
        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-muted/20">
          <div className="flex items-center gap-2">
            <IconActivity className="size-3.5 text-muted-foreground/60" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Activity
            </span>
            {isStreaming && (
              <IconLoader2 className="size-3 animate-spin text-primary/60" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {showContextUsage && latestModel && (
              <ContextUsageIndicator
                model={latestModel}
                usage={cumulativeUsage}
                showTokens={true}
              />
            )}
            <IconChevronDown
              className={cn(
                'size-4 text-muted-foreground/40 transition-transform',
                isOpen && 'rotate-180',
              )}
            />
          </div>
        </CollapsibleTrigger>

        {/* Activity items */}
        <CollapsibleContent>
          <div className="flex flex-col gap-0.5 px-3 pb-2.5 pl-8">
            {regularActivity.map((item) => {
              if (isToolGroup(item)) {
                return (
                  <ToolCallInline
                    key={item.toolUse.id}
                    toolUse={item.toolUse}
                    toolResult={item.toolResult}
                  />
                )
              }
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
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// =============================================================================
// Assistant Turn Renderer (Activity Box + Response Box)
// =============================================================================

function AssistantTurnRenderer({
  turn,
  context,
  composer,
  onAnswerQuestion,
}: {
  turn: AssistantTurn
  context: RenderContext
  composer?: AgentUIComposer
  onAnswerQuestion?: (toolId: string, answers: Record<string, string>) => void
}) {
  // Partition activity blocks into regular (stay in Activity box) and promoted (special cards)
  const { regularActivity, promotedTools } = partitionSpecialTools(turn.activityBlocks)

  const hasRegularActivity = regularActivity.length > 0
  const hasPromotedTools = promotedTools.length > 0
  const hasResponse = turn.responseBlocks.length > 0

  const showContextUsage = turn.latestModel && turn.cumulativeUsage &&
    (turn.cumulativeUsage.inputTokens > 0 || turn.cumulativeUsage.outputTokens > 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Activity Box - regular tool calls + thinking only */}
      {hasRegularActivity && (
        <ActivityBox
          regularActivity={regularActivity}
          isStreaming={turn.isStreaming}
          showContextUsage={!!(showContextUsage && !hasResponse && !hasPromotedTools)}
          latestModel={turn.latestModel}
          cumulativeUsage={turn.cumulativeUsage}
        />
      )}

      {/* Special Tool Cards - Plan, Question, Todo */}
      {hasPromotedTools &&
        promotedTools.map((group) => (
          <SpecialToolCard
            key={group.toolUse.id}
            toolUse={group.toolUse}
            toolResult={group.toolResult}
            onAnswerQuestion={onAnswerQuestion}
          />
        ))}

      {/* Response Box - text, code, images, errors */}
      {hasResponse && (
        <div className="group/msg flex flex-col gap-2">
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
            <div className="flex items-center gap-2">
              {!turn.isStreaming && (
                <MessageCopyMenu blocks={turn.responseBlocks} />
              )}
              {showContextUsage && (
                <ContextUsageIndicator
                  model={turn.latestModel!}
                  usage={turn.cumulativeUsage}
                  showTokens={true}
                />
              )}
            </div>
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
      {(hasRegularActivity || hasPromotedTools) && !hasResponse && turn.isStreaming && (
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
        <div className="group/msg max-w-[85%]">
          {/* Header row with label + copy */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-full bg-muted/30">
                <IconUser className="size-3.5 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">You</span>
            </div>
            <MessageCopyMenu blocks={message.blocks} />
          </div>
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

// =============================================================================
// Message Copy Button
// =============================================================================

/**
 * Extract copyable text from content blocks.
 * - Plain text: strips markdown formatting into readable text
 * - Markdown: preserves original markdown source with code blocks
 */
function extractBlocksContent(blocks: ContentBlock[]): { plain: string; markdown: string } {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push((block as TextBlock).content)
    } else if (block.type === 'code') {
      const code = block as CodeBlock
      parts.push(`\`\`\`${code.language ?? ''}\n${code.content}\n\`\`\``)
    }
  }
  const markdown = parts.join('\n\n')
  // Plain text: strip markdown syntax
  const plain = markdown
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```$/g, '').trim())
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '  - ')
    .replace(/^\d+\.\s+/gm, (m) => `  ${m}`)
  return { plain, markdown }
}

type CopyFormat = 'text' | 'markdown'

function MessageCopyMenu({ blocks }: { blocks: ContentBlock[] }) {
  const [copied, setCopied] = useState<CopyFormat | null>(null)
  const [open, setOpen] = useState(false)

  const handleCopy = useCallback(async (format: CopyFormat) => {
    const { plain, markdown } = extractBlocksContent(blocks)
    try {
      await navigator.clipboard.writeText(format === 'markdown' ? markdown : plain)
      setCopied(format)
      setOpen(false)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [blocks])

  if (copied) {
    return (
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-green-400">
        <IconCheck className="size-4" />
        <span className="text-xs font-medium">Copied</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1',
          'text-xs font-medium text-muted-foreground/50',
          'hover:text-muted-foreground hover:bg-muted/30',
          'opacity-0 group-hover/msg:opacity-100 transition-opacity',
        )}
        aria-label="Copy message"
      >
        <IconCopy className="size-4" />
        <span>Copy</span>
      </button>
      {open && (
        <div
          className={cn(
            'absolute right-0 top-full z-50 mt-1',
            'flex flex-col gap-0.5',
            'rounded-lg border border-border/40 bg-popover p-1',
            'shadow-lg shadow-black/20',
            'min-w-[150px]',
            'animate-in fade-in-0 zoom-in-95 duration-100',
          )}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleCopy('text')}
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left',
              'text-xs text-popover-foreground hover:bg-muted/50',
              'transition-colors',
            )}
          >
            <IconTxt className="size-4 text-muted-foreground" />
            Copy as text
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleCopy('markdown')}
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left',
              'text-xs text-popover-foreground hover:bg-muted/50',
              'transition-colors',
            )}
          >
            <IconMarkdown className="size-4 text-muted-foreground" />
            Copy as markdown
          </button>
        </div>
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
