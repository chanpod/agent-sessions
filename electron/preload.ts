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
}

contextBridge.exposeInMainWorld('electron', electronAPI)

// Type declaration for the renderer
declare global {
  interface Window {
    electron: typeof electronAPI
  }
}
