import { contextBridge, ipcRenderer } from 'electron'

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

const electronAPI = {
  pty: {
    create: (options: PtyOptions): Promise<TerminalInfo> =>
      ipcRenderer.invoke('pty:create', options),
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
  system: {
    getShells: (): Promise<ShellInfo[]> =>
      ipcRenderer.invoke('system:get-shells'),
    getInfo: (): Promise<SystemInfo> =>
      ipcRenderer.invoke('system:get-info'),
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
}

contextBridge.exposeInMainWorld('electron', electronAPI)

// Type declaration for the renderer
declare global {
  interface Window {
    electron: typeof electronAPI
  }
}
