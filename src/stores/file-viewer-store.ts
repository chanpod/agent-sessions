import { create } from 'zustand'

// Normalize line endings to LF for consistent diff comparison
// This fixes the issue where git content (LF) and Windows file content (CRLF)
// would show every line as changed in the Monaco DiffEditor
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

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
  projectId?: string // Project ID for SSH file operations
}

interface FileViewerState {
  openFiles: OpenFile[]
  activeFilePath: string | null
  isVisible: boolean
  showDiff: boolean // Whether to show diff view

  // Actions
  openFile: (path: string, name: string, content: string, projectPath?: string, projectId?: string) => void
  closeFile: (path: string) => void
  closeOtherFiles: (path: string) => void
  closeAllFiles: () => void
  closeFilesToRight: (path: string) => void
  closeFilesToLeft: (path: string) => void
  setActiveFile: (path: string | null) => void
  updateFileContent: (path: string, content: string) => void
  markFileSaved: (path: string) => void
  toggleVisibility: () => void
  setVisibility: (visible: boolean) => void
  toggleDiffMode: () => void
  setShowDiff: (show: boolean) => void
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

  openFile: (path, name, content, projectPath, projectId) => {
    const { openFiles } = get()
    const existing = openFiles.find((f) => f.path === path)

    if (existing) {
      // File already open, just make it active
      set({ activeFilePath: path, isVisible: true })
      return
    }

    // Normalize line endings for consistent diff comparison
    const normalizedContent = normalizeLineEndings(content)

    const newFile: OpenFile = {
      path,
      name,
      content: normalizedContent,
      language: detectLanguage(name),
      isDirty: false,
      originalContent: normalizedContent,
      projectPath,
      projectId,
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

  closeOtherFiles: (path) => {
    const { openFiles } = get()
    const fileToKeep = openFiles.find((f) => f.path === path)
    if (!fileToKeep) return

    set({
      openFiles: [fileToKeep],
      activeFilePath: path,
    })
  },

  closeAllFiles: () => {
    set({
      openFiles: [],
      activeFilePath: null,
      isVisible: false,
    })
  },

  closeFilesToRight: (path) => {
    const { openFiles, activeFilePath } = get()
    const index = openFiles.findIndex((f) => f.path === path)
    if (index === -1) return

    const newFiles = openFiles.slice(0, index + 1)
    const activeFileStillExists = newFiles.some((f) => f.path === activeFilePath)

    set({
      openFiles: newFiles,
      activeFilePath: activeFileStillExists ? activeFilePath : path,
      isVisible: newFiles.length > 0,
    })
  },

  closeFilesToLeft: (path) => {
    const { openFiles, activeFilePath } = get()
    const index = openFiles.findIndex((f) => f.path === path)
    if (index === -1) return

    const newFiles = openFiles.slice(index)
    const activeFileStillExists = newFiles.some((f) => f.path === activeFilePath)

    set({
      openFiles: newFiles,
      activeFilePath: activeFileStillExists ? activeFilePath : path,
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

  setShowDiff: (show) => {
    set({ showDiff: show })
  },

  setGitContent: (path, gitContent) => {
    // Normalize line endings for consistent diff comparison
    const normalizedGitContent = gitContent !== undefined
      ? normalizeLineEndings(gitContent)
      : undefined

    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, gitContent: normalizedGitContent, gitContentLoaded: true }
          : f
      ),
    }))
  },
}))
