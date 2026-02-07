/**
 * CLI Installer Service
 *
 * Handles installing AI CLI tools (Claude Code, Gemini CLI, OpenAI Codex).
 * Supports multiple installation methods: npm, native scripts, and Homebrew.
 */

import { spawn } from 'child_process'
import {
  type AgentId,
  type InstallMethod,
  NPM_PACKAGES,
  BREW_PACKAGES,
  NATIVE_INSTALLS,
} from './cli-config.js'
import { getGitBashPath, type InstallPlatform } from '../utils/path-service.js'

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Result of a CLI installation attempt
 */
export interface InstallResult {
  /** Whether the installation succeeded */
  success: boolean
  /** Combined stdout/stderr output from the installation */
  output: string
  /** Error message if installation failed */
  error?: string
}

/**
 * Installation command configuration
 */
interface InstallCommand {
  /** The command to execute */
  command: string
  /** Arguments for the command */
  args: string[]
  /** Shell to use (if any) */
  shell?: string
  /** Shell arguments (used with shell) */
  shellArgs?: string[]
}

// ============================================================================
// Installation Command Builders
// ============================================================================

/**
 * Build the installation command configuration based on agent, method, and platform
 */
function buildInstallCommand(
  agentId: AgentId,
  method: InstallMethod,
  platform: InstallPlatform
): InstallCommand | { error: string } {
  console.log(`[cli-installer] Building install command: agent=${agentId}, method=${method}, platform=${platform}`)

  switch (method) {
    case 'npm': {
      const packageName = NPM_PACKAGES[agentId]
      // npm install works the same on all platforms
      return {
        command: 'npm',
        args: ['install', '-g', packageName],
      }
    }

    case 'native': {
      const nativeInstall = NATIVE_INSTALLS[agentId]

      if (platform === 'windows') {
        // Windows native install uses PowerShell
        if (!nativeInstall?.windows) {
          return { error: `Native installation is not available for ${agentId} on Windows` }
        }
        return {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', nativeInstall.windows],
        }
      } else {
        // macOS, Linux use the Unix installer
        if (!nativeInstall?.unix) {
          return { error: `Native installation is not available for ${agentId} on ${platform}` }
        }
        return {
          command: 'bash',
          args: ['-c', nativeInstall.unix],
        }
      }
    }

    case 'brew': {
      // Homebrew is only available on macOS (and Linux, but primarily macOS)
      if (platform !== 'macos' && platform !== 'linux') {
        return { error: `Homebrew installation is only available on macOS and Linux, not ${platform}` }
      }

      const brewPackage = BREW_PACKAGES[agentId]
      if (!brewPackage?.formula && !brewPackage?.cask) {
        return { error: `Homebrew package is not available for ${agentId}` }
      }

      if (brewPackage.cask) {
        return {
          command: 'brew',
          args: ['install', '--cask', brewPackage.cask],
        }
      } else if (brewPackage.formula) {
        return {
          command: 'brew',
          args: ['install', brewPackage.formula],
        }
      }

      return { error: `Homebrew package configuration error for ${agentId}` }
    }

    default: {
      const _exhaustive: never = method
      return { error: `Unknown installation method: ${method}` }
    }
  }
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute an installation command using spawn
 * Returns a promise that resolves with the result
 */
function executeInstallCommand(installCommand: InstallCommand, platform: InstallPlatform): Promise<InstallResult> {
  return new Promise((resolve) => {
    let output = ''
    let command: string
    let args: string[]

    // Determine how to run the command based on platform
    if (platform === 'windows' && installCommand.command !== 'powershell.exe') {
      // For non-PowerShell commands on Windows, use Git Bash
      const gitBashPath = getGitBashPath()
      if (gitBashPath) {
        // Run through Git Bash as a login shell
        const fullCommand = [installCommand.command, ...installCommand.args].join(' ')
        command = gitBashPath
        args = ['-l', '-c', fullCommand]
        console.log(`[cli-installer] Executing via Git Bash: ${fullCommand}`)
      } else {
        // Fall back to cmd.exe
        command = 'cmd.exe'
        args = ['/c', installCommand.command, ...installCommand.args]
        console.log(`[cli-installer] Executing via cmd.exe: ${installCommand.command} ${installCommand.args.join(' ')}`)
      }
    } else if (platform === 'windows' && installCommand.command === 'powershell.exe') {
      // PowerShell command on Windows - run directly
      command = installCommand.command
      args = installCommand.args
      console.log(`[cli-installer] Executing via PowerShell: ${args.join(' ')}`)
    } else {
      // Unix-like platforms (macOS, Linux) - run directly with shell
      command = installCommand.command
      args = installCommand.args
      console.log(`[cli-installer] Executing: ${command} ${args.join(' ')}`)
    }

    const spawnOptions: { shell?: boolean | string; env: NodeJS.ProcessEnv; windowsHide: boolean } = {
      env: { ...process.env },
      windowsHide: true,
    }

    // For npm on Unix, we might need shell for PATH resolution
    if (installCommand.command === 'npm' && platform !== 'windows') {
      spawnOptions.shell = true
    }
    // For brew, we need shell for PATH resolution
    if (installCommand.command === 'brew') {
      spawnOptions.shell = true
    }

    console.log(`[cli-installer] Spawn options:`, { command, args, shell: spawnOptions.shell })

    const child = spawn(command, args, spawnOptions)

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      output += text
      console.log(`[cli-installer] stdout: ${text.trim()}`)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      output += text
      console.log(`[cli-installer] stderr: ${text.trim()}`)
    })

    child.on('error', (error: Error) => {
      console.log(`[cli-installer] Spawn error: ${error.message}`)
      resolve({
        success: false,
        output,
        error: error.message,
      })
    })

    child.on('close', (code: number | null) => {
      console.log(`[cli-installer] Process exited with code: ${code}`)

      if (code === 0) {
        resolve({
          success: true,
          output,
        })
      } else {
        // Check for common permission errors
        let errorMessage = `Installation failed with exit code ${code}`

        if (output.includes('EACCES') || output.includes('permission denied')) {
          errorMessage = `Permission denied. Try fixing npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally`
        } else if (output.includes('EPERM')) {
          errorMessage = `Operation not permitted. On Windows, try running as administrator or check antivirus settings.`
        }

        resolve({
          success: false,
          output,
          error: errorMessage,
        })
      }
    })
  })
}

// ============================================================================
// Main Installation Function
// ============================================================================

/**
 * Install a CLI tool using the specified method and platform
 *
 * @param agentId - The CLI tool to install ('claude', 'gemini', or 'codex')
 * @param method - Installation method ('npm', 'native', or 'brew')
 * @param platform - Target platform ('windows', 'macos', or 'linux')
 * @param _cwd - Optional working directory (unused, kept for backward compatibility)
 * @returns Promise resolving to installation result
 *
 * @example
 * // Install Claude using native installer on macOS
 * const result = await installCliTool('claude', 'native', 'macos')
 *
 * @example
 * // Install Gemini using npm on Windows
 * const result = await installCliTool('gemini', 'npm', 'windows')
 *
 * @example
 * // Install Codex using Homebrew on macOS
 * const result = await installCliTool('codex', 'brew', 'macos')
 */
export async function installCliTool(
  agentId: AgentId | string,
  method: InstallMethod,
  platform: InstallPlatform,
  _cwd?: string
): Promise<InstallResult> {
  // Normalize agentId to lowercase and validate
  const normalizedAgentId = agentId.toLowerCase() as AgentId
  if (!['claude', 'gemini', 'codex'].includes(normalizedAgentId)) {
    return {
      success: false,
      output: '',
      error: `Unknown agent: ${agentId}. Supported agents are: claude, gemini, codex`,
    }
  }
  console.log(`[cli-installer] ========================================`)
  console.log(`[cli-installer] installCliTool called`)
  console.log(`[cli-installer]   agentId: ${agentId} (normalized: ${normalizedAgentId})`)
  console.log(`[cli-installer]   method: ${method}`)
  console.log(`[cli-installer]   platform: ${platform}`)

  // Build the installation command
  const commandResult = buildInstallCommand(normalizedAgentId, method, platform)

  // Check for build errors
  if ('error' in commandResult) {
    console.log(`[cli-installer]   Build error: ${commandResult.error}`)
    console.log(`[cli-installer] ========================================`)
    return {
      success: false,
      output: '',
      error: commandResult.error,
    }
  }

  // Execute the installation
  const result = await executeInstallCommand(commandResult, platform)

  console.log(`[cli-installer]   Result: success=${result.success}`)
  if (result.error) {
    console.log(`[cli-installer]   Error: ${result.error}`)
  }
  console.log(`[cli-installer] ========================================`)

  return result
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get available installation methods for a given agent and platform
 *
 * @param agentId - The CLI tool
 * @param platform - Target platform
 * @returns Array of available installation methods
 */
export function getAvailableInstallMethods(agentId: AgentId, platform: InstallPlatform): InstallMethod[] {
  const methods: InstallMethod[] = []

  // npm is always available
  methods.push('npm')

  // Check native availability
  const nativeInstall = NATIVE_INSTALLS[agentId]
  if (platform === 'windows' && nativeInstall?.windows) {
    methods.push('native')
  } else if (platform !== 'windows' && nativeInstall?.unix) {
    methods.push('native')
  }

  // Check brew availability (macOS and Linux only)
  if (platform === 'macos' || platform === 'linux') {
    const brewPackage = BREW_PACKAGES[agentId]
    if (brewPackage?.formula || brewPackage?.cask) {
      methods.push('brew')
    }
  }

  return methods
}

/**
 * Get the display name for an installation method
 */
export function getInstallMethodDisplayName(method: InstallMethod): string {
  switch (method) {
    case 'npm':
      return 'npm (Node Package Manager)'
    case 'native':
      return 'Native Installer'
    case 'brew':
      return 'Homebrew'
    default:
      return method
  }
}

/**
 * Get the package/command description for an installation
 */
export function getInstallDescription(agentId: AgentId, method: InstallMethod, platform: InstallPlatform): string {
  switch (method) {
    case 'npm':
      return `npm install -g ${NPM_PACKAGES[agentId]}`
    case 'native':
      if (platform === 'windows') {
        return NATIVE_INSTALLS[agentId]?.windows || 'N/A'
      }
      return NATIVE_INSTALLS[agentId]?.unix || 'N/A'
    case 'brew': {
      const pkg = BREW_PACKAGES[agentId]
      if (pkg?.cask) {
        return `brew install --cask ${pkg.cask}`
      }
      if (pkg?.formula) {
        return `brew install ${pkg.formula}`
      }
      return 'N/A'
    }
    default:
      return 'Unknown'
  }
}

// ============================================================================
// Exports
// ============================================================================

export const CliInstaller = {
  installCliTool,
  getAvailableInstallMethods,
  getInstallMethodDisplayName,
  getInstallDescription,
}
