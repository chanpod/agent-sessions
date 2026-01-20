import { useState, useRef, useEffect } from 'react'
import { Search, FileText, AlertCircle } from 'lucide-react'
import { useFileViewerStore } from '../stores/file-viewer-store'
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

export function SearchTab({ projectId, projectPath }: SearchTabProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const { openFile } = useFileViewerStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSearch = async () => {
    if (!query.trim()) {
      setResults([])
      return
    }

    setIsSearching(true)

    try {
      const result = await window.electron.fs.searchContent(
        projectPath,
        query,
        {
          caseSensitive,
          wholeWord,
          useRegex,
        },
        projectId
      )

      if (result.success && result.results) {
        setResults(result.results)
      } else {
        console.error('Search failed:', result.error)
        setResults([])
      }
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="max-h-[400px] flex flex-col">
      {/* Search Input */}
      <div className="p-3 border-b border-zinc-800 space-y-2">
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
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3">
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
          <div className="space-y-3">
            {results.map((result, index) => (
              <div
                key={`${result.file}-${index}`}
                className="cursor-pointer hover:bg-zinc-800/50 rounded p-2 transition-colors"
                onClick={() => {
                  // Open the file at the specific line
                  const fullPath = `${projectPath}/${result.file}`.replace(/\/+/g, '/')
                  openFile(fullPath, result.line)
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-xs text-zinc-400">{result.file}</span>
                  <span className="text-xs text-zinc-600">:{result.line}</span>
                </div>
                <div className="text-xs font-mono text-zinc-300 ml-5">
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
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
