export interface PtyOptions {
  cwd?: string
  shell?: string
  sshConnectionId?: string // For SSH connections
  remoteCwd?: string // Remote working directory for SSH
  id?: string // Optional ID to reuse (for reconnection)
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

export interface ElectronAPI {
  pty: {
    create: (options: PtyOptions) => Promise<TerminalInfo>
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
  }
  system: {
    getShells: () => Promise<ShellInfo[]>
    getInfo: () => Promise<SystemInfo>
    openInEditor: (projectPath: string) => Promise<{ success: boolean; editor?: string; error?: string }>
  }
  dialog: {
    openDirectory: () => Promise<string | null>
  }
  project: {
    getScripts: (projectPath: string) => Promise<ProjectScripts>
  }
  git: {
    getInfo: (projectPath: string) => Promise<GitInfo>
    listBranches: (projectPath: string) => Promise<GitBranchList>
    checkout: (projectPath: string, branch: string) => Promise<GitResult>
    fetch: (projectPath: string) => Promise<GitResult>
    watch: (projectPath: string) => Promise<GitResult>
    unwatch: (projectPath: string) => Promise<GitResult>
    getChangedFiles: (projectPath: string) => Promise<ChangedFilesResult>
    getFileContent: (projectPath: string, filePath: string) => Promise<GitFileContentResult>
    stageFile: (projectPath: string, filePath: string) => Promise<GitResult>
    unstageFile: (projectPath: string, filePath: string) => Promise<GitResult>
    discardFile: (projectPath: string, filePath: string) => Promise<GitResult>
    commit: (projectPath: string, message: string) => Promise<GitResult>
    push: (projectPath: string) => Promise<GitResult>
    pull: (projectPath: string) => Promise<GitResult>
    onChanged: (callback: (projectPath: string) => void) => () => void
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
    clear: () => Promise<void>
  }
  fs: {
    readFile: (filePath: string) => Promise<FileReadResult>
    writeFile: (filePath: string, content: string) => Promise<FileWriteResult>
    listDir: (dirPath: string) => Promise<DirListResult>
  }
  ssh: {
    connect: (config: SSHConnectionConfig) => Promise<SSHConnectionResult>
    disconnect: (connectionId: string) => Promise<{ success: boolean; error?: string }>
    test: (config: SSHConnectionConfig) => Promise<SSHTestResult>
    getStatus: (connectionId: string) => Promise<{ connected: boolean; error?: string }>
    onStatusChange: (callback: (connectionId: string, connected: boolean, error?: string) => void) => () => void
  }
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}

export {}
