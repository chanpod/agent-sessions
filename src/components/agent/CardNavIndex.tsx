import { cn } from '@/lib/utils'
import type { CardNavEntry } from '@/components/agent/cards/card-nav-config'

interface CardNavIndexProps {
  entries: CardNavEntry[]
  onScrollTo: (displayItemIndex: number) => void
}

export function CardNavIndex({ entries, onScrollTo }: CardNavIndexProps) {
  if (entries.length === 0) return null

  return (
    <div className="absolute top-1/2 left-4 z-30 hidden -translate-y-1/2 flex-col gap-2 xl:flex">
      {entries.map((entry) => {
        const Icon = entry.icon
        return (
          <button
            key={entry.toolName}
            onClick={() => onScrollTo(entry.displayItemIndex)}
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
    </div>
  )
}
