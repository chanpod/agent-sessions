import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { GitBranch, Check, Cloud, RefreshCw, Search, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useGitStore } from '@/stores/git-store'

interface BranchSwitcherProps {
  projectId: string
  projectPath: string
}

export function BranchSwitcher({ projectId, projectPath }: BranchSwitcherProps) {
  const gitInfo = useGitStore((state) => state.gitInfo[projectId])
  const refreshGitInfo = useGitStore((state) => state.refreshGitInfo)

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [localBranches, setLocalBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const currentBranch = gitInfo?.branch
  const ahead = gitInfo?.ahead ?? 0
  const behind = gitInfo?.behind ?? 0

  // Load branches when popover opens
  useEffect(() => {
    if (!open || !window.electron) return
    setSearch('')
    setError(null)
    window.electron.git.listBranches(projectPath).then((result) => {
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
    })
    // Focus search after popover animation
    const timer = setTimeout(() => searchInputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [open, projectPath])

  const handleFetch = useCallback(async () => {
    if (!window.electron || isFetching) return
    setIsFetching(true)
    setError(null)
    try {
      await window.electron.git.fetch(projectPath)
      const result = await window.electron.git.listBranches(projectPath)
      if (result.success) {
        setLocalBranches(result.localBranches || [])
        setRemoteBranches(result.remoteBranches || [])
      }
      await refreshGitInfo(projectId, projectPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch from remote')
    } finally {
      setIsFetching(false)
    }
  }, [isFetching, projectPath, projectId, refreshGitInfo])

  const handleCheckout = useCallback(async (branch: string) => {
    if (!window.electron || isCheckingOut) return
    setIsCheckingOut(true)
    setError(null)
    try {
      const result = await window.electron.git.checkout(projectPath, branch)
      if (result.success) {
        await refreshGitInfo(projectId, projectPath)
        setOpen(false)
      } else {
        setError(result.error || 'Checkout failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error during checkout')
    } finally {
      setIsCheckingOut(false)
    }
  }, [isCheckingOut, projectPath, projectId, refreshGitInfo])

  const filteredLocal = useMemo(
    () => localBranches.filter((b) => b.toLowerCase().includes(search.toLowerCase())),
    [localBranches, search]
  )

  const filteredRemote = useMemo(
    () => remoteBranches.filter((b) => b.toLowerCase().includes(search.toLowerCase())),
    [remoteBranches, search]
  )

  if (!currentBranch) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg backdrop-blur-sm transition-all border cursor-pointer',
          open
            ? 'text-blue-300 bg-blue-500/15 border-blue-500/30 hover:bg-blue-500/25'
            : 'text-zinc-500 hover:text-zinc-300 bg-zinc-900/60 hover:bg-zinc-800/80 border-zinc-800/50 hover:border-zinc-700/60'
        )}
        title={`Current branch: ${currentBranch}`}
      >
        <GitBranch className="h-4 w-4 shrink-0" />
        <span className="max-w-[160px] truncate">{currentBranch}</span>

        {/* Ahead/behind indicators */}
        {(ahead > 0 || behind > 0) && (
          <span className="flex items-center gap-1 text-[11px] text-zinc-500 ml-0.5">
            {ahead > 0 && (
              <span className="flex items-center text-emerald-500" title={`${ahead} ahead`}>
                <ArrowUp className="h-3 w-3" />
                {ahead}
              </span>
            )}
            {behind > 0 && (
              <span className="flex items-center text-amber-500" title={`${behind} behind`}>
                <ArrowDown className="h-3 w-3" />
                {behind}
              </span>
            )}
          </span>
        )}
        <ChevronDown className={cn(
          'h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform duration-150',
          open && 'rotate-180'
        )} />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-72 p-0 gap-0 overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/60">
          <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter branches..."
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
          />
        </div>

        {/* Fetch action */}
        <button
          onClick={handleFetch}
          disabled={isFetching}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3 shrink-0', isFetching && 'animate-spin')} />
          {isFetching ? 'Fetching...' : 'Fetch from remote'}
        </button>

        <div className="border-t border-zinc-700/40" />

        {/* Branch list */}
        <div className="max-h-[300px] overflow-y-auto py-1">
          {/* Local branches */}
          {filteredLocal.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Local
              </div>
              {filteredLocal.map((branch) => {
                const isCurrent = branch === currentBranch
                return (
                  <button
                    key={branch}
                    onClick={() => !isCurrent && handleCheckout(branch)}
                    disabled={isCheckingOut || isCurrent}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                      isCurrent
                        ? 'text-blue-400'
                        : 'text-zinc-300 hover:bg-zinc-700/40 hover:text-zinc-100'
                    )}
                  >
                    {isCurrent ? (
                      <Check className="h-3 w-3 shrink-0 text-blue-400" />
                    ) : (
                      <GitBranch className="h-3 w-3 shrink-0 text-zinc-600" />
                    )}
                    <span className="truncate">{branch}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Remote branches */}
          {filteredRemote.length > 0 && (
            <div>
              {filteredLocal.length > 0 && <div className="border-t border-zinc-700/40 my-1" />}
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Remote
              </div>
              {filteredRemote.map((branch) => {
                const localName = branch.split('/').slice(1).join('/')
                const hasLocal = localBranches.includes(localName)
                return (
                  <button
                    key={branch}
                    onClick={() => !hasLocal && handleCheckout(branch)}
                    disabled={isCheckingOut || hasLocal}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                      hasLocal
                        ? 'text-zinc-700'
                        : 'text-zinc-400 hover:bg-zinc-700/40 hover:text-zinc-200'
                    )}
                    title={hasLocal ? 'Already checked out locally' : `Checkout ${branch}`}
                  >
                    <Cloud className="h-3 w-3 shrink-0" />
                    <span className="truncate">{branch}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Empty state */}
          {filteredLocal.length === 0 && filteredRemote.length === 0 && (
            <div className="px-3 py-4 text-xs text-zinc-600 text-center">
              {search ? 'No matching branches' : 'No branches found'}
            </div>
          )}
        </div>

        {/* Checking out indicator */}
        {isCheckingOut && (
          <div className="border-t border-zinc-700/40 px-3 py-1.5 text-[10px] text-zinc-500 flex items-center gap-1.5">
            <RefreshCw className="h-2.5 w-2.5 animate-spin" />
            Switching branch...
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="border-t border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <div className="flex items-start justify-between gap-2">
              <span className="break-words min-w-0">{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-red-500 hover:text-red-300 text-[10px] shrink-0"
              >
                dismiss
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
