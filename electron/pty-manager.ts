import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import os from 'os'
import { execSync } from 'child_process'
import { DetectorManager } from './output-monitors/detector-manager'
import { ServerDetector } from './output-monitors/server-detector'

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

// WSL path detection for pty-manager
function isWslPath(inputPath: string): boolean {
  if (process.platform !== 'win32') return false
  // Check for UNC WSL paths or Linux-style paths
  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(inputPath) ||
    (inputPath.startsWith('/') && !inputPath.startsWith('//'))
}

function getDefaultWslDistro(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const output = execSync('wsl -l -q', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 0)
    return lines[0] || null
  } catch {
    return null
  }
}

function getLinuxPathFromWslPath(inputPath: string): string {
  // Extract Linux path from UNC path
  const uncMatch = inputPath.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(.*)$/i)
  if (uncMatch) {
    return uncMatch[1].replace(/\\/g, '/') || '/'
  }
  // Already a Linux-style path
  return inputPath
}

export class PtyManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow
  private detectorManager: DetectorManager

  constructor(window: BrowserWindow) {
    this.window = window

    // Initialize output monitoring
    this.detectorManager = new DetectorManager()
    this.detectorManager.registerDetector(new ServerDetector())

    // Forward detected events to renderer
    this.detectorManager.onEvent((event) => {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send('detector:event', event)
      }
    })
  }

  /**
   * Create terminal with custom command (used for SSH)
   */
  createTerminalWithCommand(shell: string, shellArgs: string[], displayCwd: string): TerminalInfo {
    const id = randomUUID()

    // Clean environment for SSH - remove SSH_ASKPASS and related vars
    const cleanEnv = { ...process.env }
    delete cleanEnv.SSH_ASKPASS
    delete cleanEnv.SSH_ASKPASS_REQUIRE
    delete cleanEnv.DISPLAY // Force SSH to use terminal prompts, not GUI

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: {
        ...cleanEnv,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    const info: TerminalInfo = {
      id,
      pid: ptyProcess.pid,
      shell: `${shell} ${shellArgs.slice(0, 3).join(' ')}...`, // Show abbreviated command
      cwd: displayCwd,
      title: 'SSH',
      createdAt: Date.now(),
    }

    const instance: TerminalInstance = { info, ptyProcess }
    this.terminals.set(id, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      // Process through detectors
      this.detectorManager.processOutput(id, data)

      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Notify detectors of exit
      this.detectorManager.handleTerminalExit(id, exitCode)

      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:exit', id, exitCode)
      }
      this.terminals.delete(id)
    })

    return info
  }

  createTerminal(options: { cwd?: string; shell?: string } = {}): TerminalInfo {
    const id = randomUUID()
    let shell = options.shell || this.getDefaultShell()
    const originalCwd = options.cwd || process.cwd()
    let effectiveCwd = originalCwd
    let shellArgs: string[] = []

    // Handle WSL paths on Windows
    if (process.platform === 'win32' && originalCwd && isWslPath(originalCwd)) {
      const linuxPath = getLinuxPathFromWslPath(originalCwd)
      const distro = getDefaultWslDistro()

      // If shell is not already WSL, switch to WSL
      if (!shell.includes('wsl')) {
        shell = 'wsl.exe'
        if (distro) {
          shellArgs = ['-d', distro, '--cd', linuxPath]
        } else {
          shellArgs = ['--cd', linuxPath]
        }
      }
      // For file operations, use Windows cwd (we'll cd in WSL)
      effectiveCwd = process.cwd()
    }

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: effectiveCwd,
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
      cwd: originalCwd, // Store original cwd for display
      title: shell.split('/').pop() || shell,
      createdAt: Date.now(),
    }

    const instance: TerminalInstance = { info, ptyProcess }
    this.terminals.set(id, instance)

    // Forward PTY data to renderer
    ptyProcess.onData((data) => {
      // Process through detectors
      this.detectorManager.processOutput(id, data)

      if (!this.window.isDestroyed()) {
        this.window.webContents.send('pty:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Notify detectors of exit
      this.detectorManager.handleTerminalExit(id, exitCode)

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
      this.detectorManager.cleanupTerminal(id)
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
