import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Terminal } from 'lucide-react'
import { cn } from '../lib/utils'

interface ShellInfo {
  name: string
  path: string
}

interface ShellSelectorProps {
  onSelect: (shell: ShellInfo) => void
}

export function ShellSelector({ onSelect }: ShellSelectorProps) {
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function loadShells() {
      if (!window.electron) return
      try {
        const availableShells = await window.electron.system.getShells()
        setShells(availableShells)
      } catch (err) {
        console.error('Failed to load shells:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadShells()
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (shell: ShellInfo) => {
    onSelect(shell)
    setIsOpen(false)
  }

  if (isLoading) {
    return (
      <button
        disabled
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md bg-zinc-700 text-zinc-400"
      >
        Loading shells...
      </button>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          New Terminal
        </span>
        <ChevronDown className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-50">
          {shells.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-500">No shells available</div>
          ) : (
            shells.map((shell) => (
              <button
                key={shell.path}
                onClick={() => handleSelect(shell)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors text-left"
              >
                <Terminal className="w-4 h-4 text-zinc-500" />
                <span className="flex-1">{shell.name}</span>
                <span className="text-xs text-zinc-600 truncate max-w-[120px]">{shell.path}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
