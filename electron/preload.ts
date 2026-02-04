import { contextBridge, ipcRenderer } from 'electron'

export interface PtyOptions {
  cwd?: string
  shell?: string
  sshConnectionId?: string
  remoteCwd?: string
  id?: string
  projectId?: string
  initialCommand?: string  // Command to execute immediately (used for agent terminals)
  title?: string           // Custom title override
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

export interface SearchResult {
  file: string
  line: number
  column: number
  content: string
  matchStart: number
  matchEnd: number
}

export interface SearchContentResult {
  success: boolean
  results?: SearchResult[]
  error?: string
}

export interface CliToolDetectionResult {
  id: string
  name: string
  installed: boolean
  version?: string
  path?: string
  error?: string
}

export interface AllCliToolsResult {
  tools: CliToolDetectionResult[]
  success: boolean
  error?: string
}

export interface UpdateCheckResult {
  agentId: string
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  error?: string
}

const electronAPI = {
  pty: {
    create: (options: PtyOptions): Promise<TerminalInfo> =>
      ipcRenderer.invoke('pty:create', options),
    createWithCommand: (shell: string, args: string[], displayCwd: string, hidden?: boolean): Promise<TerminalInfo> =>
      ipcRenderer.invoke('pty:create-with-command', shell, args, displayCwd, hidden),
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
    getShells: (projectPath?: string): Promise<ShellInfo[]> =>
      ipcRenderer.invoke('system:get-shells', projectPath),
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
    getScripts: (projectPath: string, projectId?: string): Promise<ProjectScripts> =>
      ipcRenderer.invoke('project:get-scripts', projectPath, projectId),
  },
  git: {
    getInfo: (projectPath: string, projectId?: string): Promise<GitInfo> =>
      ipcRenderer.invoke('git:get-info', projectPath, projectId),
    listBranches: (projectPath: string, projectId?: string): Promise<GitBranchList> =>
      ipcRenderer.invoke('git:list-branches', projectPath, projectId),
    checkout: (projectPath: string, branch: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:checkout', projectPath, branch, projectId),
    fetch: (projectPath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:fetch', projectPath, projectId),
    watch: (projectPath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:watch', projectPath, projectId),
    unwatch: (projectPath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:unwatch', projectPath, projectId),
    getChangedFiles: (projectPath: string, projectId?: string): Promise<ChangedFilesResult> =>
      ipcRenderer.invoke('git:get-changed-files', projectPath, projectId),
    getFileContent: (projectPath: string, filePath: string, projectId?: string): Promise<GitFileContentResult> =>
      ipcRenderer.invoke('git:get-file-content', projectPath, filePath, projectId),
    stageFile: (projectPath: string, filePath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:stage-file', projectPath, filePath, projectId),
    unstageFile: (projectPath: string, filePath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:unstage-file', projectPath, filePath, projectId),
    discardFile: (projectPath: string, filePath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:discard-file', projectPath, filePath, projectId),
    commit: (projectPath: string, message: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:commit', projectPath, message, projectId),
    push: (projectPath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:push', projectPath, projectId),
    pull: (projectPath: string, projectId?: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:pull', projectPath, projectId),
    onChanged: (callback: (projectPath: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, projectPath: string) => callback(projectPath)
      ipcRenderer.on('git:changed', handler)
      return () => ipcRenderer.removeListener('git:changed', handler)
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
    readFile: (filePath: string, projectId?: string): Promise<FileReadResult> =>
      ipcRenderer.invoke('fs:readFile', filePath, projectId),
    writeFile: (filePath: string, content: string, projectId?: string): Promise<FileWriteResult> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content, projectId),
    listDir: (dirPath: string, projectId?: string): Promise<DirListResult> =>
      ipcRenderer.invoke('fs:listDir', dirPath, projectId),
    searchContent: (projectPath: string, query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; userExclusions?: string[] }, projectId?: string): Promise<SearchContentResult> =>
      ipcRenderer.invoke('fs:searchContent', projectPath, query, options, projectId),
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
    onProjectStatusChange: (callback: (projectId: string, connected: boolean, error?: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, projectId: string, connected: boolean, error?: string) =>
        callback(projectId, connected, error)
      ipcRenderer.on('ssh:project-status-change', handler)
      return () => ipcRenderer.removeListener('ssh:project-status-change', handler)
    },
    // Project-level SSH connections (using ControlMaster)
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
  window: {
    minimize: (): Promise<void> =>
      ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> =>
      ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> =>
      ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> =>
      ipcRenderer.invoke('window:isMaximized'),
    onMaximize: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('window:maximize', handler)
      return () => ipcRenderer.removeListener('window:maximize', handler)
    },
    onUnmaximize: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('window:unmaximize', handler)
      return () => ipcRenderer.removeListener('window:unmaximize', handler)
    },
  },
  menu: {
    executeRole: (role: string): Promise<void> =>
      ipcRenderer.invoke('menu:executeRole', role),
    checkForUpdates: (): Promise<void> =>
      ipcRenderer.invoke('menu:checkForUpdates'),
  },
  cli: {
    detectAll: (projectPath: string, projectId?: string, forceRefresh?: boolean): Promise<AllCliToolsResult> =>
      ipcRenderer.invoke('cli:detect-all', projectPath, projectId, forceRefresh),
    detect: (toolId: string, projectPath: string, projectId?: string): Promise<CliToolDetectionResult> =>
      ipcRenderer.invoke('cli:detect', toolId, projectPath, projectId),
    install: (agentId: string, method: 'npm' | 'native' | 'brew'): Promise<{success: boolean; output: string; error?: string}> =>
      ipcRenderer.invoke('cli:install', agentId, method),
    getPlatform: (): Promise<'windows' | 'wsl' | 'macos' | 'linux'> =>
      ipcRenderer.invoke('cli:get-platform'),
    checkUpdate: (agentId: string, currentVersion: string | null): Promise<UpdateCheckResult> =>
      ipcRenderer.invoke('cli:check-update', agentId, currentVersion),
    checkUpdates: (agents: Array<{ id: string; version: string | null }>): Promise<UpdateCheckResult[]> =>
      ipcRenderer.invoke('cli:check-updates', agents),
  },
  agent: {
    createTerminal: (options: {
      projectId: string
      agentId: string  // 'claude' | 'gemini' | 'codex'
      context?: string
      cwd: string
    }): Promise<{ success: boolean; terminal?: TerminalInfo; error?: string }> =>
      ipcRenderer.invoke('agent:create-terminal', options),
    injectContext: (terminalId: string, context: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:inject-context', terminalId, context),
    // Agent process API
    spawn: (options: { agentType: 'claude' | 'codex' | 'gemini'; cwd: string; sessionId?: string; resumeSessionId?: string }) =>
      ipcRenderer.invoke('agent:spawn', options),
    sendMessage: (id: string, message: { type: 'user'; message: { role: 'user'; content: string } }) =>
      ipcRenderer.invoke('agent:send-message', id, message),
    kill: (id: string) =>
      ipcRenderer.invoke('agent:kill', id),
    list: () =>
      ipcRenderer.invoke('agent:list'),
    onStreamEvent: (callback: (id: string, event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: unknown) => callback(id, data)
      ipcRenderer.on('agent:stream-event', handler)
      return () => ipcRenderer.removeListener('agent:stream-event', handler)
    },
    onProcessExit: (callback: (id: string, code: number | null) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, code: number | null) => callback(id, code)
      ipcRenderer.on('agent:process-exit', handler)
      return () => ipcRenderer.removeListener('agent:process-exit', handler)
    },
    onError: (callback: (id: string, error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, error: string) => callback(id, error)
      ipcRenderer.on('agent:error', handler)
      return () => ipcRenderer.removeListener('agent:error', handler)
    },
  },
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke('app:get-version'),
  },
  service: {
    discover: (projectPath: string, projectId: string): Promise<{ success: boolean; services: any[]; error?: string }> =>
      ipcRenderer.invoke('service:discover', projectPath, projectId),
    getStatus: (serviceId: string): Promise<{ success: boolean; status: string; error?: string }> =>
      ipcRenderer.invoke('service:getStatus', serviceId),
    start: (serviceId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('service:start', serviceId),
    stop: (serviceId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('service:stop', serviceId),
    restart: (serviceId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('service:restart', serviceId),
    list: (projectId?: string): Promise<{ success: boolean; services: any[]; error?: string }> =>
      ipcRenderer.invoke('service:list', projectId),
  },
  docker: {
    isAvailable: (): Promise<{ success: boolean; available: boolean; error?: string }> =>
      ipcRenderer.invoke('docker:isAvailable'),
    getLogs: (serviceId: string, tail?: number): Promise<{ success: boolean; logs: string; error?: string }> =>
      ipcRenderer.invoke('docker:getLogs', serviceId, tail),
  },
  permission: {
    respond: (id: string, decision: 'allow' | 'deny', reason?: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('permission:respond', id, decision, reason),
    checkHook: (projectPath: string): Promise<boolean> =>
      ipcRenderer.invoke('permission:check-hook', projectPath),
    installHook: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('permission:install-hook', projectPath),
    onRequest: (callback: (request: { id: string; sessionId: string; toolName: string; toolInput: Record<string, unknown>; receivedAt: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: { id: string; sessionId: string; toolName: string; toolInput: Record<string, unknown>; receivedAt: number }) => callback(request)
      ipcRenderer.on('permission:request', handler)
      return () => ipcRenderer.removeListener('permission:request', handler)
    },
    onExpired: (callback: (id: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string) => callback(id)
      ipcRenderer.on('permission:expired', handler)
      return () => ipcRenderer.removeListener('permission:expired', handler)
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
