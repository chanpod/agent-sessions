import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, FileText, AlertCircle, ChevronDown, ChevronRight, X, Plus, Filter } from 'lucide-react'
import { useFileViewerStore } from '../stores/file-viewer-store'
import { useSearchExclusionsStore } from '../stores/search-exclusions-store'
import { cn } from '../lib/utils'

interface SearchTabProps {
  projectId: string
  projectPath: string
}

interface SearchResult {
  file: string
  line: number
  column: number
  content: string
  matchStart: number
  matchEnd: number
}

// Maximum results to store for performance
const MAX_STORED_RESULTS = 50000
// Number of results to show initially and load more each time
const RESULTS_PER_PAGE = 100

export function SearchTab({ projectId, projectPath }: SearchTabProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [totalResults, setTotalResults] = useState(0)
  const [visibleCount, setVisibleCount] = useState(RESULTS_PER_PAGE)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [showExclusions, setShowExclusions] = useState(false)
  const [newExclusion, setNewExclusion] = useState('')
  const { openFile } = useFileViewerStore()
  const { exclusions, addExclusion, removeExclusion } = useSearchExclusionsStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Reset visible count when results change
  useEffect(() => {
    setVisibleCount(RESULTS_PER_PAGE)
  }, [results])

  const handleSearch = async () => {
    if (!query.trim()) {
      setResults([])
      setTotalResults(0)
      return
    }

    setIsSearching(true)

    try {
      const result = await window.electron!.fs.searchContent(
        projectPath,
        query,
        {
          caseSensitive,
          wholeWord,
          useRegex,
          userExclusions: exclusions,
        },
        projectId
      )

      if (result.success && result.results) {
        const allResults = result.results
        setTotalResults(allResults.length)
        // Cap stored results for memory performance
        setResults(allResults.slice(0, MAX_STORED_RESULTS))
      } else {
        console.error('Search failed:', result.error)
        setResults([])
        setTotalResults(0)
      }
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
      setTotalResults(0)
    } finally {
      setIsSearching(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleResultClick = useCallback(async (result: SearchResult) => {
    // Open the file at the specific line
    const fullPath = `${projectPath}/${result.file}`.replace(/\/+/g, '/')
    if (!window.electron) return

    const fileResult = await window.electron.fs.readFile(fullPath, projectId)
    if (fileResult.success && fileResult.content !== undefined) {
      const fileName = result.file.split('/').pop() || result.file
      openFile(fullPath, fileName, fileResult.content, projectPath, projectId)
    }
  }, [projectPath, projectId, openFile])

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + RESULTS_PER_PAGE, results.length))
  }

  // Format number with commas for readability
  const formatNumber = (num: number): string => {
    return num.toLocaleString()
  }

  // Get the visible slice of results
  const visibleResults = results.slice(0, visibleCount)
  const hasMoreResults = visibleCount < results.length

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
      {/* Search Input */}
      <div className="flex-shrink-0 p-3 border-b border-zinc-800 space-y-2">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded px-3 py-2">
          <Search className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search in files..."
            className="flex-1 bg-transparent border-none outline-none text-xs text-zinc-200 placeholder-zinc-600"
          />
        </div>

        {/* Search Options */}
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            className={cn(
              'px-2 py-1 rounded transition-colors',
              caseSensitive
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            )}
            title="Match Case"
          >
            Aa
          </button>
          <button
            onClick={() => setWholeWord(!wholeWord)}
            className={cn(
              'px-2 py-1 rounded transition-colors',
              wholeWord
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            )}
            title="Match Whole Word"
          >
            Ab
          </button>
          <button
            onClick={() => setUseRegex(!useRegex)}
            className={cn(
              'px-2 py-1 rounded transition-colors',
              useRegex
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            )}
            title="Use Regular Expression"
          >
            .*
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowExclusions(!showExclusions)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded transition-colors',
              showExclusions || exclusions.length > 0
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            )}
            title="Manage Exclusions"
          >
            <Filter className="w-3 h-3" />
            {exclusions.length > 0 && (
              <span className="text-[10px]">({exclusions.length})</span>
            )}
            {showExclusions ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        </div>

        {/* Exclusions Section */}
        {showExclusions && (
          <div className="mt-2 p-2 bg-zinc-800/50 rounded border border-zinc-700/50">
            <div className="text-[10px] text-zinc-500 mb-2">
              Exclude directories or patterns from search (e.g., "logs", "*.min.js")
            </div>

            {/* Add new exclusion */}
            <div className="flex items-center gap-1 mb-2">
              <input
                type="text"
                value={newExclusion}
                onChange={(e) => setNewExclusion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newExclusion.trim()) {
                    addExclusion(newExclusion.trim())
                    setNewExclusion('')
                  }
                }}
                placeholder="Add exclusion..."
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                onClick={() => {
                  if (newExclusion.trim()) {
                    addExclusion(newExclusion.trim())
                    setNewExclusion('')
                  }
                }}
                disabled={!newExclusion.trim()}
                className="p-1 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:hover:bg-zinc-700 transition-colors"
                title="Add Exclusion"
              >
                <Plus className="w-3 h-3 text-zinc-300" />
              </button>
            </div>

            {/* Current exclusions */}
            {exclusions.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {exclusions.map((exclusion) => (
                  <span
                    key={exclusion}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-700/50 rounded text-[10px] text-zinc-300"
                  >
                    {exclusion}
                    <button
                      onClick={() => removeExclusion(exclusion)}
                      className="p-0.5 hover:bg-zinc-600 rounded"
                      title="Remove"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-zinc-600 italic">
                No custom exclusions. Default exclusions (node_modules, .git, etc.) always apply.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!query && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="w-12 h-12 text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500 mb-1">Search across all files</p>
            <p className="text-xs text-zinc-600">Enter text to find in file contents</p>
          </div>
        )}

        {query && !isSearching && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-10 h-10 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400 mb-2">No Results Found</p>
            <p className="text-xs text-zinc-500 max-w-xs">
              No matches found for "{query}". Try adjusting your search options or using a different query.
            </p>
          </div>
        )}

        {isSearching && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
          </div>
        )}

        {results.length > 0 && (
          <>
            {/* Result count header */}
            <div className="flex items-center justify-between mb-2 px-1 flex-shrink-0">
              <span className="text-xs text-zinc-500">
                {totalResults > results.length ? (
                  <>
                    Showing {formatNumber(visibleCount)} of{' '}
                    <span className="text-amber-400">{formatNumber(totalResults)}</span> results
                    {totalResults > MAX_STORED_RESULTS && (
                      <span className="text-zinc-600"> (capped at {formatNumber(MAX_STORED_RESULTS)})</span>
                    )}
                  </>
                ) : visibleCount < results.length ? (
                  <>
                    Showing {formatNumber(visibleCount)} of {formatNumber(results.length)} results
                  </>
                ) : (
                  <>{formatNumber(results.length)} result{results.length !== 1 ? 's' : ''}</>
                )}
              </span>
              {totalResults > results.length && (
                <span className="text-xs text-amber-400/80">
                  Refine your search for better results
                </span>
              )}
            </div>

            {/* Results list - scrolls with parent container */}
            {visibleResults.map((result, index) => (
              <div
                key={`${result.file}-${result.line}-${index}`}
                className="px-1 py-0.5"
              >
                <div
                  className="cursor-pointer hover:bg-zinc-800/50 rounded p-2 transition-colors"
                  onClick={() => handleResultClick(result)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                    <span className="text-xs text-zinc-400 truncate">{result.file}</span>
                    <span className="text-xs text-zinc-600 flex-shrink-0">:{result.line}</span>
                  </div>
                  <div className="text-xs font-mono text-zinc-300 ml-5 truncate">
                    {/* Highlight the matched text */}
                    {result.matchStart >= 0 && result.matchEnd > result.matchStart ? (
                      <>
                        <span>{result.content.substring(0, result.matchStart)}</span>
                        <span className="bg-yellow-500/30 text-yellow-200">
                          {result.content.substring(result.matchStart, result.matchEnd)}
                        </span>
                        <span>{result.content.substring(result.matchEnd)}</span>
                      </>
                    ) : (
                      result.content
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Load more button */}
            {hasMoreResults && (
              <div className="py-3 text-center flex-shrink-0">
                <button
                  onClick={handleLoadMore}
                  className="px-4 py-2 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
                >
                  Show more ({formatNumber(Math.min(RESULTS_PER_PAGE, results.length - visibleCount))} more)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
