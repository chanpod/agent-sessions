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
    // macOS paths should NOT be treated as WSL paths
    // These can appear when paths are passed from macOS systems or stored in cross-platform configs
    const macOSPrefixes = ['/Users/', '/Applications/', '/Library/', '/System/', '/Volumes/', '/private/']
    const isMacOSPath = macOSPrefixes.some(prefix => inputPath.startsWith(prefix))

    if (isMacOSPath) {
      return { isWslPath: false }
    }

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

/**
 * Check if WSL is available and functional on Windows.
 *
 * This performs an actual check to see if WSL is installed and working,
 * not just if we're on Windows.
 *
 * @returns true if WSL is available and functional, false otherwise
 */
export function isWslAvailable(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execSync('wsl --status', { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Normalize a path for use in git commands.
 *
 * Git always expects forward slashes, regardless of the platform.
 * This function converts backslashes to forward slashes and extracts
 * the Linux path from WSL UNC paths.
 *
 * Use this function when:
 * - Passing file paths to git commands (git diff, git show, git add, etc.)
 * - The path may come from Windows native, WSL, or SSH environments
 *
 * @param inputPath - The path to normalize (can be Windows, UNC, or Linux path)
 * @returns The normalized path with forward slashes suitable for git
 *
 * @example
 * normalizePathForGit('src\\utils\\file.ts') // => 'src/utils/file.ts'
 * normalizePathForGit('\\\\wsl$\\Ubuntu\\home\\user\\file.ts') // => '/home/user/file.ts'
 * normalizePathForGit('/home/user/file.ts') // => '/home/user/file.ts'
 */
export function normalizePathForGit(inputPath: string): string {
  const wslInfo = detectWslPath(inputPath)

  // If it's a WSL UNC path, return the Linux path (already normalized with forward slashes)
  if (wslInfo.isWslPath && wslInfo.linuxPath) {
    return wslInfo.linuxPath
  }

  // Otherwise, just replace all backslashes with forward slashes
  return inputPath.replace(/\\/g, '/')
}

/**
 * Resolve a path for Windows filesystem access.
 *
 * Converts WSL Linux paths to UNC paths that Windows can access.
 * On non-Windows platforms, returns the path unchanged.
 *
 * Use this function when:
 * - Using Node.js fs module to read/write files
 * - Accessing files on the Windows filesystem from Electron
 * - The path may be a WSL Linux path that needs conversion
 *
 * @param inputPath - The path to resolve (can be Linux path, UNC path, or Windows path)
 * @returns The resolved path suitable for Windows filesystem operations
 *
 * @example
 * resolvePathForFs('/home/user/file.ts') // => '\\\\wsl$\\Ubuntu\\home\\user\\file.ts'
 * resolvePathForFs('C:\\Users\\file.ts') // => 'C:\\Users\\file.ts' (unchanged)
 * resolvePathForFs('\\\\wsl$\\Ubuntu\\home\\file.ts') // => '\\\\wsl$\\Ubuntu\\home\\file.ts' (normalized)
 */
export function resolvePathForFs(inputPath: string): string {
  // On non-Windows platforms, return unchanged
  if (process.platform !== 'win32') {
    return inputPath
  }

  const wslInfo = detectWslPath(inputPath)

  // If it's not a WSL path, return unchanged (Windows native paths like C:\...)
  if (!wslInfo.isWslPath) {
    return inputPath
  }

  // If it's already a UNC path (has distro extracted), normalize it by reconstructing
  if (wslInfo.distro && wslInfo.linuxPath) {
    return convertToWslUncPath(wslInfo.linuxPath, wslInfo.distro)
  }

  // It's a WSL Linux path without distro (e.g., /home/user/...), convert to UNC
  if (wslInfo.linuxPath) {
    return convertToWslUncPath(wslInfo.linuxPath)
  }

  // Fallback: return unchanged
  return inputPath
}
