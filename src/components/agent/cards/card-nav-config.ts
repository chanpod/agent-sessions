import { IconMessageQuestion } from '@tabler/icons-react'
import type { FC } from 'react'

export interface CardNavConfigEntry {
  toolName: string
  label: string
  icon: FC<{ className?: string }>
  borderClass: string
  bgClass: string
  textClass: string
  iconBgClass: string
}

export interface CardNavEntry extends CardNavConfigEntry {
  displayItemIndex: number
}

/**
 * Configuration for each special tool card type shown in the floating nav.
 * Order here determines display order in the nav panel.
 */
export const CARD_NAV_CONFIG: CardNavConfigEntry[] = [
  {
    toolName: 'AskUserQuestion',
    label: 'Question',
    icon: IconMessageQuestion,
    borderClass: 'border-purple-500/30',
    bgClass: 'bg-purple-500/10',
    textClass: 'text-purple-400',
    iconBgClass: 'bg-purple-500/15',
  },
]

/** Set of tool names that get nav entries */
export const CARD_NAV_TOOL_NAMES = new Set(CARD_NAV_CONFIG.map((c) => c.toolName))
