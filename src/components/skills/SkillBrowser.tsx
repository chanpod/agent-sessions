import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  X,
  Search,
  Download,
  Trash2,
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  Package,
  TrendingUp,
  SortAsc,
  Clock,
  Check,
  Loader2,
  Globe,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'

// ─── Types ────────────────────────────────────────────────────────

export type MarketplaceSource = 'anthropic' | 'vercel'
export type SkillScope = 'user' | 'project' | 'local'
export type SkillCategory =
  | 'development'
  | 'productivity'
  | 'security'
  | 'testing'
  | 'database'
  | 'deployment'
  | 'monitoring'
  | 'design'
  | 'learning'

export interface InstalledSkill {
  id: string
  name: string
  description?: string
  version: string
  scope: SkillScope
  installPath: string
  installedAt: string
  lastUpdated: string
  projectPath?: string
  marketplace?: string
  category?: SkillCategory
}

export interface MarketplaceSkill {
  id: string
  name: string
  description: string
  source: MarketplaceSource
  category?: SkillCategory
  version?: string
  installCount?: number
  homepage?: string
  author?: string
  installed?: boolean
}

type TabId = 'installed' | 'browse'
type SortKey = 'popular' | 'name' | 'recent'

interface SkillBrowserProps {
  open: boolean
  onClose: () => void
  installedSkills: InstalledSkill[]
  marketplaceSkills: MarketplaceSkill[]
  onInstall: (skill: MarketplaceSkill, scope: SkillScope) => Promise<void>
  onUninstall: (skill: InstalledSkill) => Promise<void>
  onSearchVercel?: (query: string) => Promise<MarketplaceSkill[]>
  isLoading?: boolean
}

// ─── Constants ────────────────────────────────────────────────────

const CATEGORIES: { id: SkillCategory; label: string }[] = [
  { id: 'development', label: 'Development' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'security', label: 'Security' },
  { id: 'testing', label: 'Testing' },
  { id: 'database', label: 'Database' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'design', label: 'Design' },
  { id: 'learning', label: 'Learning' },
]

const SORT_OPTIONS: { id: SortKey; label: string; icon: typeof TrendingUp }[] =
  [
    { id: 'popular', label: 'Popular', icon: TrendingUp },
    { id: 'name', label: 'Name', icon: SortAsc },
    { id: 'recent', label: 'Recent', icon: Clock },
  ]

// ─── Helpers ──────────────────────────────────────────────────────

function formatInstallCount(count: number): string {
  if (count >= 1000)
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`
  return count.toString()
}

function scopeLabel(scope: SkillScope): string {
  if (scope === 'user') return 'Global'
  if (scope === 'project') return 'Project'
  return 'Local'
}

// ─── Sub-Components ───────────────────────────────────────────────

function AnthropicMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 176"
      fill="currentColor"
      className={cn('size-3.5', className)}
      aria-label="Anthropic"
    >
      <path d="M147.487 0L256 176h-52.32L147.487 0ZM66.261 106.678 91.04 176H42.722L0 56.889h48.753l17.508 49.789Z" />
    </svg>
  )
}

function VercelMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 222"
      fill="currentColor"
      className={cn('size-3.5', className)}
      aria-label="Vercel"
    >
      <path d="M128 0l128 221.705H0z" />
    </svg>
  )
}

function SourceBadge({ source }: { source: MarketplaceSource }) {
  if (source === 'anthropic') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-400/90 uppercase ring-1 ring-inset ring-amber-500/15">
        <AnthropicMark className="size-2.5" />
        Anthropic
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-300 uppercase ring-1 ring-inset ring-white/10">
      <VercelMark className="size-2.5" />
      Skills.sh
    </span>
  )
}

function ScopeBadge({ scope }: { scope: SkillScope }) {
  const isGlobal = scope === 'user'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase ring-1 ring-inset',
        isGlobal
          ? 'bg-sky-500/8 text-sky-400/90 ring-sky-500/15'
          : 'bg-violet-500/8 text-violet-400/90 ring-violet-500/15'
      )}
    >
      {isGlobal ? (
        <Globe className="size-2.5" />
      ) : (
        <FolderOpen className="size-2.5" />
      )}
      {scopeLabel(scope)}
    </span>
  )
}

function CategoryChip({
  category,
  active,
  onClick,
}: {
  category: { id: SkillCategory; label: string }
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wide transition-all duration-150',
        active
          ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/25'
          : 'bg-white/[0.04] text-zinc-500 ring-1 ring-inset ring-white/[0.06] hover:bg-white/[0.06] hover:text-zinc-400'
      )}
    >
      {category.label}
    </button>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Package
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.06]">
        <Icon className="size-5 text-zinc-600" />
      </div>
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      <p className="mt-1 text-xs text-zinc-600">{description}</p>
    </div>
  )
}

// ─── Skill Cards ──────────────────────────────────────────────────

function MarketplaceCard({
  skill,
  installedIds,
  onInstall,
  installing,
}: {
  skill: MarketplaceSkill
  installedIds: Set<string>
  onInstall: (skill: MarketplaceSkill, scope: SkillScope) => void
  installing: string | null
}) {
  const isInstalled = installedIds.has(skill.name) || skill.installed
  const isInstalling = installing === skill.id
  const [showScopePicker, setShowScopePicker] = useState(false)

  return (
    <div className="group relative rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-all duration-150 hover:border-white/[0.10] hover:bg-white/[0.035]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-zinc-200">
              {skill.name}
            </h3>
            <SourceBadge source={skill.source} />
          </div>
          {skill.category && (
            <span className="mt-1 inline-block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              {skill.category}
            </span>
          )}
        </div>

        {isInstalled ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
            <Check className="size-3" />
            Installed
          </span>
        ) : (
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="xs"
              disabled={isInstalling}
              onClick={() => setShowScopePicker(!showScopePicker)}
              className="border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-400"
            >
              {isInstalling ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" />
              )}
              Install
              <ChevronDown className="size-3 ml-0.5" />
            </Button>
            {showScopePicker && !isInstalling && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowScopePicker(false)}
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-white/[0.08] bg-zinc-900 p-1 shadow-xl shadow-black/40">
                  <button
                    onClick={() => {
                      setShowScopePicker(false)
                      onInstall(skill, 'project')
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.06]"
                  >
                    <FolderOpen className="size-3 text-violet-400" />
                    <div>
                      <div>This Project</div>
                      <div className="font-normal text-zinc-600">Available in current project only</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowScopePicker(false)
                      onInstall(skill, 'user')
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.06]"
                  >
                    <Globe className="size-3 text-sky-400" />
                    <div>
                      <div>Global</div>
                      <div className="font-normal text-zinc-600">Available in all projects</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">
        {skill.description}
      </p>

      <div className="mt-3 flex items-center gap-3">
        {skill.installCount != null && (
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-zinc-600">
            <Download className="size-2.5" />
            {formatInstallCount(skill.installCount)}
          </span>
        )}
        {skill.version && (
          <span className="font-mono text-[10px] text-zinc-600">
            v{skill.version}
          </span>
        )}
        {skill.homepage && (
          <a
            href={skill.homepage}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto flex items-center gap-1 text-[10px] text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-400"
          >
            <ExternalLink className="size-2.5" />
            Source
          </a>
        )}
      </div>
    </div>
  )
}

function InstalledCard({
  skill,
  onUninstall,
  uninstalling,
}: {
  skill: InstalledSkill
  onUninstall: (skill: InstalledSkill) => void
  uninstalling: string | null
}) {
  const isUninstalling = uninstalling === skill.id
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <>
      <div
        className="group relative rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-all duration-150 hover:border-white/[0.10]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[13px] font-semibold text-zinc-200">
                {skill.name}
              </h3>
              <ScopeBadge scope={skill.scope} />
              {skill.marketplace && (
                <span className="font-mono text-[10px] text-zinc-700">
                  @{skill.marketplace}
                </span>
              )}
            </div>
            {skill.description && (
              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                {skill.description}
              </p>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon-xs"
            disabled={isUninstalling}
            onClick={() => setShowConfirm(true)}
            className="shrink-0 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
          >
            {isUninstalling ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
          </Button>
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          {skill.version && (
            <span className="font-mono text-[10px] text-zinc-600">
              v{skill.version}
            </span>
          )}
          <span className="text-[10px] text-zinc-700">
            Updated{' '}
            {new Date(skill.lastUpdated).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      </div>

      {/* Uninstall confirmation */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirm(false)
          }}
        >
          <div className="mx-4 w-full max-w-sm rounded-xl border border-white/[0.08] bg-zinc-950 p-5 shadow-2xl shadow-black/60">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-red-500/10 p-2">
                <AlertTriangle className="size-4 text-red-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-zinc-100">
                  Uninstall {skill.name}?
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                  This will remove the skill{' '}
                  {skill.scope === 'user'
                    ? 'globally from all projects'
                    : 'from this project'}
                  . You can reinstall it later from the marketplace.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirm(false)}
                className="text-zinc-400"
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowConfirm(false)
                  onUninstall(skill)
                }}
                className="bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20 hover:bg-red-500/20"
              >
                <Trash2 className="size-3" />
                Uninstall
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────

export function SkillBrowser({
  open,
  onClose,
  installedSkills,
  marketplaceSkills,
  onInstall,
  onUninstall,
  onSearchVercel,
  isLoading,
}: SkillBrowserProps) {
  const [activeTab, setActiveTab] = useState<TabId>('browse')
  const [search, setSearch] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<
    Set<SkillCategory>
  >(new Set())
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSource | 'all'>(
    'all'
  )
  const [sortKey, setSortKey] = useState<SortKey>('popular')
  const [sortOpen, setSortOpen] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [uninstalling, setUninstalling] = useState<string | null>(null)
  const [vercelResults, setVercelResults] = useState<MarketplaceSkill[]>([])
  const [vercelSearching, setVercelSearching] = useState(false)
  const vercelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced Vercel search — fires when search text changes and source includes vercel
  useEffect(() => {
    if (!onSearchVercel) return
    if (activeTab !== 'browse') return
    if (sourceFilter === 'anthropic') return

    if (vercelTimerRef.current) clearTimeout(vercelTimerRef.current)

    const query = search.trim()
    if (!query) {
      setVercelResults([])
      return
    }

    setVercelSearching(true)
    vercelTimerRef.current = setTimeout(async () => {
      try {
        const results = await onSearchVercel(query)
        setVercelResults(results)
      } catch {
        setVercelResults([])
      } finally {
        setVercelSearching(false)
      }
    }, 300)

    return () => {
      if (vercelTimerRef.current) clearTimeout(vercelTimerRef.current)
    }
  }, [search, sourceFilter, activeTab, onSearchVercel])

  const installedIds = useMemo(
    () => new Set(installedSkills.map((s) => s.name)),
    [installedSkills]
  )

  const toggleCategory = useCallback((cat: SkillCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  const filteredMarketplace = useMemo(() => {
    // Combine Anthropic (static) and Vercel (search-based) results
    let anthropicItems = marketplaceSkills
    let vercelItems = vercelResults

    // Apply source filter
    if (sourceFilter === 'vercel') anthropicItems = []
    if (sourceFilter === 'anthropic') vercelItems = []

    // Filter Anthropic items by search text (Vercel is already search-filtered)
    if (search.trim()) {
      const q = search.toLowerCase()
      anthropicItems = anthropicItems.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.category && s.category.toLowerCase().includes(q))
      )
    }

    // Category filter (Anthropic only — Vercel skills don't have categories)
    if (selectedCategories.size > 0) {
      anthropicItems = anthropicItems.filter(
        (s) => s.category && selectedCategories.has(s.category)
      )
    }

    const combined = [...anthropicItems, ...vercelItems]

    combined.sort((a, b) => {
      if (sortKey === 'popular')
        return (b.installCount ?? 0) - (a.installCount ?? 0)
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      return 0
    })

    return combined
  }, [marketplaceSkills, vercelResults, sourceFilter, search, selectedCategories, sortKey])

  const filteredInstalled = useMemo(() => {
    if (!search.trim()) return installedSkills
    const q = search.toLowerCase()
    return installedSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
    )
  }, [installedSkills, search])

  const handleInstall = useCallback(
    async (skill: MarketplaceSkill, scope: SkillScope) => {
      setInstalling(skill.id)
      try {
        await onInstall(skill, scope)
      } finally {
        setInstalling(null)
      }
    },
    [onInstall]
  )

  const handleUninstall = useCallback(
    async (skill: InstalledSkill) => {
      setUninstalling(skill.id)
      try {
        await onUninstall(skill)
      } finally {
        setUninstalling(null)
      }
    },
    [onUninstall]
  )

  if (!open) return null

  const currentSort = SORT_OPTIONS.find((s) => s.id === sortKey)!

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="mx-4 flex h-[min(85vh,740px)] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-950 shadow-2xl shadow-black/60">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-1.5">
              <Package className="size-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Skills</h2>
              <p className="text-[11px] text-zinc-600">
                {installedSkills.length} installed
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-zinc-400"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* ── Tab Bar + Search ────────────────────────────────── */}
        <div className="space-y-3 border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.03] p-0.5 ring-1 ring-inset ring-white/[0.06]">
            {(
              [
                { id: 'installed' as TabId, label: 'Installed' },
                { id: 'browse' as TabId, label: 'Browse Marketplace' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150',
                  activeTab === tab.id
                    ? 'bg-white/[0.08] text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-400'
                )}
              >
                {tab.label}
                {tab.id === 'installed' && installedSkills.length > 0 && (
                  <span className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full bg-white/[0.08] text-[10px] tabular-nums">
                    {installedSkills.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
            <input
              type="text"
              placeholder={
                activeTab === 'browse'
                  ? 'Search marketplace skills...'
                  : 'Filter installed skills...'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-white/[0.06] bg-white/[0.03] py-2 pl-9 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/[0.12] focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>

          {activeTab === 'browse' && (
            <>
              <div className="flex items-center gap-2">
                {/* Source filter */}
                <div className="flex items-center gap-1 rounded-md bg-white/[0.03] p-0.5 ring-1 ring-inset ring-white/[0.06]">
                  {(
                    [
                      { id: 'all' as const, label: 'All', icon: null },
                      {
                        id: 'anthropic' as const,
                        label: 'Anthropic',
                        icon: AnthropicMark,
                      },
                      {
                        id: 'vercel' as const,
                        label: 'Skills.sh',
                        icon: VercelMark,
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSourceFilter(opt.id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-all duration-150',
                        sourceFilter === opt.id
                          ? 'bg-white/[0.08] text-zinc-200 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-400'
                      )}
                    >
                      {opt.icon && <opt.icon className="size-2.5" />}
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1" />

                {/* Sort dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setSortOpen(!sortOpen)}
                    className="flex items-center gap-1.5 rounded-md bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 ring-1 ring-inset ring-white/[0.06] transition-colors hover:text-zinc-400"
                  >
                    <ArrowUpDown className="size-3" />
                    {currentSort.label}
                    <ChevronDown
                      className={cn(
                        'size-3 transition-transform',
                        sortOpen && 'rotate-180'
                      )}
                    />
                  </button>
                  {sortOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setSortOpen(false)}
                      />
                      <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-white/[0.08] bg-zinc-900 p-1 shadow-xl shadow-black/40">
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            onClick={() => {
                              setSortKey(opt.id)
                              setSortOpen(false)
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                              sortKey === opt.id
                                ? 'bg-white/[0.06] text-zinc-200'
                                : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
                            )}
                          >
                            <opt.icon className="size-3" />
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Category chips */}
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((cat) => (
                  <CategoryChip
                    key={cat.id}
                    category={cat}
                    active={selectedCategories.has(cat.id)}
                    onClick={() => toggleCategory(cat.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Content ─────────────────────────────────────────── */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            {isLoading || vercelSearching ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-5 animate-spin text-zinc-600" />
              </div>
            ) : activeTab === 'browse' ? (
              filteredMarketplace.length === 0 ? (
                sourceFilter === 'vercel' || sourceFilter === 'all' ? (
                  <EmptyState
                    icon={Search}
                    title={search.trim() ? 'No skills found' : 'Search Skills.sh'}
                    description={search.trim() ? 'Try adjusting your search or filters' : 'Type a query to search 44,000+ skills from Skills.sh'}
                  />
                ) : (
                  <EmptyState
                    icon={Search}
                    title="No skills found"
                    description="Try adjusting your search or filters"
                  />
                )
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {filteredMarketplace.map((skill) => (
                    <MarketplaceCard
                      key={skill.id}
                      skill={skill}
                      installedIds={installedIds}
                      onInstall={handleInstall}
                      installing={installing}
                    />
                  ))}
                </div>
              )
            ) : filteredInstalled.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No installed skills"
                description="Browse the marketplace to discover skills"
              />
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {filteredInstalled.map((skill) => (
                  <InstalledCard
                    key={skill.id}
                    skill={skill}
                    onUninstall={handleUninstall}
                    uninstalling={uninstalling}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3">
          <p className="text-[11px] text-zinc-600">
            {activeTab === 'browse' ? (
              <>
                {filteredMarketplace.length} skill
                {filteredMarketplace.length !== 1 ? 's' : ''}
                {sourceFilter !== 'all' && (
                  <>
                    {' '}
                    from{' '}
                    {sourceFilter === 'anthropic' ? 'Anthropic' : 'Skills.sh'}
                  </>
                )}
              </>
            ) : (
              <>
                {filteredInstalled.length} installed skill
                {filteredInstalled.length !== 1 ? 's' : ''}
              </>
            )}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-zinc-500"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
