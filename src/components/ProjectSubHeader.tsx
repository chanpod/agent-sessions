import React, { useState, useRef, useEffect } from 'react'
import { GitBranch, RefreshCw, Check, Cloud } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { cn } from '../lib/utils'

export const ProjectSubHeader: React.FC = () => {
  const { projects, activeProjectId } = useProjectStore()
  const activeProject = projects.find(p => p.id === activeProjectId)

  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [gitBranches, setGitBranches] = useState<string[]>([])
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const branchButtonRef = useRef<HTMLButtonElement>(null)

  // Fetch git info for active project
  useEffect(() => {
    if (!activeProject || !window.electron || !activeProject.path) {
      setGitBranch(null)
      setGitBranches([])
      return
    }

    const fetchGitInfo = async () => {
      const result = await window.electron.git.getInfo(activeProject.path)
      if (result.isGitRepo) {
        setGitBranch(result.branch || null)

        // Fetch branch list
        const branchesResult = await window.electron.git.listBranches(activeProject.path)
        if (branchesResult.success && branchesResult.localBranches) {
          setGitBranches(branchesResult.localBranches)
        }
      } else {
        setGitBranch(null)
        setGitBranches([])
      }
    }

    fetchGitInfo()

    // Watch for git changes
    window.electron.git.watch(activeProject.path)
    const unsubscribe = window.electron.git.onChanged((changedPath) => {
      if (changedPath === activeProject.path) {
        fetchGitInfo()
      }
    })

    return () => {
      unsubscribe()
      window.electron?.git.unwatch(activeProject.path)
    }
  }, [activeProject?.id, activeProject?.path])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(event.target as Node) &&
          branchButtonRef.current && !branchButtonRef.current.contains(event.target as Node)) {
        setShowBranchMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSwitchBranch = async (branch: string) => {
    if (!activeProject || isCheckingOut) return

    setIsCheckingOut(true)
    try {
      const result = await window.electron.git.checkout(activeProject.path, branch)
      if (result.success) {
        setShowBranchMenu(false)
      }
    } finally {
      setIsCheckingOut(false)
    }
  }

  const handleFetch = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!activeProject || !window.electron || isFetching) return

    setIsFetching(true)
    try {
      await window.electron.git.fetch(activeProject.path)
      // Refresh branch list after fetch
      const result = await window.electron.git.listBranches(activeProject.path)
      if (result.success && result.localBranches) {
        setGitBranches(result.localBranches)
      }
    } finally {
      setIsFetching(false)
    }
  }

  const handleOpenBranchTool = () => {
    if (!activeProject) return
    window.electron.openExternalTool('branch', activeProject.path)
    setShowBranchMenu(false)
  }

  if (!activeProject) {
    return (
      <div className="h-8 bg-[#252526] border-b border-gray-800 flex items-center px-4">
        <span className="text-xs text-gray-500">No project selected</span>
      </div>
    )
  }

  return (
    <div className="h-8 bg-[#252526] border-b border-gray-800 flex items-center px-4 gap-3">
      {/* Project Path */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs text-gray-500 truncate" title={activeProject.path}>
          {activeProject.path}
        </span>
      </div>

      {/* Git Branch */}
      {gitBranch && (
        <div className="relative">
          <button
            ref={branchButtonRef}
            onClick={() => setShowBranchMenu(!showBranchMenu)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-700/50 hover:bg-zinc-700 transition-colors"
            title="Switch branch"
          >
            <GitBranch className="w-3 h-3 text-blue-400" />
            <span className="text-xs text-gray-300">{gitBranch}</span>
          </button>

          {/* Branch Menu */}
          {showBranchMenu && (
            <div
              ref={branchMenuRef}
              className="absolute top-full right-0 mt-1 py-1 bg-[#2d2d2d] border border-gray-700 rounded shadow-lg z-50 min-w-[200px] max-h-80 overflow-y-auto"
            >
              {/* Fetch button */}
              <button
                onClick={handleFetch}
                disabled={isFetching}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white text-left border-b border-zinc-700 mb-1"
              >
                <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
                {isFetching ? 'Fetching...' : 'Fetch from remote'}
              </button>

              {/* Branch list */}
              {gitBranches.length > 0 ? (
                <>
                  <div className="px-3 py-1 text-xs text-zinc-500 uppercase">
                    Local branches
                  </div>
                  {gitBranches.map((branch) => (
                    <button
                      key={branch}
                      onClick={() => handleSwitchBranch(branch)}
                      disabled={isCheckingOut || branch === gitBranch}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                        branch === gitBranch
                          ? 'text-green-400 bg-green-500/10'
                          : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                      )}
                    >
                      {branch === gitBranch ? (
                        <Check className="w-3 h-3 text-green-400" />
                      ) : (
                        <GitBranch className="w-3 h-3" />
                      )}
                      <span className="truncate">{branch}</span>
                    </button>
                  ))}
                </>
              ) : (
                <div className="px-3 py-2 text-xs text-zinc-500">
                  No branches found
                </div>
              )}

              <div className="border-t border-zinc-700 mt-1">
                <button
                  onClick={handleOpenBranchTool}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  Open branch tool...
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
