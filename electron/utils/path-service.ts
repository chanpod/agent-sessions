/**
 * Centralized Path Handling Service
 *
 * This module is the SINGLE source of truth for ALL path operations across
 * Windows, WSL, Mac, Linux, and SSH environments.
 *
 * Key features:
 * - Platform & environment detection with caching
 * - Path type detection and analysis
 * - Cross-platform path conversion
 * - Path manipulation (join, dirname, basename, etc.)
 * - Command escaping for different shells
 * - Validation utilities
 *
 * @module path-service
 */

import * as nodePath from 'path'
import * as posixPath from 'path/posix'
import { execSync } from 'child_process'

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Execution context for running commands.
 * Determines how a command should be executed based on the path and environment.
 */
export type ExecutionContext = 'local-windows' | 'local-unix' | 'wsl' | 'ssh-remote'

/**
 * Represents the current platform and environment configuration.
 * This is cached on startup for performance.
 */
export interface PathEnvironment {
  /** The Node.js platform identifier */
  platform: 'win32' | 'darwin' | 'linux'
  /** True if running on Windows */
  isWindows: boolean
  /** True if running on macOS */
  isMac: boolean
  /** True if running on Linux */
  isLinux: boolean
  /** True if WSL is available and functional (Windows only) */
  wslAvailable: boolean
  /** The default WSL distribution name, or null if unavailable */
  defaultWslDistro: string | null
  /** All available WSL distributions */
  wslDistros: string[]
}

/**
 * The type of path detected
 */
export type PathType = 'windows' | 'wsl-unc' | 'wsl-linux' | 'unix' | 'ssh-remote'

/**
 * Detailed information about a path after analysis
 */
export interface PathInfo {
  /** The detected type of path */
  type: PathType
  /** The original input path */
  original: string
  /** Normalized path with forward slashes */
  normalized: string
  /** Whether the path is absolute */
  isAbsolute: boolean
  /** WSL distribution name if applicable */
  wslDistro?: string
  /** Linux path component for WSL paths */
  linuxPath?: string
  /** SSH host if this is a remote path */
  sshHost?: string
  /** Remote path component for SSH paths */
  remotePath?: string
}

// ============================================================================
// Environment Detection (Cached)
// ============================================================================

/** Cached environment information */
let cachedEnvironment: PathEnvironment | null = null

/**
 * Get cached list of WSL distributions.
 * Only queries WSL once and caches the result.
 */
function getWslDistrosInternal(): string[] {
  if (process.platform !== 'win32') return []
  try {
    const output = execSync('wsl -l -q', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    // Output has UTF-16 encoding issues on Windows, clean it up
    return output
      .replace(/\0/g, '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
  } catch {
    return []
  }
}

/**
 * Check if WSL is available and functional.
 */
function checkWslAvailable(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execSync('wsl --status', { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Get the current platform and environment configuration.
 * Results are cached after the first call for performance.
 *
 * @returns The current path environment
 *
 * @example
 * const env = getEnvironment()
 * if (env.isWindows && env.wslAvailable) {
 *   console.log(`Default WSL distro: ${env.defaultWslDistro}`)
 * }
 */
export function getEnvironment(): PathEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment
  }

  const platform = process.platform as 'win32' | 'darwin' | 'linux'
  const wslDistros = getWslDistrosInternal()

  cachedEnvironment = {
    platform,
    isWindows: platform === 'win32',
    isMac: platform === 'darwin',
    isLinux: platform === 'linux',
    wslAvailable: platform === 'win32' && checkWslAvailable(),
    defaultWslDistro: wslDistros[0] || null,
    wslDistros,
  }

  return cachedEnvironment
}

/**
 * Clear the cached environment.
 * Useful for testing or when WSL configuration changes.
 */
export function clearEnvironmentCache(): void {
  cachedEnvironment = null
}

// ============================================================================
// Path Type Detection
// ============================================================================

/** macOS-specific path prefixes that should NOT be treated as WSL paths */
const MACOS_PATH_PREFIXES = [
  '/Users/',
  '/Applications/',
  '/Library/',
  '/System/',
  '/Volumes/',
  '/private/',
  '/opt/',
  '/usr/local/',
]

/** Regex to match WSL UNC paths: \\wsl$\Distro\... or \\wsl.localhost\Distro\... */
const WSL_UNC_REGEX = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(.*)$/i

/** Regex to match Windows drive paths: C:\... or C:/... */
const WINDOWS_DRIVE_REGEX = /^[a-zA-Z]:[/\\]/

/** Regex to match SSH remote paths: user@host:/path or host:/path */
const SSH_REMOTE_REGEX = /^(?:([^@]+)@)?([^:]+):(.*)$/

/**
 * Analyze a path and determine its type and components.
 *
 * @param inputPath - The path to analyze
 * @returns Detailed information about the path
 *
 * @example
 * // Windows path
 * analyzePath('C:\\Users\\foo\\project')
 * // => { type: 'windows', normalized: 'C:/Users/foo/project', isAbsolute: true, ... }
 *
 * @example
 * // WSL UNC path
 * analyzePath('\\\\wsl$\\Ubuntu\\home\\user\\project')
 * // => { type: 'wsl-unc', wslDistro: 'Ubuntu', linuxPath: '/home/user/project', ... }
 *
 * @example
 * // macOS path (NOT treated as WSL)
 * analyzePath('/Users/foo/project')
 * // => { type: 'unix', isAbsolute: true, ... }
 *
 * @example
 * // SSH remote path
 * analyzePath('user@server:/home/user/project')
 * // => { type: 'ssh-remote', sshHost: 'server', remotePath: '/home/user/project', ... }
 */
export function analyzePath(inputPath: string): PathInfo {
  if (!inputPath) {
    return {
      type: 'unix',
      original: '',
      normalized: '',
      isAbsolute: false,
    }
  }

  const original = inputPath

  // Check for WSL UNC paths first
  const uncMatch = inputPath.match(WSL_UNC_REGEX)
  if (uncMatch) {
    const linuxPath = uncMatch[2].replace(/\\/g, '/') || '/'
    return {
      type: 'wsl-unc',
      original,
      normalized: linuxPath,
      isAbsolute: true,
      wslDistro: uncMatch[1],
      linuxPath,
    }
  }

  // Check for SSH remote paths
  const sshMatch = inputPath.match(SSH_REMOTE_REGEX)
  if (sshMatch && !WINDOWS_DRIVE_REGEX.test(inputPath)) {
    // Make sure it's not a Windows path like C:\path
    const remotePath = sshMatch[3] || '/'
    return {
      type: 'ssh-remote',
      original,
      normalized: remotePath.replace(/\\/g, '/'),
      isAbsolute: remotePath.startsWith('/'),
      sshHost: sshMatch[2],
      remotePath,
    }
  }

  // Check for Windows drive paths
  if (WINDOWS_DRIVE_REGEX.test(inputPath)) {
    return {
      type: 'windows',
      original,
      normalized: inputPath.replace(/\\/g, '/'),
      isAbsolute: true,
    }
  }

  // Check for Linux-style absolute paths
  if (inputPath.startsWith('/') && !inputPath.startsWith('//')) {
    // Check for mangled WSL UNC paths (forward slashes instead of backslashes)
    // e.g., /wsl.localhost/Ubuntu/home/... or /wsl$/Ubuntu/home/...
    const mangledWslMatch = inputPath.match(/^\/wsl(?:\.localhost|\$)\/([^/]+)(.*)$/i)
    if (mangledWslMatch) {
      const distro = mangledWslMatch[1]
      const linuxPath = mangledWslMatch[2] || '/'
      return {
        type: 'wsl-unc',
        original,
        normalized: `\\\\wsl$\\${distro}${linuxPath.replace(/\//g, '\\')}`,
        isAbsolute: true,
        wslDistro: distro,
        linuxPath,
      }
    }

    // On Windows, check if this might be a WSL Linux path
    const env = getEnvironment()
    if (env.isWindows) {
      // Check for macOS path prefixes - these should NOT be treated as WSL
      const isMacOSPath = MACOS_PATH_PREFIXES.some(prefix => inputPath.startsWith(prefix))
      if (!isMacOSPath && env.wslAvailable) {
        return {
          type: 'wsl-linux',
          original,
          normalized: inputPath,
          isAbsolute: true,
          linuxPath: inputPath,
        }
      }
    }

    // Regular Unix path (Linux or macOS)
    return {
      type: 'unix',
      original,
      normalized: inputPath,
      isAbsolute: true,
    }
  }

  // Handle home directory paths
  if (inputPath.startsWith('~/')) {
    return {
      type: 'unix',
      original,
      normalized: inputPath,
      isAbsolute: false, // ~ is expanded at runtime
    }
  }

  // Relative path
  return {
    type: 'unix',
    original,
    normalized: inputPath.replace(/\\/g, '/'),
    isAbsolute: false,
  }
}

// ============================================================================
// Path Conversion Functions
// ============================================================================

/**
 * Convert a path to Git-compatible format (always forward slashes).
 * Extracts Linux paths from WSL UNC paths.
 *
 * @param inputPath - The path to convert
 * @returns The path formatted for git commands
 *
 * @example
 * toGitPath('src\\utils\\file.ts')
 * // => 'src/utils/file.ts'
 *
 * @example
 * toGitPath('\\\\wsl$\\Ubuntu\\home\\user\\file.ts')
 * // => '/home/user/file.ts'
 *
 * @example
 * toGitPath('C:\\Users\\foo\\project\\src\\file.ts')
 * // => 'C:/Users/foo/project/src/file.ts'
 */
export function toGitPath(inputPath: string): string {
  const info = analyzePath(inputPath)

  // For WSL UNC paths, return the Linux path
  if (info.type === 'wsl-unc' && info.linuxPath) {
    return info.linuxPath
  }

  // For SSH paths, return the remote path normalized
  if (info.type === 'ssh-remote' && info.remotePath) {
    return info.remotePath.replace(/\\/g, '/')
  }

  // For all other paths, normalize slashes
  return info.normalized
}

/**
 * Convert a path for Node.js filesystem operations.
 * On Windows, converts WSL Linux paths to UNC paths.
 *
 * @param inputPath - The path to convert
 * @returns The path formatted for Node.js fs module
 *
 * @example
 * // On Windows with WSL
 * toFsPath('/home/user/file.ts')
 * // => '\\\\wsl$\\Ubuntu\\home\\user\\file.ts'
 *
 * @example
 * // Windows native path (unchanged)
 * toFsPath('C:\\Users\\file.ts')
 * // => 'C:\\Users\\file.ts'
 *
 * @example
 * // On Linux/macOS (unchanged)
 * toFsPath('/home/user/file.ts')
 * // => '/home/user/file.ts'
 */
export function toFsPath(inputPath: string): string {
  const env = getEnvironment()
  const info = analyzePath(inputPath)

  // On non-Windows platforms, return the normalized path
  if (!env.isWindows) {
    return info.normalized
  }

  // For WSL UNC paths, reconstruct properly
  if (info.type === 'wsl-unc' && info.wslDistro && info.linuxPath) {
    return toWslUncPath(info.linuxPath, info.wslDistro)
  }

  // For WSL Linux paths, convert to UNC
  if (info.type === 'wsl-linux' && info.linuxPath) {
    const distro = env.defaultWslDistro
    if (!distro) {
      // Can't convert Linux path to UNC without a WSL distro
      // This shouldn't normally happen if WSL is properly configured
      console.error(`[PathService] Cannot convert WSL Linux path to UNC: no WSL distro available. Path: ${inputPath}`)
      throw new Error(`Cannot access WSL path "${inputPath}": no WSL distribution found. Please ensure WSL is installed and configured.`)
    }
    return toWslUncPath(info.linuxPath, distro)
  }

  // For Windows paths, use native format
  if (info.type === 'windows') {
    return inputPath.replace(/\//g, '\\')
  }

  // Fallback
  return inputPath
}

/**
 * Convert a path to WSL UNC format (\\wsl$\Distro\path).
 *
 * @param inputPath - The path to convert (usually a Linux path)
 * @param distro - The WSL distribution name (defaults to system default)
 * @returns The WSL UNC path
 *
 * @example
 * toWslUncPath('/home/user/project')
 * // => '\\\\wsl$\\Ubuntu\\home\\user\\project'
 *
 * @example
 * toWslUncPath('/home/user/project', 'Debian')
 * // => '\\\\wsl$\\Debian\\home\\user\\project'
 */
export function toWslUncPath(inputPath: string, distro?: string): string {
  const env = getEnvironment()
  const dist = distro || env.defaultWslDistro

  if (!dist) {
    return inputPath
  }

  const info = analyzePath(inputPath)

  // If already a UNC path, just update the distro if different
  if (info.type === 'wsl-unc' && info.linuxPath) {
    return `\\\\wsl$\\${dist}${info.linuxPath.replace(/\//g, '\\')}`
  }

  // Convert Linux path to UNC
  if (info.linuxPath) {
    return `\\\\wsl$\\${dist}${info.linuxPath.replace(/\//g, '\\')}`
  }

  // Assume it's a Linux path
  const linuxPath = inputPath.startsWith('/') ? inputPath : `/${inputPath}`
  return `\\\\wsl$\\${dist}${linuxPath.replace(/\//g, '\\')}`
}

/**
 * Extract the Linux path from a WSL UNC path.
 *
 * @param inputPath - The WSL UNC path
 * @returns The Linux path component
 *
 * @example
 * toWslLinuxPath('\\\\wsl$\\Ubuntu\\home\\user\\project')
 * // => '/home/user/project'
 *
 * @example
 * toWslLinuxPath('/home/user/project')
 * // => '/home/user/project' (unchanged)
 */
export function toWslLinuxPath(inputPath: string): string {
  const info = analyzePath(inputPath)

  if (info.linuxPath) {
    return info.linuxPath
  }

  // If it's already a Linux-style path, return as-is
  if (inputPath.startsWith('/')) {
    return inputPath
  }

  // Not a WSL path
  return inputPath
}

/**
 * Convert a path to a user-friendly display format.
 * Uses forward slashes and simplifies where possible.
 *
 * @param inputPath - The path to format
 * @returns A user-friendly display string
 *
 * @example
 * toDisplayPath('\\\\wsl$\\Ubuntu\\home\\user\\project')
 * // => 'WSL:Ubuntu:/home/user/project'
 *
 * @example
 * toDisplayPath('C:\\Users\\foo\\project')
 * // => 'C:/Users/foo/project'
 *
 * @example
 * toDisplayPath('user@server:/home/user')
 * // => 'SSH:server:/home/user'
 */
export function toDisplayPath(inputPath: string): string {
  const info = analyzePath(inputPath)

  if (info.type === 'wsl-unc' && info.wslDistro && info.linuxPath) {
    return `WSL:${info.wslDistro}:${info.linuxPath}`
  }

  if (info.type === 'ssh-remote' && info.sshHost && info.remotePath) {
    return `SSH:${info.sshHost}:${info.remotePath}`
  }

  return info.normalized
}

/**
 * Convert a path for SSH remote operations.
 *
 * @param inputPath - The local path
 * @param remotePath - Optional remote path mapping
 * @returns The path formatted for SSH commands
 *
 * @example
 * toSshPath('/home/user/project', '/remote/project')
 * // => '/remote/project'
 *
 * @example
 * toSshPath('src/file.ts')
 * // => 'src/file.ts'
 */
export function toSshPath(inputPath: string, remotePath?: string): string {
  if (remotePath) {
    return remotePath.replace(/\\/g, '/')
  }

  const info = analyzePath(inputPath)

  // For SSH remote paths, return the remote path component
  if (info.type === 'ssh-remote' && info.remotePath) {
    return info.remotePath
  }

  return info.normalized
}

// ============================================================================
// Path Manipulation (Platform-Aware)
// ============================================================================

/**
 * Join path segments using platform-appropriate separators.
 *
 * @param segments - Path segments to join
 * @returns The joined path
 *
 * @example
 * // On Windows
 * join('C:\\Users', 'foo', 'project')
 * // => 'C:\\Users\\foo\\project'
 *
 * @example
 * // On Linux/macOS
 * join('/home', 'user', 'project')
 * // => '/home/user/project'
 */
export function join(...segments: string[]): string {
  return nodePath.join(...segments)
}

/**
 * Join path segments using POSIX separators (forward slashes).
 * Useful for git commands, URLs, and cross-platform consistency.
 *
 * @param segments - Path segments to join
 * @returns The joined path with forward slashes
 *
 * @example
 * joinPosix('src', 'components', 'App.tsx')
 * // => 'src/components/App.tsx'
 *
 * @example
 * joinPosix('/home/user', 'project', 'src')
 * // => '/home/user/project/src'
 */
export function joinPosix(...segments: string[]): string {
  // Normalize all segments to forward slashes first
  const normalized = segments.map(s => s.replace(/\\/g, '/'))
  return posixPath.join(...normalized)
}

/**
 * Get the directory name from a path.
 *
 * @param inputPath - The path to process
 * @returns The directory portion of the path
 *
 * @example
 * dirname('/home/user/project/file.ts')
 * // => '/home/user/project'
 *
 * @example
 * dirname('C:\\Users\\foo\\file.ts')
 * // => 'C:\\Users\\foo'
 */
export function dirname(inputPath: string): string {
  const info = analyzePath(inputPath)

  // For WSL UNC paths, work with the Linux path then convert back
  if (info.type === 'wsl-unc' && info.linuxPath && info.wslDistro) {
    const linuxDir = posixPath.dirname(info.linuxPath)
    return toWslUncPath(linuxDir, info.wslDistro)
  }

  // For WSL Linux paths, use posix
  if (info.type === 'wsl-linux' && info.linuxPath) {
    return posixPath.dirname(info.linuxPath)
  }

  // For Unix paths, use posix
  if (info.type === 'unix') {
    return posixPath.dirname(info.normalized)
  }

  // For Windows paths, use native
  return nodePath.dirname(inputPath)
}

/**
 * Get the file name from a path.
 *
 * @param inputPath - The path to process
 * @returns The file name
 *
 * @example
 * basename('/home/user/project/file.ts')
 * // => 'file.ts'
 *
 * @example
 * basename('C:\\Users\\foo\\document.pdf')
 * // => 'document.pdf'
 */
export function basename(inputPath: string): string {
  const info = analyzePath(inputPath)

  // Use posix for normalized paths (works for all types)
  return posixPath.basename(info.normalized)
}

/**
 * Get the file extension from a path.
 *
 * @param inputPath - The path to process
 * @returns The file extension including the dot
 *
 * @example
 * extname('/home/user/file.ts')
 * // => '.ts'
 *
 * @example
 * extname('document.pdf')
 * // => '.pdf'
 */
export function extname(inputPath: string): string {
  const info = analyzePath(inputPath)
  return posixPath.extname(info.normalized)
}

/**
 * Get the relative path from one path to another.
 *
 * @param from - The starting path
 * @param to - The target path
 * @returns The relative path
 *
 * @example
 * relative('/home/user/project', '/home/user/project/src/file.ts')
 * // => 'src/file.ts'
 */
export function relative(from: string, to: string): string {
  const fromInfo = analyzePath(from)
  const toInfo = analyzePath(to)

  // Use posix for normalized paths
  return posixPath.relative(fromInfo.normalized, toInfo.normalized)
}

/**
 * Resolve path segments to an absolute path.
 *
 * @param segments - Path segments to resolve
 * @returns The resolved absolute path
 *
 * @example
 * resolve('/home/user', 'project', 'src')
 * // => '/home/user/project/src'
 */
export function resolve(...segments: string[]): string {
  return nodePath.resolve(...segments)
}

/**
 * Normalize a path by cleaning up separators and resolving . and ..
 *
 * @param inputPath - The path to normalize
 * @returns The normalized path
 *
 * @example
 * normalize('src//components/../utils/file.ts')
 * // => 'src/utils/file.ts'
 *
 * @example
 * normalize('C:\\Users\\foo\\..\\bar')
 * // => 'C:\\bar'
 */
export function normalize(inputPath: string): string {
  const info = analyzePath(inputPath)

  // For WSL UNC paths, normalize the Linux portion
  if (info.type === 'wsl-unc' && info.linuxPath && info.wslDistro) {
    const normalizedLinux = posixPath.normalize(info.linuxPath)
    return toWslUncPath(normalizedLinux, info.wslDistro)
  }

  // For Unix-style paths, use posix normalization
  if (info.type === 'unix' || info.type === 'wsl-linux') {
    return posixPath.normalize(info.normalized)
  }

  // For Windows paths, use native normalization
  return nodePath.normalize(inputPath)
}

// ============================================================================
// Command Escaping
// ============================================================================

/**
 * Escape a path for use in bash commands.
 * Wraps in single quotes and escapes internal single quotes.
 *
 * @param inputPath - The path to escape
 * @returns The escaped path safe for bash -c "..."
 *
 * @example
 * escapeForBash("/home/user/my project")
 * // => "'/home/user/my project'"
 *
 * @example
 * escapeForBash("/home/user/it's a file")
 * // => "'/home/user/it'\\''s a file'"
 */
export function escapeForBash(inputPath: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  const escaped = inputPath.replace(/'/g, "'\\''")
  return `'${escaped}'`
}

/**
 * Escape a path for use in Windows cmd.exe.
 * Wraps in double quotes and escapes special characters.
 *
 * @param inputPath - The path to escape
 * @returns The escaped path safe for cmd.exe
 *
 * @example
 * escapeForCmd('C:\\Users\\my folder\\file.txt')
 * // => '"C:\\Users\\my folder\\file.txt"'
 */
export function escapeForCmd(inputPath: string): string {
  // Escape special cmd characters: & | < > ^ "
  // Then wrap in double quotes
  const escaped = inputPath
    .replace(/([&|<>^])/g, '^$1')
    .replace(/"/g, '""')
  return `"${escaped}"`
}

/**
 * Escape a path for use in PowerShell.
 * Wraps in single quotes and escapes internal single quotes.
 *
 * @param inputPath - The path to escape
 * @returns The escaped path safe for PowerShell
 *
 * @example
 * escapeForPowerShell("C:\\Users\\my project")
 * // => "'C:\\Users\\my project'"
 *
 * @example
 * escapeForPowerShell("C:\\Users\\it's a file")
 * // => "'C:\\Users\\it''s a file'"
 */
export function escapeForPowerShell(inputPath: string): string {
  // In PowerShell, single quotes escape by doubling them
  const escaped = inputPath.replace(/'/g, "''")
  return `'${escaped}'`
}

// ============================================================================
// Validation & Utilities
// ============================================================================

/**
 * Check if a path is a WSL path (UNC or Linux-style on Windows).
 *
 * @param inputPath - The path to check
 * @returns True if the path is a WSL path
 *
 * @example
 * isWslPath('\\\\wsl$\\Ubuntu\\home\\user')
 * // => true
 *
 * @example
 * isWslPath('/home/user')
 * // => true (on Windows with WSL)
 *
 * @example
 * isWslPath('/Users/foo')
 * // => false (macOS path, not WSL)
 */
export function isWslPath(inputPath: string): boolean {
  const info = analyzePath(inputPath)
  return info.type === 'wsl-unc' || info.type === 'wsl-linux'
}

/**
 * Check if a path is a Windows-style path (drive letter).
 *
 * @param inputPath - The path to check
 * @returns True if the path is a Windows path
 *
 * @example
 * isWindowsPath('C:\\Users\\foo')
 * // => true
 *
 * @example
 * isWindowsPath('/home/user')
 * // => false
 */
export function isWindowsPath(inputPath: string): boolean {
  const info = analyzePath(inputPath)
  return info.type === 'windows'
}

/**
 * Check if a path is absolute.
 *
 * @param inputPath - The path to check
 * @returns True if the path is absolute
 *
 * @example
 * isAbsolutePath('/home/user')
 * // => true
 *
 * @example
 * isAbsolutePath('C:\\Users\\foo')
 * // => true
 *
 * @example
 * isAbsolutePath('src/file.ts')
 * // => false
 */
export function isAbsolutePath(inputPath: string): boolean {
  const info = analyzePath(inputPath)
  return info.isAbsolute
}

/**
 * Check if two paths refer to the same location.
 * Normalizes both paths before comparison.
 *
 * @param path1 - First path
 * @param path2 - Second path
 * @returns True if both paths refer to the same location
 *
 * @example
 * isSamePath('/home/user/project', '/home/user/project/')
 * // => true
 *
 * @example
 * isSamePath('C:\\Users\\foo', 'C:/Users/foo')
 * // => true
 */
export function isSamePath(path1: string, path2: string): boolean {
  const info1 = analyzePath(path1)
  const info2 = analyzePath(path2)

  // Normalize both paths
  const norm1 = info1.normalized.replace(/\/+$/, '').toLowerCase()
  const norm2 = info2.normalized.replace(/\/+$/, '').toLowerCase()

  return norm1 === norm2
}

/**
 * Check if one path is a subpath of another.
 *
 * @param parent - The potential parent path
 * @param child - The potential child path
 * @returns True if child is under parent
 *
 * @example
 * isSubPath('/home/user', '/home/user/project/file.ts')
 * // => true
 *
 * @example
 * isSubPath('/home/user', '/home/other')
 * // => false
 */
export function isSubPath(parent: string, child: string): boolean {
  const parentInfo = analyzePath(parent)
  const childInfo = analyzePath(child)

  // Normalize and ensure trailing slash for parent
  const parentNorm = parentInfo.normalized.replace(/\/+$/, '').toLowerCase() + '/'
  const childNorm = childInfo.normalized.replace(/\/+$/, '').toLowerCase()

  return childNorm.startsWith(parentNorm) || childNorm === parentNorm.slice(0, -1)
}

// ============================================================================
// Execution Context Detection
// ============================================================================

/**
 * macOS-specific path prefixes that indicate a macOS remote system.
 * On Windows, these paths cannot be local and must be SSH remote paths.
 */
const MACOS_REMOTE_PREFIXES = [
  '/Users/',
  '/Applications/',
  '/Library/',
  '/System/',
  '/Volumes/',
  '/private/',
]

/**
 * Check if a path is an "impossible local path" - a path that has Unix format
 * but cannot exist on the local system based on platform-specific indicators.
 *
 * @param inputPath - The path to check
 * @returns True if this path cannot be a local path
 *
 * @example
 * // On Windows:
 * isImpossibleLocalPath('/Users/john/project')
 * // => true (macOS path on Windows)
 *
 * @example
 * // On macOS:
 * isImpossibleLocalPath('C:\\Users\\john\\project')
 * // => true (Windows path on macOS)
 */
export function isImpossibleLocalPath(inputPath: string): boolean {
  const env = getEnvironment()

  if (env.isWindows) {
    // On Windows, macOS-style paths are impossible locally
    if (MACOS_REMOTE_PREFIXES.some(prefix => inputPath.startsWith(prefix))) {
      return true
    }

    // On Windows without WSL, /home/... paths are also impossible
    if (!env.wslAvailable && inputPath.startsWith('/home/')) {
      return true
    }
  }

  if (env.isMac || env.isLinux) {
    // On Unix, Windows drive paths are impossible locally
    if (WINDOWS_DRIVE_REGEX.test(inputPath)) {
      return true
    }
  }

  return false
}

/**
 * Check if a path requires SSH execution (is a remote path or has macOS-specific patterns on Windows).
 *
 * @param inputPath - The path to check
 * @returns True if the path should be executed via SSH
 *
 * @example
 * // On Windows:
 * isSSHPath('/Users/john/project')
 * // => true (macOS path must be remote)
 *
 * @example
 * isSSHPath('user@host:/path')
 * // => true (explicit SSH path format)
 */
export function isSSHPath(inputPath: string): boolean {
  const info = analyzePath(inputPath)

  // Explicit SSH remote format
  if (info.type === 'ssh-remote') {
    return true
  }

  // Check for impossible local paths (indicates SSH remote)
  if (isImpossibleLocalPath(inputPath)) {
    return true
  }

  return false
}

/**
 * Check if a path is local (can be executed directly on this machine or via WSL).
 *
 * @param inputPath - The path to check
 * @returns True if the path can be accessed locally (including WSL)
 *
 * @example
 * isLocalPath('C:\\Users\\john\\project')
 * // => true (local Windows path)
 *
 * @example
 * isLocalPath('/home/user/project')
 * // => true on Linux/macOS, or true on Windows with WSL
 */
export function isLocalPath(inputPath: string): boolean {
  return !isSSHPath(inputPath)
}

/**
 * Get the SSH host from a path, if applicable.
 *
 * @param inputPath - The path to extract host from
 * @returns The SSH host, or null if not an SSH path format
 *
 * @example
 * getSSHHost('user@myserver:/home/user')
 * // => 'myserver'
 *
 * @example
 * getSSHHost('/Users/john/project')
 * // => null (implied SSH on Windows, but no explicit host)
 */
export function getSSHHost(inputPath: string): string | null {
  const info = analyzePath(inputPath)
  return info.sshHost || null
}

/**
 * Get the SSH user from a path, if applicable.
 *
 * @param inputPath - The path to extract user from
 * @returns The SSH user, or null if not specified
 *
 * @example
 * getSSHUser('john@myserver:/home/user')
 * // => 'john'
 */
export function getSSHUser(inputPath: string): string | null {
  const info = analyzePath(inputPath)

  // Check for explicit user@host:path format
  const match = inputPath.match(/^([^@]+)@([^:]+):/)
  if (match) {
    return match[1]
  }

  return null
}

/**
 * Escape a path for use in SSH remote bash commands.
 * This handles the double-escaping needed when passing paths through SSH.
 *
 * @param inputPath - The path to escape
 * @returns The escaped path safe for SSH remote bash execution
 *
 * @example
 * escapeForSSHRemote("/home/user/my project")
 * // => "'/home/user/my project'"
 *
 * @example
 * escapeForSSHRemote("/home/user/it's a file")
 * // => "'/home/user/it'\\''s a file'"
 */
export function escapeForSSHRemote(inputPath: string): string {
  // SSH remote paths need the same escaping as bash
  // but may need additional consideration for SSH protocol
  return escapeForBash(inputPath)
}

/**
 * Interface for SSH manager to check connection status
 */
interface SSHManagerLike {
  getProjectMasterStatus(projectId: string): Promise<{ connected: boolean; error?: string }>
}

/**
 * Determine the execution context for a given path.
 * This is the primary method for deciding how to execute commands.
 *
 * @param inputPath - The path where the command should be executed
 * @param projectId - Optional project ID to check for SSH project association
 * @param sshManager - Optional SSH manager to verify SSH connection status
 * @returns The execution context
 *
 * @example
 * // Local Windows path
 * await getExecutionContext('C:\\Users\\john\\project')
 * // => 'local-windows'
 *
 * @example
 * // WSL path on Windows
 * await getExecutionContext('/home/user/project')
 * // => 'wsl' (if WSL available)
 *
 * @example
 * // SSH project path
 * await getExecutionContext('/Users/john/project', 'proj-123', sshManager)
 * // => 'ssh-remote' (macOS path on Windows = SSH)
 */
export async function getExecutionContext(
  inputPath: string,
  projectId?: string,
  sshManager?: SSHManagerLike
): Promise<ExecutionContext> {
  const env = getEnvironment()
  const info = analyzePath(inputPath)

  // First, check if this is an SSH project with an active connection
  if (projectId && sshManager) {
    try {
      const status = await sshManager.getProjectMasterStatus(projectId)
      if (status.connected) {
        return 'ssh-remote'
      }
    } catch {
      // Ignore errors, continue with path-based detection
    }
  }

  // Check for explicit SSH path format (user@host:path)
  if (info.type === 'ssh-remote') {
    return 'ssh-remote'
  }

  // Check for impossible local paths (e.g., macOS paths on Windows)
  if (isImpossibleLocalPath(inputPath)) {
    return 'ssh-remote'
  }

  // Local path detection
  if (env.isWindows) {
    // WSL paths
    if (info.type === 'wsl-unc' || info.type === 'wsl-linux') {
      return 'wsl'
    }

    // Windows native paths
    if (info.type === 'windows') {
      return 'local-windows'
    }

    // Unix paths on Windows with WSL available
    if (info.type === 'unix' && info.isAbsolute && env.wslAvailable) {
      // Check if it's a path that could be WSL (like /home/...)
      if (inputPath.startsWith('/home/') || inputPath.startsWith('/tmp/') || inputPath.startsWith('/var/')) {
        return 'wsl'
      }
    }

    // Default to local-windows for relative paths on Windows
    return 'local-windows'
  }

  // On macOS/Linux, everything that's not explicitly SSH is local-unix
  return 'local-unix'
}

/**
 * Synchronous version of getExecutionContext for cases where async is not possible.
 * NOTE: This cannot verify SSH connection status, so it may return 'ssh-remote'
 * for paths that look like SSH paths but don't have an active connection.
 *
 * @param inputPath - The path where the command should be executed
 * @returns The execution context (without SSH connection verification)
 */
export function getExecutionContextSync(inputPath: string): ExecutionContext {
  const env = getEnvironment()
  const info = analyzePath(inputPath)

  // Check for explicit SSH path format (user@host:path)
  if (info.type === 'ssh-remote') {
    return 'ssh-remote'
  }

  // Check for impossible local paths (e.g., macOS paths on Windows)
  if (isImpossibleLocalPath(inputPath)) {
    return 'ssh-remote'
  }

  // Local path detection
  if (env.isWindows) {
    // WSL paths
    if (info.type === 'wsl-unc' || info.type === 'wsl-linux') {
      return 'wsl'
    }

    // Windows native paths
    if (info.type === 'windows') {
      return 'local-windows'
    }

    // Unix paths on Windows with WSL available
    if (info.type === 'unix' && info.isAbsolute && env.wslAvailable) {
      if (inputPath.startsWith('/home/') || inputPath.startsWith('/tmp/') || inputPath.startsWith('/var/')) {
        return 'wsl'
      }
    }

    return 'local-windows'
  }

  return 'local-unix'
}

// ============================================================================
// Namespace Export
// ============================================================================

/**
 * PathService namespace containing all path utility functions.
 * Can be used for convenience when you want to access all functions through a single object.
 *
 * @example
 * import { PathService } from './path-service'
 *
 * const env = PathService.getEnvironment()
 * const gitPath = PathService.toGitPath(myPath)
 */
export const PathService = {
  // Environment
  getEnvironment,
  clearEnvironmentCache,

  // Path Analysis
  analyzePath,

  // Path Conversion
  toGitPath,
  toFsPath,
  toWslUncPath,
  toWslLinuxPath,
  toDisplayPath,
  toSshPath,

  // Path Manipulation
  join,
  joinPosix,
  dirname,
  basename,
  extname,
  relative,
  resolve,
  normalize,

  // Command Escaping
  escapeForBash,
  escapeForCmd,
  escapeForPowerShell,
  escapeForSSHRemote,

  // Validation
  isWslPath,
  isWindowsPath,
  isAbsolutePath,
  isSamePath,
  isSubPath,

  // Execution Context
  isImpossibleLocalPath,
  isSSHPath,
  isLocalPath,
  getSSHHost,
  getSSHUser,
  getExecutionContext,
  getExecutionContextSync,
}
