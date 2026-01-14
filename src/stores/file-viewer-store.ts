import { create } from 'zustand'

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  isDirty: boolean
  originalContent: string
  // For diff view
  gitContent?: string // Content from git HEAD
  gitContentLoaded?: boolean // Whether we've tried to load git content
  projectPath?: string // Project path for git operations
}

interface FileViewerState {
  openFiles: OpenFile[]
  activeFilePath: string | null
  isVisible: boolean
  showDiff: boolean // Whether to show diff view

  // Actions
  openFile: (path: string, name: string, content: string, projectPath?: string) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  markFileSaved: (path: string) => void
  toggleVisibility: () => void
  setVisibility: (visible: boolean) => void
  toggleDiffMode: () => void
  setGitContent: (path: string, gitContent: string | undefined) => void
}

// Detect language from file extension
function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    vue: 'vue',
    svelte: 'svelte',
    php: 'php',
    dockerfile: 'dockerfile',
    toml: 'toml',
    ini: 'ini',
    env: 'dotenv',
  }
  return languageMap[ext] || 'plaintext'
}

export const useFileViewerStore = create<FileViewerState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,
  isVisible: false,
  showDiff: false,

  openFile: (path, name, content, projectPath) => {
    const { openFiles } = get()
    const existing = openFiles.find((f) => f.path === path)

    if (existing) {
      // File already open, just make it active
      set({ activeFilePath: path, isVisible: true })
      return
    }

    const newFile: OpenFile = {
      path,
      name,
      content,
      language: detectLanguage(name),
      isDirty: false,
      originalContent: content,
      projectPath,
      gitContentLoaded: false,
    }

    set({
      openFiles: [...openFiles, newFile],
      activeFilePath: path,
      isVisible: true,
    })
  },

  closeFile: (path) => {
    const { openFiles, activeFilePath } = get()
    const newFiles = openFiles.filter((f) => f.path !== path)

    let newActiveFile = activeFilePath
    if (activeFilePath === path) {
      // Find next file to make active
      const closedIndex = openFiles.findIndex((f) => f.path === path)
      if (newFiles.length > 0) {
        const nextIndex = Math.min(closedIndex, newFiles.length - 1)
        newActiveFile = newFiles[nextIndex]?.path ?? null
      } else {
        newActiveFile = null
      }
    }

    set({
      openFiles: newFiles,
      activeFilePath: newActiveFile,
      isVisible: newFiles.length > 0,
    })
  },

  setActiveFile: (path) => {
    set({ activeFilePath: path })
  },

  updateFileContent: (path, content) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, content, isDirty: content !== f.originalContent }
          : f
      ),
    }))
  },

  markFileSaved: (path) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, isDirty: false, originalContent: f.content }
          : f
      ),
    }))
  },

  toggleVisibility: () => {
    set((state) => ({ isVisible: !state.isVisible }))
  },

  setVisibility: (visible) => {
    set({ isVisible: visible })
  },

  toggleDiffMode: () => {
    set((state) => ({ showDiff: !state.showDiff }))
  },

  setGitContent: (path, gitContent) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, gitContent, gitContentLoaded: true }
          : f
      ),
    }))
  },
}))
