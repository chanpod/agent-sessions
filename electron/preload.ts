import { contextBridge, ipcRenderer } from 'electron'

export interface PtyOptions {
  cwd?: string
  shell?: string
  sshConnectionId?: string
  remoteCwd?: string
}

export interface SSHConnectionConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: 'key' | 'agent' | 'password'
  identityFile?: string
  options?: string[]
}

export interface SSHConnectionResult {
  success: boolean
  connectionId?: string
  error?: string
}

export interface SSHTestResult {
  success: boolean
  message?: string
  error?: string
}

export interface DetectorEvent {
  terminalId: string
  type: string
  timestamp: number
  data: any
}

export interface ShellInfo {
  name: string
  path: string
}

export interface SystemInfo {
  platform: NodeJS.Platform
  arch: string
  version: string
  cwd: string
}

export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  title: string
  createdAt: number
}

export interface ScriptInfo {
  name: string
  command: string
}

export interface ProjectScripts {
  hasPackageJson: boolean
  scripts: ScriptInfo[]
  packageManager?: string
  projectName?: string
  error?: string
}

export interface GitInfo {
  isGitRepo: boolean
  branch?: string
  hasChanges?: boolean
  error?: string
}

export interface GitBranchList {
  success: boolean
  currentBranch?: string
  localBranches?: string[]
  remoteBranches?: string[]
  error?: string
}

export interface GitResult {
  success: boolean
  error?: string
}

export interface ChangedFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'copied'
  staged: boolean
}

export interface ChangedFilesResult {
  success: boolean
  files?: ChangedFile[]
  error?: string
}

export interface GitFileContentResult {
  success: boolean
  content?: string
  error?: string
  isNew?: boolean
}

export interface FileReadResult {
  success: boolean
  content?: string
  size?: number
  modified?: string
  error?: string
}

export interface FileWriteResult {
  success: boolean
  error?: string
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface DirListResult {
  success: boolean
  items?: DirEntry[]
  error?: string
}

export interface ReviewFinding {
  id: string
  file: string
  line?: number
  endLine?: number
  severity: 'critical' | 'warning' | 'info' | 'suggestion'
  category: string
  title: string
  description: string
  suggestion?: string
}

export interface ReviewResult {
  success: boolean
  reviewId?: string
  error?: string
}

export interface ReviewCompletedEvent {
  reviewId: string
  findings: ReviewFinding[]
  summary?: string
}

export interface ReviewProgressEvent {
  reviewId: string
  currentFile?: string
  fileIndex: number
  totalFiles: number
  message: string
}

const electronAPI = {
  pty: {
    create: (options: PtyOptions): Promise<TerminalInfo> =>
      ipcRenderer.invoke('pty:create', options),
    createWithCommand: (shell: string, args: string[], displayCwd: string): Promise<TerminalInfo> =>
      ipcRenderer.invoke('pty:create-with-command', shell, args, displayCwd),
    write: (id: string, data: string): Promise<void> =>
      ipcRenderer.invoke('pty:write', id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill: (id: string): Promise<void> =>
      ipcRenderer.invoke('pty:kill', id),
    list: (): Promise<TerminalInfo[]> =>
      ipcRenderer.invoke('pty:list'),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onExit: (callback: (id: string, code: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, code: number) => callback(id, code)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    },
    onTitleChange: (callback: (id: string, title: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, title: string) => callback(id, title)
      ipcRenderer.on('pty:title', handler)
      return () => ipcRenderer.removeListener('pty:title', handler)
    },
  },
  detector: {
    onEvent: (callback: (event: DetectorEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, detectorEvent: DetectorEvent) => callback(detectorEvent)
      ipcRenderer.on('detector:event', handler)
      return () => ipcRenderer.removeListener('detector:event', handler)
    },
  },
  system: {
    getShells: (): Promise<ShellInfo[]> =>
      ipcRenderer.invoke('system:get-shells'),
    getInfo: (): Promise<SystemInfo> =>
      ipcRenderer.invoke('system:get-info'),
    openInEditor: (projectPath: string): Promise<{ success: boolean; editor?: string; error?: string }> =>
      ipcRenderer.invoke('system:open-in-editor', projectPath),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('system:open-external', url),
  },
  dialog: {
    openDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:open-directory'),
  },
  project: {
    getScripts: (projectPath: string): Promise<ProjectScripts> =>
      ipcRenderer.invoke('project:get-scripts', projectPath),
  },
  git: {
    getInfo: (projectPath: string): Promise<GitInfo> =>
      ipcRenderer.invoke('git:get-info', projectPath),
    listBranches: (projectPath: string): Promise<GitBranchList> =>
      ipcRenderer.invoke('git:list-branches', projectPath),
    checkout: (projectPath: string, branch: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:checkout', projectPath, branch),
    fetch: (projectPath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:fetch', projectPath),
    watch: (projectPath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:watch', projectPath),
    unwatch: (projectPath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:unwatch', projectPath),
    getChangedFiles: (projectPath: string): Promise<ChangedFilesResult> =>
      ipcRenderer.invoke('git:get-changed-files', projectPath),
    getFileContent: (projectPath: string, filePath: string): Promise<GitFileContentResult> =>
      ipcRenderer.invoke('git:get-file-content', projectPath, filePath),
    stageFile: (projectPath: string, filePath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:stage-file', projectPath, filePath),
    unstageFile: (projectPath: string, filePath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:unstage-file', projectPath, filePath),
    discardFile: (projectPath: string, filePath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:discard-file', projectPath, filePath),
    commit: (projectPath: string, message: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:commit', projectPath, message),
    push: (projectPath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:push', projectPath),
    pull: (projectPath: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:pull', projectPath),
    onChanged: (callback: (projectPath: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, projectPath: string) => callback(projectPath)
      ipcRenderer.on('git:changed', handler)
      return () => ipcRenderer.removeListener('git:changed', handler)
    },
  },
  review: {
    start: (projectPath: string, files: string[], reviewId?: string): Promise<ReviewResult> =>
      ipcRenderer.invoke('review:start', projectPath, files, reviewId),
    startLowRiskReview: (reviewId: string, lowRiskFiles: string[], highRiskFiles: string[]): Promise<{ success: boolean; findingCount?: number; error?: string }> =>
      ipcRenderer.invoke('review:start-low-risk', reviewId, lowRiskFiles, highRiskFiles),
    reviewHighRiskFile: (reviewId: string): Promise<{ success: boolean; complete?: boolean; findingCount?: number; error?: string }> =>
      ipcRenderer.invoke('review:review-high-risk-file', reviewId),
    cancel: (reviewId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('review:cancel', reviewId),
    generateFileHashes: (projectPath: string, files: string[]): Promise<{ success: boolean; hashes?: Record<string, string>; error?: string }> =>
      ipcRenderer.invoke('review:generateFileHashes', projectPath, files),

    // Events
    onClassifications: (callback: (event: any) => void) => {
      const handler = (_: any, event: any) => callback(event)
      ipcRenderer.on('review:classifications', handler)
      return () => ipcRenderer.removeListener('review:classifications', handler)
    },
    onLowRiskFindings: (callback: (event: any) => void) => {
      const handler = (_: any, event: any) => callback(event)
      ipcRenderer.on('review:low-risk-findings', handler)
      return () => ipcRenderer.removeListener('review:low-risk-findings', handler)
    },
    onHighRiskStatus: (callback: (event: any) => void) => {
      const handler = (_: any, event: any) => callback(event)
      ipcRenderer.on('review:high-risk-status', handler)
      return () => ipcRenderer.removeListener('review:high-risk-status', handler)
    },
    onHighRiskFindings: (callback: (event: any) => void) => {
      const handler = (_: any, event: any) => callback(event)
      ipcRenderer.on('review:high-risk-findings', handler)
      return () => ipcRenderer.removeListener('review:high-risk-findings', handler)
    },
    onFailed: (callback: (reviewId: string, error: string) => void) => {
      const handler = (_: any, reviewId: string, error: string) => callback(reviewId, error)
      ipcRenderer.on('review:failed', handler)
      return () => ipcRenderer.removeListener('review:failed', handler)
    },
  },
  store: {
    get: (key: string): Promise<unknown> =>
      ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke('store:set', key, value),
    delete: (key: string): Promise<void> =>
      ipcRenderer.invoke('store:delete', key),
    clear: (): Promise<void> =>
      ipcRenderer.invoke('store:clear'),
  },
  fs: {
    readFile: (filePath: string): Promise<FileReadResult> =>
      ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string): Promise<FileWriteResult> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    listDir: (dirPath: string): Promise<DirListResult> =>
      ipcRenderer.invoke('fs:listDir', dirPath),
  },
  ssh: {
    connect: (config: SSHConnectionConfig): Promise<SSHConnectionResult> =>
      ipcRenderer.invoke('ssh:connect', config),
    disconnect: (connectionId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('ssh:disconnect', connectionId),
    test: (config: SSHConnectionConfig): Promise<SSHTestResult> =>
      ipcRenderer.invoke('ssh:test', config),
    getStatus: (connectionId: string): Promise<{ connected: boolean; error?: string }> =>
      ipcRenderer.invoke('ssh:get-status', connectionId),
    onStatusChange: (callback: (connectionId: string, connected: boolean, error?: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, connectionId: string, connected: boolean, error?: string) =>
        callback(connectionId, connected, error)
      ipcRenderer.on('ssh:status-change', handler)
      return () => ipcRenderer.removeListener('ssh:status-change', handler)
    },
    // Project-level SSH connections
    connectProject: (projectId: string, sshConnectionId: string): Promise<{ success: boolean; error?: string; requiresInteractive?: boolean }> =>
      ipcRenderer.invoke('ssh:connect-project', projectId, sshConnectionId),
    disconnectProject: (projectId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('ssh:disconnect-project', projectId),
    getInteractiveMasterCommand: (projectId: string): Promise<{ shell: string; args: string[] } | null> =>
      ipcRenderer.invoke('ssh:get-interactive-master-command', projectId),
    markProjectConnected: (projectId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('ssh:mark-project-connected', projectId),
  },
  updater: {
    install: (): Promise<void> =>
      ipcRenderer.invoke('update:install'),
    dismiss: (version: string): Promise<void> =>
      ipcRenderer.invoke('update:dismiss', version),
    onUpdateAvailable: (callback: (info: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onUpdateDownloaded: (callback: (info: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },
    onDownloadProgress: (callback: (progress: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress)
      ipcRenderer.on('update:progress', handler)
      return () => ipcRenderer.removeListener('update:progress', handler)
    },
  },
}

contextBridge.exposeInMainWorld('electron', electronAPI)

console.log('[Preload] Electron API exposed to window.electron')
console.log('[Preload] API methods:', Object.keys(electronAPI))

// Type declaration for the renderer
declare global {
  interface Window {
    electron: typeof electronAPI
  }
}
