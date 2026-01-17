import { create } from 'zustand'

interface FileSearchStore {
  isOpen: boolean
  query: string
  selectedIndex: number
  files: string[]
  filteredFiles: string[]

  openSearch: () => void
  closeSearch: () => void
  setQuery: (query: string) => void
  setFiles: (files: string[]) => void
  setSelectedIndex: (index: number) => void
  selectNext: () => void
  selectPrevious: () => void
  reset: () => void
}

export const useFileSearchStore = create<FileSearchStore>((set, get) => ({
  isOpen: false,
  query: '',
  selectedIndex: 0,
  files: [],
  filteredFiles: [],

  openSearch: () => set({ isOpen: true, query: '', selectedIndex: 0 }),

  closeSearch: () => set({ isOpen: false, query: '', selectedIndex: 0, files: [], filteredFiles: [] }),

  setQuery: (query) => {
    const { files } = get()
    const lowerQuery = query.toLowerCase()

    // Fuzzy search: match files that contain all characters in order
    const filteredFiles = query === ''
      ? files
      : files.filter(file => {
          const lowerFile = file.toLowerCase()
          let queryIndex = 0

          for (let i = 0; i < lowerFile.length && queryIndex < lowerQuery.length; i++) {
            if (lowerFile[i] === lowerQuery[queryIndex]) {
              queryIndex++
            }
          }

          return queryIndex === lowerQuery.length
        })
        .sort((a, b) => {
          // Prioritize matches at the start of the filename
          const aName = a.split(/[/\\]/).pop() || ''
          const bName = b.split(/[/\\]/).pop() || ''
          const aStartsWith = aName.toLowerCase().startsWith(lowerQuery)
          const bStartsWith = bName.toLowerCase().startsWith(lowerQuery)

          if (aStartsWith && !bStartsWith) return -1
          if (!aStartsWith && bStartsWith) return 1

          // Then prioritize shorter paths
          return a.length - b.length
        })

    set({ query, filteredFiles, selectedIndex: 0 })
  },

  setFiles: (files) => set({ files, filteredFiles: files }),

  setSelectedIndex: (index) => set({ selectedIndex: index }),

  selectNext: () => {
    const { selectedIndex, filteredFiles } = get()
    if (filteredFiles.length === 0) return
    set({ selectedIndex: (selectedIndex + 1) % filteredFiles.length })
  },

  selectPrevious: () => {
    const { selectedIndex, filteredFiles } = get()
    if (filteredFiles.length === 0) return
    set({ selectedIndex: (selectedIndex - 1 + filteredFiles.length) % filteredFiles.length })
  },

  reset: () => set({ isOpen: false, query: '', selectedIndex: 0, files: [], filteredFiles: [] })
}))
