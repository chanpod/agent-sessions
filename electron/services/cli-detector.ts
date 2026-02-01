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
  /** Inferred installation method based on path */
  installMethod?: 'npm' | 'native' | 'brew' | 'unknown'
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
  versionRegex: /v?(\d+\.\d+(?:\.\d+)?)/i,
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
  versionRegex: /v?(\d+\.\d+(?:\.\d+)?)/i,
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
  versionRegex: /v?(\d+\.\d+(?:\.\d+)?)/i,
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

  switch (context) {
    case 'ssh-remote': {
      // Must use SSH
      if (!projectId || !sshManager) {
        throw new Error(`SSH connection required but not configured for path: ${projectPath}`)
      }

      const projectMasterStatus = await sshManager.getProjectMasterStatus(projectId)
      if (!projectMasterStatus.connected) {
        throw new Error('SSH connection not available for project')
      }

      try {
        const output = await sshManager.execViaProjectMaster(projectId, command)
        return { stdout: output, stderr: '' }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`SSH command failed: ${errorMessage}`)
      }
    }

    case 'wsl': {
      // Use wsl.exe for WSL paths
      const pathInfo = PathService.analyzePath(projectPath)
      const wslCommand = buildWslCommand(command, projectPath, {
        isWslPath: true,
        linuxPath: pathInfo.linuxPath,
        distro: pathInfo.wslDistro,
      })

      try {
        const result = await execAsync(wslCommand.cmd, {
          encoding: 'utf-8',
          timeout: 10000,
        })
        return { stdout: result.stdout, stderr: result.stderr }
      } catch (error: unknown) {
        // exec throws on non-zero exit codes, but the command may have still produced output
        const execError = error as { stdout?: string; stderr?: string; message?: string }
        const stdout = execError.stdout || ''
        const stderr = execError.stderr || ''

        // If we got any output, return it even if the command "failed"
        if (stdout || stderr) {
          return { stdout, stderr }
        }

        // Command not found in WSL is not an error for detection purposes
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes('not found') || errorMessage.includes('command not found')) {
          return { stdout: '', stderr: errorMessage }
        }
        throw error
      }
    }

    case 'local-windows': {
      // On Windows, prefer Git Bash for proper PATH handling
      const gitBashPath = getGitBashPath()

      try {
        let result: { stdout: string; stderr: string }

        if (gitBashPath) {
          // Use Git Bash as a login shell (-l) to source .bashrc/.bash_profile
          // This ensures tools in ~/.local/bin are found via proper PATH setup
          const escapedCommand = command.replace(/"/g, '\\"')
          const bashCommand = `"${gitBashPath}" -l -c "${escapedCommand}"`

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

        return { stdout: result.stdout, stderr: result.stderr }
      } catch (error: unknown) {
        // exec throws on non-zero exit codes, but the command may have still produced output
        // Extract stdout/stderr from the error if available (they're properties on exec errors)
        const execError = error as { stdout?: string; stderr?: string; message?: string }
        const stdout = execError.stdout || ''
        const stderr = execError.stderr || ''

        // If we got any output, return it even if the command "failed"
        // Many CLIs exit with non-zero but still output version info
        if (stdout || stderr) {
          return { stdout, stderr }
        }

        // Command not found is not an error for detection purposes
        const errorMessage = error instanceof Error ? error.message : String(error)
        const isCommandNotFound =
          errorMessage.includes('not found') ||
          errorMessage.includes('is not recognized') ||
          errorMessage.includes('not recognized as') ||
          errorMessage.includes('ENOENT') ||
          errorMessage.includes('command not found') ||
          errorMessage.includes('No such file or directory')

        if (isCommandNotFound) {
          return { stdout: '', stderr: errorMessage }
        }
        throw error
      }
    }

    case 'local-unix': {
      // Execute directly on local Unix system
      try {
        const result = await execAsync(command, {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 10000,
          shell: true,
          env: process.env,
          windowsHide: true,
        })
        return { stdout: result.stdout, stderr: result.stderr }
      } catch (error: unknown) {
        // exec throws on non-zero exit codes, but the command may have still produced output
        const execError = error as { stdout?: string; stderr?: string; message?: string }
        const stdout = execError.stdout || ''
        const stderr = execError.stderr || ''

        // If we got any output, return it even if the command "failed"
        if (stdout || stderr) {
          return { stdout, stderr }
        }

        // Command not found is not an error for detection purposes
        const errorMessage = error instanceof Error ? error.message : String(error)
        const isCommandNotFound =
          errorMessage.includes('not found') ||
          errorMessage.includes('ENOENT') ||
          errorMessage.includes('command not found')

        if (isCommandNotFound) {
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
  try {
    console.log(`[cli-detector] tryCommand: executing "${command}"`)
    const result = await execInContextAsync(command, projectPath, projectId, sshManager)
    // Some CLIs output version to stderr instead of stdout, so check both
    const output = result.stdout.trim() || result.stderr.trim()
    console.log(`[cli-detector] tryCommand: "${command}" -> stdout="${result.stdout.trim()}", stderr="${result.stderr.trim()}", output="${output}"`)
    return output || null
  } catch (error) {
    console.log(`[cli-detector] tryCommand: "${command}" failed:`, error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Extract version from command output using regex
 */
function extractVersion(output: string, regex: RegExp): string | undefined {
  const match = output.match(regex)
  console.log(`[cli-detector] extractVersion: output="${output}", regex=${regex}, match=${JSON.stringify(match)}`)
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
 * Infer the installation method from the detected path
 */
function inferInstallMethodFromPath(path: string | undefined): 'npm' | 'native' | 'brew' | 'unknown' {
  if (!path) return 'unknown'

  const normalized = path.toLowerCase().replace(/\\/g, '/')

  // Check for npm indicators
  if (normalized.includes('/appdata/roaming/npm/') ||  // Windows npm
      normalized.includes('/nvm4w/nodejs/') ||          // Windows nvm npm
      normalized.includes('/.npm/') ||                  // Unix npm global
      normalized.includes('/node_modules/')) {          // npm node_modules
    return 'npm'
  }

  // Check for Homebrew indicators
  if (normalized.includes('/opt/homebrew/') ||         // M1 Macs
      normalized.includes('/usr/local/cellar/') ||     // Intel Macs
      normalized.includes('/linuxbrew/')) {            // Linuxbrew
    return 'brew'
  }

  // Check for native installer paths
  if (normalized.includes('/appdata/local/programs/') ||  // Windows native
      normalized.includes('/program files/')) {
    return 'native'
  }

  // ~/.local/bin could be npm or native - default to npm for CLI tools
  if (normalized.includes('/.local/bin/')) {
    return 'npm'
  }

  return 'unknown'
}

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
  console.log(`[cli-detector] Detecting ${tool.name} (${tool.id}) for path: ${projectPath}`)

  const result: CliToolDetectionResult = {
    id: tool.id,
    name: tool.name,
    installed: false,
  }

  try {
    // Determine execution context
    const context = await PathService.getExecutionContext(projectPath, projectId, sshManager)

    // Try version commands first
    let versionOutput: string | null = null
    for (const cmd of tool.versionCommands) {
      versionOutput = await tryCommand(cmd, projectPath, projectId, sshManager)
      if (versionOutput) {
        result.installed = true
        result.version = extractVersion(versionOutput, tool.versionRegex)
        break
      }
    }

    // If no version found, try path commands as fallback
    if (!result.installed) {
      const pathCommands = getPathCommands(tool, context)
      for (const cmd of pathCommands) {
        const pathOutput = await tryCommand(cmd, projectPath, projectId, sshManager)
        if (pathOutput) {
          result.installed = true
          result.path = pathOutput.split('\n')[0].trim() // Take first line in case of multiple paths
          break
        }
      }

      // Note: With Git Bash as the shell on Windows, fallback paths are typically not needed
      // since Git Bash properly handles PATH. Fallback path checking has been removed.
    } else if (!result.path) {
      // If we got version, also try to get path
      const pathCommands = getPathCommands(tool, context)
      for (const cmd of pathCommands) {
        const pathOutput = await tryCommand(cmd, projectPath, projectId, sshManager)
        if (pathOutput) {
          result.path = pathOutput.split('\n')[0].trim()
          break
        }
      }
    }

    // Infer install method from detected path
    result.installMethod = inferInstallMethodFromPath(result.path)

    console.log(`[cli-detector] ${tool.name}: installed=${result.installed}, version=${result.version || 'N/A'}, path=${result.path || 'N/A'}, installMethod=${result.installMethod}`)
    return result
  } catch (error: unknown) {
    result.error = error instanceof Error ? error.message : String(error)
    console.log(`[cli-detector] ${tool.name}: ERROR - ${result.error}`)
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
// Update Check Functions
// ============================================================================

/**
 * NPM package names for each agent CLI
 */
const NPM_PACKAGES: Record<string, string> = {
  claude: '@anthropic-ai/claude-code',
  gemini: '@anthropic-ai/claude-code', // Gemini CLI doesn't have an npm package yet, placeholder
  codex: '@openai/codex',
}

/**
 * Result of checking for updates
 */
export interface UpdateCheckResult {
  agentId: string
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  error?: string
}

/**
 * Fetch the latest version of an npm package
 *
 * @param packageName - The npm package name (e.g., '@anthropic-ai/claude-code')
 * @returns The latest version string or null if failed
 */
async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      // Add timeout
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      console.log(`[cli-detector] Failed to fetch ${packageName}: ${response.status}`)
      return null
    }

    const data = await response.json() as { version?: string }
    return data.version || null
  } catch (error: unknown) {
    console.error(`[cli-detector] Error fetching latest version for ${packageName}:`, error)
    return null
  }
}

/**
 * Compare two semantic version strings
 *
 * @param current - Current version (e.g., "1.0.0")
 * @param latest - Latest version (e.g., "1.1.0")
 * @returns true if latest is newer than current
 */
function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.replace(/^v/, '').split('.').map(Number)
  const latestParts = latest.replace(/^v/, '').split('.').map(Number)

  // Pad arrays to same length
  while (currentParts.length < 3) currentParts.push(0)
  while (latestParts.length < 3) latestParts.push(0)

  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > currentParts[i]) return true
    if (latestParts[i] < currentParts[i]) return false
  }

  return false
}

/**
 * Check for updates for a single agent
 *
 * @param agentId - The agent ID (e.g., 'claude', 'codex', 'gemini')
 * @param currentVersion - The currently installed version (or null if not installed)
 * @returns UpdateCheckResult with update availability
 */
export async function checkAgentUpdate(
  agentId: string,
  currentVersion: string | null
): Promise<UpdateCheckResult> {
  console.log(`[cli-detector] Checking update for ${agentId}, current version: ${currentVersion}`)

  const result: UpdateCheckResult = {
    agentId,
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
  }

  // Can't check for updates if not installed
  if (!currentVersion) {
    result.error = 'Agent not installed'
    return result
  }

  // Get the npm package name
  const packageName = NPM_PACKAGES[agentId]
  if (!packageName) {
    result.error = `Unknown agent: ${agentId}`
    return result
  }

  // Gemini doesn't have an npm package yet
  if (agentId === 'gemini') {
    result.error = 'Update check not available for Gemini CLI'
    return result
  }

  try {
    const latestVersion = await fetchLatestVersion(packageName)

    if (!latestVersion) {
      result.error = 'Failed to fetch latest version'
      return result
    }

    result.latestVersion = latestVersion
    result.updateAvailable = isNewerVersion(currentVersion, latestVersion)

    console.log(`[cli-detector] ${agentId}: current=${currentVersion}, latest=${latestVersion}, updateAvailable=${result.updateAvailable}`)

    return result
  } catch (error: unknown) {
    result.error = error instanceof Error ? error.message : String(error)
    console.error(`[cli-detector] Error checking update for ${agentId}:`, error)
    return result
  }
}

/**
 * Check for updates for multiple agents
 *
 * @param agents - Array of agent IDs and their current versions
 * @returns Array of UpdateCheckResult
 */
export async function checkAgentUpdates(
  agents: Array<{ id: string; version: string | null }>
): Promise<UpdateCheckResult[]> {
  console.log(`[cli-detector] Checking updates for ${agents.length} agents`)

  const results = await Promise.all(
    agents.map((agent) => checkAgentUpdate(agent.id, agent.version))
  )

  return results
}

// ============================================================================
// Exports
// ============================================================================

export const CliDetector = {
  detectCliTool,
  detectAllCliTools,
  createCliToolDefinition,
  checkAgentUpdate,
  checkAgentUpdates,
  BUILTIN_CLI_TOOLS,
  CLAUDE_CLI,
  GEMINI_CLI,
  CODEX_CLI,
}
