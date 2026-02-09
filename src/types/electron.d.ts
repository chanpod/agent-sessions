export interface PtyOptions {
  cwd?: string
  shell?: string
  sshConnectionId?: string // For SSH connections
  remoteCwd?: string // Remote working directory for SSH
  id?: string // Optional ID to reuse (for reconnection)
  projectId?: string // Project ID to use SSH tunnel (if available)
  initialCommand?: string // Command to execute immediately (used for agent terminals)
  title?: string // Custom title override
}

export interface ShellInfo {
  name: string
  path: string
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

export interface DetectedServer {
  url: string
  port: number
  protocol: 'http' | 'https'
  host: string
  detectedAt: number
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

export interface PackageScripts {
  packagePath: string // relative path to the package.json from the project root (e.g., ".", "packages/app")
  packageName?: string
  scripts: ScriptInfo[]
  packageManager?: string
}

export interface ProjectScripts {
  hasPackageJson: boolean
  packages: PackageScripts[] // all package.json files found in the project
  // Legacy fields for backward compatibility (deprecated)
  scripts: ScriptInfo[]
  packageManager?: string
  projectName?: string
  error?: string
}

export interface GitInfo {
  isGitRepo: boolean
  branch?: string
  hasChanges?: boolean
  ahead?: number
  behind?: number
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

export interface CliToolDetectionResult {
  id: string
  name: string
  installed: boolean
  version?: string
  path?: string
  error?: string
  installMethod?: 'npm' | 'native' | 'brew' | 'unknown'
  defaultModel?: string
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

export interface AgentProcessInfo {
  id: string
  agentType: 'claude' | 'codex' | 'gemini'
  cwd: string
  isAlive: boolean
}

// Service types for Docker Compose integration
export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'error' | 'unknown'

export interface ServiceInfo {
  id: string
  type: 'pty' | 'docker-compose'
  name: string
  projectId: string
  status: ServiceStatus
  composePath?: string
  serviceName?: string
  pid?: number
  command?: string
}

export interface PermissionRequestForUI {
  id: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  receivedAt: number
}

export interface ElectronAPI {
  pty: {
    create: (options: PtyOptions) => Promise<TerminalInfo>
    createWithCommand: (shell: string, args: string[], displayCwd: string, hidden?: boolean) => Promise<TerminalInfo>
    write: (id: string, data: string) => Promise<void>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    kill: (id: string) => Promise<void>
    list: () => Promise<TerminalInfo[]>
    onData: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (id: string, code: number) => void) => () => void
    onTitleChange: (callback: (id: string, title: string) => void) => () => void
  }
  detector: {
    onEvent: (callback: (event: DetectorEvent) => void) => () => void
    onEventBatch: (callback: (events: DetectorEvent[]) => void) => () => void
  }
  system: {
    getShells: (projectPath?: string) => Promise<ShellInfo[]>
    getInfo: () => Promise<SystemInfo>
    openInEditor: (projectPath: string) => Promise<{ success: boolean; editor?: string; error?: string }>
  }
  app: {
    getVersion: () => Promise<string>
  }
  dialog: {
    openDirectory: () => Promise<string | null>
  }
  project: {
    getScripts: (projectPath: string, projectId?: string) => Promise<ProjectScripts>
  }
  git: {
    getInfo: (projectPath: string, projectId?: string) => Promise<GitInfo>
    listBranches: (projectPath: string, projectId?: string) => Promise<GitBranchList>
    checkout: (projectPath: string, branch: string, projectId?: string) => Promise<GitResult>
    fetch: (projectPath: string, projectId?: string) => Promise<GitResult>
    watch: (projectPath: string, projectId?: string) => Promise<GitResult>
    unwatch: (projectPath: string, projectId?: string) => Promise<GitResult>
    getChangedFiles: (projectPath: string, projectId?: string) => Promise<ChangedFilesResult>
    getFileContent: (projectPath: string, filePath: string, projectId?: string) => Promise<GitFileContentResult>
    stageFile: (projectPath: string, filePath: string, projectId?: string) => Promise<GitResult>
    unstageFile: (projectPath: string, filePath: string, projectId?: string) => Promise<GitResult>
    discardFile: (projectPath: string, filePath: string, projectId?: string) => Promise<GitResult>
    commit: (projectPath: string, message: string, projectId?: string) => Promise<GitResult>
    push: (projectPath: string, projectId?: string) => Promise<GitResult>
    pull: (projectPath: string, projectId?: string) => Promise<GitResult>
    onChanged: (callback: (projectPath: string) => void) => () => void
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
    clear: () => Promise<void>
  }
  fs: {
    readFile: (filePath: string, projectId?: string) => Promise<FileReadResult>
    writeFile: (filePath: string, content: string, projectId?: string) => Promise<FileWriteResult>
    listDir: (dirPath: string, projectId?: string) => Promise<DirListResult>
    searchContent: (projectPath: string, query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; userExclusions?: string[] }, projectId?: string) => Promise<{ success: boolean; results?: Array<{ file: string; line: number; column: number; content: string; matchStart: number; matchEnd: number }>; error?: string }>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximize: (callback: () => void) => () => void
    onUnmaximize: (callback: () => void) => () => void
  }
  menu: {
    executeRole: (role: string) => Promise<void>
    checkForUpdates: () => Promise<void>
  }
  ssh: {
    connect: (config: SSHConnectionConfig) => Promise<SSHConnectionResult>
    disconnect: (connectionId: string) => Promise<{ success: boolean; error?: string }>
    test: (config: SSHConnectionConfig) => Promise<SSHTestResult>
    getStatus: (connectionId: string) => Promise<{ connected: boolean; error?: string }>
    onStatusChange: (callback: (connectionId: string, connected: boolean, error?: string) => void) => () => void
    onProjectStatusChange: (callback: (projectId: string, connected: boolean, error?: string) => void) => () => void
    // Project-level SSH connections (using ControlMaster)
    connectProject: (projectId: string, sshConnectionId: string) => Promise<{ success: boolean; error?: string; requiresInteractive?: boolean }>
    disconnectProject: (projectId: string) => Promise<{ success: boolean; error?: string }>
    getInteractiveMasterCommand: (projectId: string) => Promise<{ shell: string; args: string[] } | null>
    markProjectConnected: (projectId: string) => Promise<{ success: boolean; error?: string }>
    connectProjectWithPassword: (projectId: string, password: string) => Promise<{ success: boolean; error?: string }>
  }
  updater: {
    install: () => Promise<void>
    dismiss: (version: string) => Promise<void>
    onUpdateAvailable: (callback: (info: any) => void) => () => void
    onUpdateDownloaded: (callback: (info: any) => void) => () => void
    onDownloadProgress: (callback: (progress: any) => void) => () => void
  }
  cli: {
    detectAll: (projectPath: string, projectId?: string, forceRefresh?: boolean) => Promise<AllCliToolsResult>
    detect: (toolId: string, projectPath: string, projectId?: string) => Promise<CliToolDetectionResult>
    getPlatform: () => Promise<'windows' | 'macos' | 'linux'>
    install: (agentId: string, method: 'npm' | 'native' | 'brew') => Promise<{ success: boolean; output: string }>
    checkUpdate: (agentId: string, currentVersion: string | null) => Promise<UpdateCheckResult>
    checkUpdates: (agents: Array<{ id: string; version: string | null }>) => Promise<UpdateCheckResult[]>
    getModels: (agentId: string) => Promise<Array<{ id: string; label: string; desc: string }>>
  }
  agent: {
    // Existing terminal-based methods
    createTerminal: (options: {
      projectId: string
      agentId: string  // 'claude' | 'gemini' | 'codex'
      context?: string
      cwd: string
    }) => Promise<{ success: boolean; terminal?: TerminalInfo; error?: string }>
    injectContext: (terminalId: string, context: string) => Promise<{ success: boolean; error?: string }>

    // Agent process methods (JSON streaming)
    spawn: (options: { agentType: 'claude' | 'codex' | 'gemini'; cwd: string; sessionId?: string; resumeSessionId?: string; prompt?: string; model?: string; allowedTools?: string[]; projectId?: string }) => Promise<{ success: boolean; process?: AgentProcessInfo; error?: string }>
    sendMessage: (id: string, message: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
    kill: (id: string) => Promise<{ success: boolean; error?: string }>
    list: () => Promise<{ success: boolean; processes?: AgentProcessInfo[]; error?: string }>

    // Title generation
    generateTitle: (options: { userMessages: string[] }) => Promise<{ success: boolean; title?: string; error?: string }>

    // Event subscriptions
    onStreamEvent: (callback: (id: string, event: unknown) => void) => () => void
    onProcessExit: (callback: (id: string, code: number | null) => void) => () => void
    onError: (callback: (id: string, error: string) => void) => () => void
  }
  service: {
    discover: (projectPath: string, projectId: string) => Promise<{ success: boolean; services: ServiceInfo[]; error?: string }>
    getStatus: (serviceId: string) => Promise<{ success: boolean; status: ServiceStatus; error?: string }>
    start: (serviceId: string) => Promise<{ success: boolean; error?: string }>
    stop: (serviceId: string) => Promise<{ success: boolean; error?: string }>
    restart: (serviceId: string) => Promise<{ success: boolean; error?: string }>
    list: (projectId?: string) => Promise<{ success: boolean; services: ServiceInfo[]; error?: string }>
  }
  docker: {
    isAvailable: () => Promise<{ success: boolean; available: boolean; error?: string }>
    getLogs: (serviceId: string, tail?: number) => Promise<{ success: boolean; logs: string; error?: string }>
  }
  permission: {
    respond: (id: string, decision: 'allow' | 'deny', reason?: string, alwaysAllow?: boolean, bashRule?: string[]) => Promise<{ success: boolean; error?: string }>
    checkHook: (projectPath: string) => Promise<boolean>
    installHook: (projectPath: string) => Promise<{ success: boolean; error?: string }>
    getBashRules: (projectPath: string) => Promise<string[][]>
    getAllowlistConfig: (projectPath: string) => Promise<{ tools: string[]; bashRules: string[][] }>
    removeBashRule: (projectPath: string, rule: string[]) => Promise<{ success: boolean; error?: string }>
    addAllowedTool: (projectPath: string, toolName: string) => Promise<{ success: boolean; error?: string }>
    removeAllowedTool: (projectPath: string, toolName: string) => Promise<{ success: boolean; error?: string }>
    onRequest: (callback: (request: PermissionRequestForUI) => void) => () => void
    onExpired: (callback: (id: string) => void) => () => void
  }
  skill: {
    listInstalled: () => Promise<{ success: boolean; skills: SkillInstalledInfo[]; error?: string }>
    listAvailable: () => Promise<{ success: boolean; skills: SkillAvailableInfo[]; error?: string }>
    searchVercel: (query: string, limit?: number) => Promise<{ success: boolean; skills: VercelSkillInfo[]; error?: string }>
    install: (pluginId: string, source: 'anthropic' | 'vercel', scope?: 'user' | 'project' | 'local', projectPath?: string) => Promise<{ success: boolean; error?: string }>
    uninstall: (pluginId: string) => Promise<{ success: boolean; error?: string }>
    mcpStatus: () => Promise<{ success: boolean; servers: McpServerStatusInfo[]; error?: string }>
    toggle: (pluginId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
  }
  log: {
    openLogsFolder: () => Promise<void>
    getLogPath: () => Promise<string>
    reportRendererError: (errorData: { message: string; stack?: string; componentStack?: string }) => Promise<void>
  }
}

export interface SkillInstalledInfo {
  id: string
  version: string
  scope: 'user' | 'project' | 'local'
  enabled: boolean
  installPath: string
  installedAt: string
  lastUpdated: string
  projectPath?: string
  mcpServers?: Record<string, { command?: string; type?: string; url?: string; args?: string[]; headers?: Record<string, string> }>
}

export interface McpServerStatusInfo {
  name: string
  source: string
  endpoint: string
  status: 'connected' | 'needs_auth' | 'failed' | 'unknown'
}

export interface SkillAvailableInfo {
  pluginId: string
  name: string
  description: string
  marketplaceName: string
  version?: string
  source: string | { source: string; url: string }
  installCount?: number
  category?: string
  homepage?: string
}

export interface VercelSkillInfo {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}

export {}
