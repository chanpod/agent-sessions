/**
 * WSL path detection and conversion utilities
 *
 * This module provides functions to detect, convert, and manage Windows Subsystem for Linux (WSL) paths.
 * It handles UNC path format (\\wsl$\distro\path), Linux-style paths on Windows, and distro detection.
 */

import { execSync } from 'child_process'

// WSL path detection and conversion utilities
export interface WslPathInfo {
  isWslPath: boolean
  distro?: string
  linuxPath?: string
}

export interface WslCommandResult {
  cmd: string
  cwd: string | undefined
}

/**
 * Detect if a path is a WSL path and extract distro/Linux path info
 */
export function detectWslPath(inputPath: string): WslPathInfo {
  // Check for UNC WSL paths: \\wsl$\Ubuntu\... or \\wsl.localhost\Ubuntu\...
  const uncMatch = inputPath.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(.*)$/i)
  if (uncMatch) {
    return {
      isWslPath: true,
      distro: uncMatch[1],
      linuxPath: uncMatch[2].replace(/\\/g, '/') || '/',
    }
  }

  // Check for Linux-style paths that start with / (common when user types path manually)
  if (process.platform === 'win32' && inputPath.startsWith('/') && !inputPath.startsWith('//')) {
    return {
      isWslPath: true,
      linuxPath: inputPath,
    }
  }

  return { isWslPath: false }
}

/**
 * Convert a Linux path to a WSL UNC path for Windows filesystem access
 */
export function convertToWslUncPath(linuxPath: string, distro?: string): string {
  const dist = distro || getDefaultWslDistro()
  if (!dist) return linuxPath
  return `\\\\wsl$\\${dist}${linuxPath.replace(/\//g, '\\')}`
}

/**
 * Get the default WSL distribution (first in the list)
 */
export function getDefaultWslDistro(): string | null {
  const distros = getWslDistros()
  return distros[0] || null
}

/**
 * Get all available WSL distributions
 */
export function getWslDistros(): string[] {
  if (process.platform !== 'win32') return []
  try {
    const output = execSync('wsl -l -q', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    // Output has UTF-16 encoding issues on Windows, clean it up
    return output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 0)
  } catch {
    return []
  }
}

/**
 * Build a WSL command string from a regular command and WSL path info
 * This consolidates the repeated WSL command building logic from execInContext and execInContextAsync
 */
export function buildWslCommand(
  command: string,
  projectPath: string,
  wslInfo: WslPathInfo
): WslCommandResult {
  if (!wslInfo.isWslPath) {
    // Not a WSL path, return command as-is with projectPath as cwd
    return {
      cmd: command,
      cwd: projectPath,
    }
  }

  const linuxPath = wslInfo.linuxPath || projectPath
  const distroArg = wslInfo.distro ? `-d ${wslInfo.distro} ` : ''
  // Escape double quotes in the command for WSL bash -c
  const escapedCmd = command.replace(/"/g, '\\"')

  return {
    cmd: `wsl ${distroArg}bash -c "cd '${linuxPath}' && ${escapedCmd}"`,
    cwd: undefined, // WSL commands don't use Windows cwd
  }
}

/**
 * Check if the current platform supports WSL (Windows only)
 */
export function isWslEnvironment(): boolean {
  return process.platform === 'win32'
}
