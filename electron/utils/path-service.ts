/**
 * Centralized Path Handling Service
 *
 * This module is the SINGLE source of truth for ALL path operations across
 * Windows, Mac, Linux, and SSH environments.
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
import * as fs from 'fs'

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Execution context for running commands.
 * Determines how a command should be executed based on the path and environment.
 */
export type ExecutionContext = 'local-windows' | 'local-unix' | 'ssh-remote'

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
}

/**
 * The type of path detected
 */
export type PathType = 'windows' | 'unix' | 'ssh-remote'

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
 * Get the current platform and environment configuration.
 * Results are cached after the first call for performance.
 */
export function getEnvironment(): PathEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment
  }

  const platform = process.platform as 'win32' | 'darwin' | 'linux'

  cachedEnvironment = {
    platform,
    isWindows: platform === 'win32',
    isMac: platform === 'darwin',
    isLinux: platform === 'linux',
  }

  return cachedEnvironment
}

/**
 * Clear the cached environment.
 * Useful for testing.
 */
export function clearEnvironmentCache(): void {
  cachedEnvironment = null
}

// ============================================================================
// Windows Helpers
// ============================================================================

/** Get the Program Files directory from environment or default */
export function getProgramFilesPath(): string {
  return process.env['PROGRAMFILES'] || 'C:\\Program Files'
}

/** Get the Program Files (x86) directory from environment or default */
export function getProgramFilesX86Path(): string {
  return process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
}

// ============================================================================
// Git Bash Detection (Cached)
// ============================================================================

/** Cached Git Bash path (null = not found, undefined = not yet checked) */
let cachedGitBashPath: string | null | undefined = undefined

/**
 * Find the Git Bash executable on Windows.
 * Results are cached after the first call.
 *
 * @returns The path to bash.exe, or null if not found / not on Windows
 */
export function getGitBashPath(): string | null {
  if (cachedGitBashPath !== undefined) {
    return cachedGitBashPath
  }

  if (process.platform !== 'win32') {
    cachedGitBashPath = null
    return null
  }

  console.log('[path-service] Searching for Git Bash...')

  const programFiles = getProgramFilesPath()
  const programFilesX86 = getProgramFilesX86Path()

  const possiblePaths = [
    nodePath.join(programFiles, 'Git', 'bin', 'bash.exe'),
    nodePath.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    nodePath.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    nodePath.join(programFilesX86, 'Git', 'usr', 'bin', 'bash.exe'),
  ]

  for (const bashPath of possiblePaths) {
    try {
      if (fs.existsSync(bashPath)) {
        console.log(`[path-service]   Found Git Bash at: ${bashPath}`)
        cachedGitBashPath = bashPath
        return bashPath
      }
    } catch {
      // Ignore errors, continue checking
    }
  }

  console.log('[path-service]   Git Bash not found')
  cachedGitBashPath = null
  return null
}

/**
 * Clear the cached Git Bash path.
 * Useful for testing.
 */
export function clearGitBashCache(): void {
  cachedGitBashPath = undefined
}

// ============================================================================
// Platform Detection
// ============================================================================

/** Platform identifier for installation context */
export type InstallPlatform = 'windows' | 'macos' | 'linux'

/**
 * Detect the current platform for CLI installation purposes.
 */
export function getPlatformForInstall(): InstallPlatform {
  if (process.platform === 'darwin') {
    return 'macos'
  }

  if (process.platform === 'win32') {
    return 'windows'
  }

  return 'linux'
}

// ============================================================================
// Path Type Detection
// ============================================================================

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
 * analyzePath('C:\\Users\\foo\\project')
 * // => { type: 'windows', normalized: 'C:/Users/foo/project', isAbsolute: true }
 *
 * @example
 * analyzePath('user@server:/home/user/project')
 * // => { type: 'ssh-remote', sshHost: 'server', remotePath: '/home/user/project' }
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

  // Check for SSH remote paths
  const sshMatch = inputPath.match(SSH_REMOTE_REGEX)
  if (sshMatch && !WINDOWS_DRIVE_REGEX.test(inputPath)) {
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

  // Check for Unix absolute paths
  if (inputPath.startsWith('/') && !inputPath.startsWith('//')) {
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
 */
export function toGitPath(inputPath: string): string {
  const info = analyzePath(inputPath)

  // For SSH paths, return the remote path normalized
  if (info.type === 'ssh-remote' && info.remotePath) {
    return info.remotePath.replace(/\\/g, '/')
  }

  // For all other paths, normalize slashes
  return info.normalized
}

/**
 * Convert a path for Node.js filesystem operations.
 * On Windows, ensures backslashes for native paths.
 */
export function toFsPath(inputPath: string): string {
  const env = getEnvironment()
  const info = analyzePath(inputPath)

  // On non-Windows platforms, return the normalized path
  if (!env.isWindows) {
    return info.normalized
  }

  // For Windows paths, use native format
  if (info.type === 'windows') {
    return inputPath.replace(/\//g, '\\')
  }

  // Fallback
  return inputPath
}

/**
 * Convert a path to a user-friendly display format.
 */
export function toDisplayPath(inputPath: string): string {
  const info = analyzePath(inputPath)

  if (info.type === 'ssh-remote' && info.sshHost && info.remotePath) {
    return `SSH:${info.sshHost}:${info.remotePath}`
  }

  return info.normalized
}

/**
 * Convert a path for SSH remote operations.
 */
export function toSshPath(inputPath: string, remotePath?: string): string {
  if (remotePath) {
    return remotePath.replace(/\\/g, '/')
  }

  const info = analyzePath(inputPath)

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
 */
export function join(...segments: string[]): string {
  return nodePath.join(...segments)
}

/**
 * Join path segments using POSIX separators (forward slashes).
 */
export function joinPosix(...segments: string[]): string {
  const normalized = segments.map(s => s.replace(/\\/g, '/'))
  return posixPath.join(...normalized)
}

/**
 * Get the directory name from a path.
 */
export function dirname(inputPath: string): string {
  const info = analyzePath(inputPath)

  // For Unix paths, use posix
  if (info.type === 'unix') {
    return posixPath.dirname(info.normalized)
  }

  // For Windows paths, use native
  return nodePath.dirname(inputPath)
}

/**
 * Get the file name from a path.
 */
export function basename(inputPath: string): string {
  const info = analyzePath(inputPath)
  return posixPath.basename(info.normalized)
}

/**
 * Get the file extension from a path.
 */
export function extname(inputPath: string): string {
  const info = analyzePath(inputPath)
  return posixPath.extname(info.normalized)
}

/**
 * Get the relative path from one path to another.
 */
export function relative(from: string, to: string): string {
  const fromInfo = analyzePath(from)
  const toInfo = analyzePath(to)
  return posixPath.relative(fromInfo.normalized, toInfo.normalized)
}

/**
 * Resolve path segments to an absolute path.
 */
export function resolve(...segments: string[]): string {
  return nodePath.resolve(...segments)
}

/**
 * Normalize a path by cleaning up separators and resolving . and ..
 */
export function normalize(inputPath: string): string {
  const info = analyzePath(inputPath)

  // For Unix-style paths, use posix normalization
  if (info.type === 'unix') {
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
 */
export function escapeForBash(inputPath: string): string {
  const escaped = inputPath.replace(/'/g, "'\\''")
  return `'${escaped}'`
}

/**
 * Escape a path for use in Windows cmd.exe.
 */
export function escapeForCmd(inputPath: string): string {
  const escaped = inputPath
    .replace(/([&|<>^])/g, '^$1')
    .replace(/"/g, '""')
  return `"${escaped}"`
}

/**
 * Escape a path for use in PowerShell.
 */
export function escapeForPowerShell(inputPath: string): string {
  const escaped = inputPath.replace(/'/g, "''")
  return `'${escaped}'`
}

// ============================================================================
// Validation & Utilities
// ============================================================================

/**
 * Check if a path is a Windows-style path (drive letter).
 */
export function isWindowsPath(inputPath: string): boolean {
  const info = analyzePath(inputPath)
  return info.type === 'windows'
}

/**
 * Check if a path is absolute.
 */
export function isAbsolutePath(inputPath: string): boolean {
  const info = analyzePath(inputPath)
  return info.isAbsolute
}

/**
 * Check if two paths refer to the same location.
 */
export function isSamePath(path1: string, path2: string): boolean {
  const info1 = analyzePath(path1)
  const info2 = analyzePath(path2)

  const norm1 = info1.normalized.replace(/\/+$/, '').toLowerCase()
  const norm2 = info2.normalized.replace(/\/+$/, '').toLowerCase()

  return norm1 === norm2
}

/**
 * Check if one path is a subpath of another.
 */
export function isSubPath(parent: string, child: string): boolean {
  const parentInfo = analyzePath(parent)
  const childInfo = analyzePath(child)

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
 */
export function isImpossibleLocalPath(inputPath: string): boolean {
  const env = getEnvironment()

  if (env.isWindows) {
    // On Windows, macOS-style paths are impossible locally
    if (MACOS_REMOTE_PREFIXES.some(prefix => inputPath.startsWith(prefix))) {
      return true
    }

    // On Windows, /home/... paths are impossible locally
    if (inputPath.startsWith('/home/')) {
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
 * Check if a path requires SSH execution.
 */
export function isSSHPath(inputPath: string): boolean {
  const info = analyzePath(inputPath)

  if (info.type === 'ssh-remote') {
    return true
  }

  if (isImpossibleLocalPath(inputPath)) {
    return true
  }

  return false
}

/**
 * Check if a path is local (can be executed directly on this machine).
 */
export function isLocalPath(inputPath: string): boolean {
  return !isSSHPath(inputPath)
}

/**
 * Get the SSH host from a path, if applicable.
 */
export function getSSHHost(inputPath: string): string | null {
  const info = analyzePath(inputPath)
  return info.sshHost || null
}

/**
 * Get the SSH user from a path, if applicable.
 */
export function getSSHUser(inputPath: string): string | null {
  const match = inputPath.match(/^([^@]+)@([^:]+):/)
  if (match) {
    return match[1]
  }
  return null
}

/**
 * Escape a path for use in SSH remote bash commands.
 */
export function escapeForSSHRemote(inputPath: string): string {
  return escapeForBash(inputPath)
}

/**
 * Interface for SSH manager to check connection status and execute remote commands.
 */
export interface SSHManagerLike {
  getProjectMasterStatus(projectId: string): Promise<{ connected: boolean; error?: string }>
  isProjectConnected?(projectId: string): boolean
  execViaProjectMaster(projectId: string, command: string): Promise<string>
}

/**
 * Determine the execution context for a given path.
 * This is the primary method for deciding how to execute commands.
 */
export async function getExecutionContext(
  inputPath: string,
  projectId?: string,
  sshManager?: SSHManagerLike
): Promise<ExecutionContext> {
  const env = getEnvironment()
  const info = analyzePath(inputPath)

  // First, check if this is an SSH project with an active connection.
  if (projectId && sshManager) {
    try {
      if (sshManager.isProjectConnected) {
        if (sshManager.isProjectConnected(projectId)) {
          return 'ssh-remote'
        }
      } else {
        const status = await sshManager.getProjectMasterStatus(projectId)
        if (status.connected) {
          return 'ssh-remote'
        }
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
    return 'local-windows'
  }

  return 'local-unix'
}

/**
 * Synchronous version of getExecutionContext for cases where async is not possible.
 * NOTE: This cannot verify SSH connection status.
 */
export function getExecutionContextSync(inputPath: string): ExecutionContext {
  const env = getEnvironment()
  const info = analyzePath(inputPath)

  if (info.type === 'ssh-remote') {
    return 'ssh-remote'
  }

  if (isImpossibleLocalPath(inputPath)) {
    return 'ssh-remote'
  }

  if (env.isWindows) {
    return 'local-windows'
  }

  return 'local-unix'
}

// ============================================================================
// Namespace Export
// ============================================================================

export const PathService = {
  // Environment
  getEnvironment,
  clearEnvironmentCache,

  // Windows Helpers
  getProgramFilesPath,
  getProgramFilesX86Path,

  // Git Bash
  getGitBashPath,
  clearGitBashCache,

  // Platform
  getPlatformForInstall,

  // Path Analysis
  analyzePath,

  // Path Conversion
  toGitPath,
  toFsPath,
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
