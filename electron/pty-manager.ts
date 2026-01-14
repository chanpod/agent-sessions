import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import os from 'os'

export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  title: string
  createdAt: number
}

interface TerminalInstance {
  info: TerminalInfo
  ptyProcess: pty.IPty
}

export class PtyManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
  }

  createTerminal(options: { cwd?: string; shell?: string } = {}): TerminalInfo {
    const id = randomUUID()
    const shell = options.shell || this.getDefaultShell()
    const cwd = options.cwd || process.cwd()

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    const info: TerminalInfo = {
      id,
      pid: ptyProcess.pid,
      shell,
      cwd,
      title: shell.split('/').pop() || shell,
      createdAt: Date.now(),
    }

    const instance: TerminalInstance = { info, ptyProcess }
    this.terminals.set(id, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:exit', id, exitCode)
      }
      this.terminals.delete(id)
    })

    return info
  }

  write(id: string, data: string): void {
    const instance = this.terminals.get(id)
    if (instance) {
      instance.ptyProcess.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.terminals.get(id)
    if (instance) {
      instance.ptyProcess.resize(cols, rows)
    }
  }

  kill(id: string): void {
    const instance = this.terminals.get(id)
    if (instance) {
      instance.ptyProcess.kill()
      this.terminals.delete(id)
    }
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map((t) => t.info)
  }

  dispose(): void {
    for (const [id] of this.terminals) {
      this.kill(id)
    }
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }
}
