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
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}

export {}
