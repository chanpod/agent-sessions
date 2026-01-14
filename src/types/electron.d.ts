export interface PtyOptions {
  cwd?: string
  shell?: string
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
  system: {
    getShells: () => Promise<ShellInfo[]>
    getInfo: () => Promise<SystemInfo>
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
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
    clear: () => Promise<void>
  }
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}

export {}
