/**
 * CLI Detector Service
 *
 * Detects if various AI CLI tools (Claude Code, Gemini CLI, OpenAI Codex) are installed.
 * Supports Windows, WSL, and SSH execution contexts.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import { PathService, type ExecutionContext } from '../utils/path-service.js'
import { buildWslCommand } from '../utils/wsl-utils.js'

const execAsync = promisify(exec)

// ============================================================================
// Git Bash Detection (Windows)
// ============================================================================

/** Cached Git Bash path (null means not found, undefined means not yet checked) */
let cachedGitBashPath: string | null | undefined = undefined

/**
 * Find Git Bash executable path on Windows.
 * Checks common installation locations and caches the result.
 *
 * @returns Path to bash.exe if found, null otherwise
 */
function findGitBashPath(): string | null {
  // Return cached result if already checked
  if (cachedGitBashPath !== undefined) {
    return cachedGitBashPath
  }

  // Only search on Windows
  if (process.platform !== 'win32') {
    cachedGitBashPath = null
    return null
  }

  console.log('[cli-detector] Searching for Git Bash...')

  // Common Git Bash locations to check
  const possiblePaths: string[] = []

  // Check Program Files locations
  const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files'
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'

  possiblePaths.push(
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    // Also check usr/bin which has more Unix tools
    path.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'usr', 'bin', 'bash.exe'),
  )

  // Check each path
  for (const bashPath of possiblePaths) {
    console.log(`[cli-detector]   Checking: ${bashPath}`)
    try {
      if (fs.existsSync(bashPath)) {
        console.log(`[cli-detector]   Found Git Bash at: ${bashPath}`)
        cachedGitBashPath = bashPath
        return bashPath
      }
    } catch {
      // Ignore errors, continue checking
    }
  }

  console.log('[cli-detector]   Git Bash not found, will use default shell')
  cachedGitBashPath = null
  return null
}

/**
 * Get the cached Git Bash path or find it if not yet cached.
 * This is the main entry point for getting Git Bash path.
 */
function getGitBashPath(): string | null {
  return findGitBashPath()
}

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Definition for a CLI tool to detect
 */
export interface CliToolDefinition {
  /** Unique identifier for the tool */
  id: string
  /** Display name for the tool */
  name: string
  /** Commands to try for version detection (tries each until one succeeds) */
  versionCommands: string[]
  /** Commands to try for finding the executable path (tries each until one succeeds) */
  pathCommands: {
    windows: string[]
    unix: string[]
  }
  /** Regex pattern to extract version from command output */
  versionRegex: RegExp
  /**
   * @deprecated Fallback paths are no longer used since Git Bash handles PATH properly on Windows.
   * This field is kept for backwards compatibility but is ignored.
   */
  fallbackPaths?: string[]
}

/**
 * Result of detecting a single CLI tool
 */
export interface CliToolDetectionResult {
  /** Tool ID */
  id: string
  /** Tool display name */
  name: string
  /** Whether the tool is installed */
  installed: boolean
  /** Version string if detected */
  version?: string
  /** Path to the executable if found */
  path?: string
  /** Error message if detection failed */
  error?: string
}

/**
 * Result of detecting all CLI tools
 */
export interface AllCliToolsResult {
  /** All detection results */
  tools: CliToolDetectionResult[]
  /** Overall success (no errors during detection) */
  success: boolean
  /** Any global error message */
  error?: string
}

// ============================================================================
// Built-in Tool Definitions
// ============================================================================

/**
 * Claude Code CLI definition
 */
export const CLAUDE_CLI: CliToolDefinition = {
  id: 'claude',
  name: 'Claude Code',
  versionCommands: ['claude --version'],
  pathCommands: {
    windows: ['where claude'],
    unix: ['which claude'],
  },
  versionRegex: /(?:claude|version)\s*v?(\d+\.\d+(?:\.\d+)?)/i,
  fallbackPaths: [
    '~/.local/bin/claude',
    '~/.local/bin/claude.exe',
    '%LOCALAPPDATA%/Programs/claude/claude.exe',
    '%APPDATA%/npm/claude',
    '%APPDATA%/npm/claude.cmd',
  ],
}

/**
 * Gemini CLI definition
 */
export const GEMINI_CLI: CliToolDefinition = {
  id: 'gemini',
  name: 'Gemini CLI',
  versionCommands: ['gemini --version'],
  pathCommands: {
    windows: ['where gemini'],
    unix: ['which gemini'],
  },
  versionRegex: /(?:gemini|version)\s*v?(\d+\.\d+(?:\.\d+)?)/i,
  fallbackPaths: [
    '~/.local/bin/gemini',
    '~/.local/bin/gemini.exe',
    '%APPDATA%/npm/gemini',
    '%APPDATA%/npm/gemini.cmd',
  ],
}

/**
 * OpenAI Codex CLI definition
 */
export const CODEX_CLI: CliToolDefinition = {
  id: 'codex',
  name: 'OpenAI Codex',
  versionCommands: ['codex --version'],
  pathCommands: {
    windows: ['where codex'],
    unix: ['which codex'],
  },
  versionRegex: /(?:codex|version)\s*v?(\d+\.\d+(?:\.\d+)?)/i,
  fallbackPaths: [
    '~/.local/bin/codex',
    '~/.local/bin/codex.exe',
    '%APPDATA%/npm/codex',
    '%APPDATA%/npm/codex.cmd',
  ],
}

/**
 * All built-in CLI tools
 */
export const BUILTIN_CLI_TOOLS: CliToolDefinition[] = [
  CLAUDE_CLI,
  GEMINI_CLI,
  CODEX_CLI,
]

// ============================================================================
// SSH Manager Interface (for typing without circular imports)
// ============================================================================

interface SSHManagerLike {
  getProjectMasterStatus(projectId: string): Promise<{ connected: boolean; error?: string }>
  execViaProjectMaster(projectId: string, command: string): Promise<string>
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Execute a command in the appropriate context (local, WSL, or SSH)
 */
async function execInContextAsync(
  command: string,
  projectPath: string,
  projectId?: string,
  sshManager?: SSHManagerLike
): Promise<{ stdout: string; stderr: string }> {
  // Determine execution context using PathService
  const context = await PathService.getExecutionContext(projectPath, projectId, sshManager)
  console.log(`[cli-detector] execInContextAsync called`)
  console.log(`[cli-detector]   command: "${command}"`)
  console.log(`[cli-detector]   projectPath: "${projectPath}"`)
  console.log(`[cli-detector]   executionContext: "${context}"`)

  switch (context) {
    case 'ssh-remote': {
      // Must use SSH
      console.log(`[cli-detector]   Using SSH remote execution`)
      if (!projectId || !sshManager) {
        const err = `SSH connection required but not configured for path: ${projectPath}`
        console.log(`[cli-detector]   ERROR: ${err}`)
        throw new Error(err)
      }

      const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
      console.log(`[cli-detector]   SSH master status: connected=${projectMasterStatus.connected}`)
      if (!projectMasterStatus.connected) {
        const err = 'SSH connection not available for project'
        console.log(`[cli-detector]   ERROR: ${err}`)
        throw new Error(err)
      }

      try {
        const output = await sshManager.execViaProjectMaster(projectId, command)
        console.log(`[cli-detector]   SSH result: "${output.substring(0, 200)}${output.length > 200 ? '...' : ''}"`)
        return { stdout: output, stderr: '' }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[cli-detector]   SSH command error: ${errorMessage}`)
        throw new Error(`SSH command failed: ${errorMessage}`)
      }
    }

    case 'wsl': {
      // Use wsl.exe for WSL paths
      console.log(`[cli-detector]   Using WSL execution`)
      const pathInfo = PathService.analyzePath(projectPath)
      const wslCommand = buildWslCommand(command, projectPath, {
        isWslPath: true,
        linuxPath: pathInfo.linuxPath,
        distro: pathInfo.wslDistro,
      })
      console.log(`[cli-detector]   WSL command: "${wslCommand.cmd}"`)

      try {
        const result = await execAsync(wslCommand.cmd, {
          encoding: 'utf-8',
          timeout: 10000,
        })
        console.log(`[cli-detector]   WSL result stdout: "${result.stdout.substring(0, 200)}${result.stdout.length > 200 ? '...' : ''}"`)
        console.log(`[cli-detector]   WSL result stderr: "${result.stderr.substring(0, 200)}${result.stderr.length > 200 ? '...' : ''}"`)
        return { stdout: result.stdout, stderr: result.stderr }
      } catch (error: unknown) {
        // Command not found in WSL is not an error for detection purposes
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[cli-detector]   WSL error: ${errorMessage}`)
        if (errorMessage.includes('not found') || errorMessage.includes('command not found')) {
          return { stdout: '', stderr: errorMessage }
        }
        throw error
      }
    }

    case 'local-windows': {
      // On Windows, prefer Git Bash for proper PATH handling
      const gitBashPath = getGitBashPath()
      console.log(`[cli-detector]   Using local Windows execution`)
      console.log(`[cli-detector]   cwd: "${projectPath}"`)
      console.log(`[cli-detector]   shell: ${gitBashPath ? `Git Bash (${gitBashPath})` : 'default (cmd.exe)'}`)

      try {
        let result: { stdout: string; stderr: string }

        if (gitBashPath) {
          // Use Git Bash as a login shell (-l) to source .bashrc/.bash_profile
          // This ensures tools in ~/.local/bin are found via proper PATH setup
          const escapedCommand = command.replace(/"/g, '\\"')
          const bashCommand = `"${gitBashPath}" -l -c "${escapedCommand}"`
          console.log(`[cli-detector]   Executing: ${bashCommand}`)

          result = await execAsync(bashCommand, {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 10000,
            env: process.env,
            windowsHide: true,
            // Don't use shell option - we're explicitly calling bash
          })
        } else {
          // Fall back to default shell (cmd.exe)
          result = await execAsync(command, {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 10000,
            env: process.env,
            windowsHide: true,
            shell: true,
          })
        }

        console.log(`[cli-detector]   Local result stdout: "${result.stdout.substring(0, 200)}${result.stdout.length > 200 ? '...' : ''}"`)
        console.log(`[cli-detector]   Local result stderr: "${result.stderr.substring(0, 200)}${result.stderr.length > 200 ? '...' : ''}"`)
        return { stdout: result.stdout, stderr: result.stderr }
      } catch (error: unknown) {
        // Command not found is not an error for detection purposes
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[cli-detector]   Local error: ${errorMessage}`)
        const isCommandNotFound =
          errorMessage.includes('not found') ||
          errorMessage.includes('is not recognized') ||
          errorMessage.includes('not recognized as') ||
          errorMessage.includes('ENOENT') ||
          errorMessage.includes('command not found') ||
          errorMessage.includes('No such file or directory')

        if (isCommandNotFound) {
          console.log(`[cli-detector]   Command not found (expected for missing tools)`)
          return { stdout: '', stderr: errorMessage }
        }
        throw error
      }
    }

    case 'local-unix': {
      // Execute directly on local Unix system
      console.log(`[cli-detector]   Using local Unix execution`)
      console.log(`[cli-detector]   cwd: "${projectPath}"`)
      try {
        const result = await execAsync(command, {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 10000,
          shell: true,
          env: process.env,
          windowsHide: true,
        })
        console.log(`[cli-detector]   Local result stdout: "${result.stdout.substring(0, 200)}${result.stdout.length > 200 ? '...' : ''}"`)
        console.log(`[cli-detector]   Local result stderr: "${result.stderr.substring(0, 200)}${result.stderr.length > 200 ? '...' : ''}"`)
        return { stdout: result.stdout, stderr: result.stderr }
      } catch (error: unknown) {
        // Command not found is not an error for detection purposes
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[cli-detector]   Local error: ${errorMessage}`)
        const isCommandNotFound =
          errorMessage.includes('not found') ||
          errorMessage.includes('ENOENT') ||
          errorMessage.includes('command not found')

        if (isCommandNotFound) {
          console.log(`[cli-detector]   Command not found (expected for missing tools)`)
          return { stdout: '', stderr: errorMessage }
        }
        throw error
      }
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = context
      throw new Error(`Unknown execution context: ${context}`)
    }
  }
}

/**
 * Try to execute a command, returning null if it fails
 */
async function tryCommand(
  command: string,
  projectPath: string,
  projectId?: string,
  sshManager?: SSHManagerLike
): Promise<string | null> {
  console.log(`[cli-detector] tryCommand: "${command}"`)
  try {
    const result = await execInContextAsync(command, projectPath, projectId, sshManager)
    const output = result.stdout.trim() || null
    console.log(`[cli-detector] tryCommand result: ${output ? `"${output.substring(0, 100)}${output.length > 100 ? '...' : ''}"` : 'null'}`)
    return output
  } catch (error) {
    console.log(`[cli-detector] tryCommand error: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Extract version from command output using regex
 */
function extractVersion(output: string, regex: RegExp): string | undefined {
  const match = output.match(regex)
  return match?.[1]
}

/**
 * Get the appropriate path commands for the current execution context
 */
function getPathCommands(tool: CliToolDefinition, context: ExecutionContext): string[] {
  switch (context) {
    case 'local-windows':
      return tool.pathCommands.windows
    case 'local-unix':
    case 'wsl':
    case 'ssh-remote':
      return tool.pathCommands.unix
    default:
      return tool.pathCommands.unix
  }
}

// Note: expandFallbackPath function was removed as Git Bash handles PATH properly on Windows

// Note: checkFallbackPaths function was removed as Git Bash handles PATH properly on Windows

/**
 * Detect a single CLI tool
 *
 * @param tool - The tool definition to detect
 * @param projectPath - The project path (used to determine execution context)
 * @param projectId - Optional project ID for SSH connections
 * @param sshManager - Optional SSH manager for remote execution
 * @returns Detection result
 */
export async function detectCliTool(
  tool: CliToolDefinition,
  projectPath: string,
  projectId?: string,
  sshManager?: SSHManagerLike
): Promise<CliToolDetectionResult> {
  console.log(`[cli-detector] ========================================`)
  console.log(`[cli-detector] detectCliTool: "${tool.name}" (${tool.id})`)
  console.log(`[cli-detector]   projectPath: "${projectPath}"`)
  console.log(`[cli-detector]   projectId: ${projectId || 'undefined'}`)
  console.log(`[cli-detector]   sshManager: ${sshManager ? 'provided' : 'undefined'}`)

  const result: CliToolDetectionResult = {
    id: tool.id,
    name: tool.name,
    installed: false,
  }

  try {
    // Determine execution context
    const context = await PathService.getExecutionContext(projectPath, projectId, sshManager)
    console.log(`[cli-detector]   execution context: "${context}"`)

    // Try version commands first
    console.log(`[cli-detector]   Trying version commands: ${JSON.stringify(tool.versionCommands)}`)
    let versionOutput: string | null = null
    for (const cmd of tool.versionCommands) {
      versionOutput = await tryCommand(cmd, projectPath, projectId, sshManager)
      if (versionOutput) {
        result.installed = true
        result.version = extractVersion(versionOutput, tool.versionRegex)
        console.log(`[cli-detector]   Version detected: "${result.version}"`)
        break
      }
    }

    // If no version found, try path commands as fallback
    if (!result.installed) {
      const pathCommands = getPathCommands(tool, context)
      console.log(`[cli-detector]   No version found, trying path commands: ${JSON.stringify(pathCommands)}`)
      for (const cmd of pathCommands) {
        const pathOutput = await tryCommand(cmd, projectPath, projectId, sshManager)
        if (pathOutput) {
          result.installed = true
          result.path = pathOutput.split('\n')[0].trim() // Take first line in case of multiple paths
          console.log(`[cli-detector]   Path detected: "${result.path}"`)
          break
        }
      }

      // Note: With Git Bash as the shell on Windows, fallback paths are typically not needed
      // since Git Bash properly handles PATH. Fallback path checking has been removed.
    } else if (!result.path) {
      // If we got version, also try to get path
      const pathCommands = getPathCommands(tool, context)
      console.log(`[cli-detector]   Version found, also trying path commands: ${JSON.stringify(pathCommands)}`)
      for (const cmd of pathCommands) {
        const pathOutput = await tryCommand(cmd, projectPath, projectId, sshManager)
        if (pathOutput) {
          result.path = pathOutput.split('\n')[0].trim()
          console.log(`[cli-detector]   Path detected: "${result.path}"`)
          break
        }
      }
    }

    console.log(`[cli-detector]   FINAL RESULT: installed=${result.installed}, version=${result.version || 'N/A'}, path=${result.path || 'N/A'}`)
    console.log(`[cli-detector] ========================================`)
    return result
  } catch (error: unknown) {
    result.error = error instanceof Error ? error.message : String(error)
    console.log(`[cli-detector]   DETECTION ERROR: ${result.error}`)
    console.log(`[cli-detector] ========================================`)
    return result
  }
}

/**
 * Detect all built-in CLI tools
 *
 * @param projectPath - The project path (used to determine execution context)
 * @param projectId - Optional project ID for SSH connections
 * @param sshManager - Optional SSH manager for remote execution
 * @param additionalTools - Optional additional custom tool definitions to check
 * @returns All detection results
 */
export async function detectAllCliTools(
  projectPath: string,
  projectId?: string,
  sshManager?: SSHManagerLike,
  additionalTools?: CliToolDefinition[]
): Promise<AllCliToolsResult> {
  const allTools = [...BUILTIN_CLI_TOOLS, ...(additionalTools || [])]

  try {
    // Run all detections in parallel for efficiency
    const detectionPromises = allTools.map((tool) =>
      detectCliTool(tool, projectPath, projectId, sshManager)
    )

    const tools = await Promise.all(detectionPromises)

    return {
      tools,
      success: true,
    }
  } catch (error: unknown) {
    return {
      tools: allTools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        installed: false,
        error: 'Detection failed',
      })),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Create a custom CLI tool definition
 *
 * @param id - Unique identifier
 * @param name - Display name
 * @param command - Command name (used to build version and path commands)
 * @param versionRegex - Optional custom version regex
 * @returns A new CliToolDefinition
 */
export function createCliToolDefinition(
  id: string,
  name: string,
  command: string,
  versionRegex?: RegExp
): CliToolDefinition {
  return {
    id,
    name,
    versionCommands: [`${command} --version`, `${command} -v`, `${command} version`],
    pathCommands: {
      windows: [`where ${command}`],
      unix: [`which ${command}`],
    },
    versionRegex: versionRegex || /v?(\d+\.\d+(?:\.\d+)?)/i,
  }
}

// ============================================================================
// Exports
// ============================================================================

export const CliDetector = {
  detectCliTool,
  detectAllCliTools,
  createCliToolDefinition,
  BUILTIN_CLI_TOOLS,
  CLAUDE_CLI,
  GEMINI_CLI,
  CODEX_CLI,
}
