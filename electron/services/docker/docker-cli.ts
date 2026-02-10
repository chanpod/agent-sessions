import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import {
  toFsPath,
  analyzePath,
  getExecutionContextSync,
  getEnvironment,
  toWslUncPath,
  dirname as pathServiceDirname,
  basename as pathServiceBasename,
  join as pathServiceJoin,
} from '../../utils/path-service.js'

const execAsync = promisify(exec)

/**
 * Function type for context-aware command execution.
 * Implementations route commands through the correct shell based on project path
 * (Git Bash for native Windows, wsl.exe for WSL projects, SSH for remote, etc.)
 */
export type ExecInContext = (command: string, projectPath: string) => Promise<string>

export interface DockerComposeService {
  name: string
  status: string
  state: string
  health?: string
  ports?: string[]
  image?: string
}

export interface DockerComposeConfig {
  services: Record<string, {
    image?: string
    build?: string | { context?: string; dockerfile?: string }
    ports?: string[]
    volumes?: string[]
    environment?: Record<string, string> | string[]
    depends_on?: string[] | Record<string, any>
  }>
}

export interface ComposeStatusResult {
  success: boolean
  services: DockerComposeService[]
  error?: string
}

export interface ComposeCommandResult {
  success: boolean
  output?: string
  error?: string
}

export interface DockerStack {
  name: string
  status: string
  configFiles: string
}

export interface DockerContainer {
  name: string
  service: string
  state: string
  status: string
  ports: string
  image: string
}

export class DockerCli {
  private dockerPath: string = 'docker'
  private composeCommand: string | null = null
  private execInContext: ExecInContext | null = null

  /**
   * Set the context-aware executor. Must be called before any Docker commands.
   * This routes commands through the correct shell (Git Bash, WSL, SSH)
   * based on the project path.
   */
  setExecInContext(fn: ExecInContext): void {
    this.execInContext = fn
  }

  /**
   * Run a command in the correct shell context for the given project path.
   * Falls back to bare execAsync if no context executor is set.
   */
  private async execInProjectContext(cmd: string, projectPath: string): Promise<string> {
    if (this.execInContext) {
      return this.execInContext(cmd, projectPath)
    }
    // Fallback — should not happen in production
    const { stdout } = await execAsync(cmd, { cwd: projectPath, encoding: 'utf-8' })
    return stdout
  }

  /**
   * Detect which compose command is available (v2 plugin or v1 standalone)
   * Caches the result for subsequent calls
   */
  private async detectComposeCommand(projectPath: string): Promise<string> {
    if (this.composeCommand !== null) {
      return this.composeCommand
    }

    // Try v2 plugin first: docker compose
    try {
      await this.execInProjectContext('docker compose --version', projectPath)
      this.composeCommand = 'docker compose'
      return this.composeCommand
    } catch {
      // v2 not available
    }

    // Fall back to v1 standalone: docker-compose
    try {
      await this.execInProjectContext('docker-compose --version', projectPath)
      this.composeCommand = 'docker-compose'
      return this.composeCommand
    } catch {
      // Neither available, default to v2 (will error when used)
      this.composeCommand = 'docker compose'
      return this.composeCommand
    }
  }

  /**
   * Build a compose command with the detected compose variant
   */
  private async buildComposeCommand(args: string, projectPath: string): Promise<string> {
    const compose = await this.detectComposeCommand(projectPath)
    return `${compose} ${args}`
  }

  /**
   * Get the appropriate paths for running docker compose commands.
   *
   * This method returns:
   * - `cwd`: The path Node.js should use for the working directory
   * - `dockerDir`: The path to pass to docker for the -f flag directory context
   * - `file`: The compose filename
   * - `context`: The execution context ('local-windows' or 'local-unix')
   * - `pathInfo`: The analyzed path information
   *
   * @param composePath - The full path to the compose file
   * @returns Object with cwd, dockerDir, file, context, and pathInfo
   */
  private getComposePathsForExecution(composePath: string): {
    cwd: string;
    dockerDir: string;
    file: string;
    context: ReturnType<typeof getExecutionContextSync>;
    pathInfo: ReturnType<typeof analyzePath>;
  } {
    const pathInfo = analyzePath(composePath)
    const context = getExecutionContextSync(composePath)

    // Get the filename (same regardless of platform)
    const file = pathServiceBasename(composePath)

    // For Node.js cwd, we need the filesystem-accessible path
    const cwd = toFsPath(pathServiceDirname(composePath))

    // For docker commands, use the directory as-is
    const dockerDir = pathServiceDirname(composePath)

    return { cwd, dockerDir, file, context, pathInfo }
  }

  /**
   * Execute a docker command in the appropriate context.
   * Routes through the context-aware executor using the compose file's directory.
   */
  private async execDockerCommand(
    cmd: string,
    execInfo: {
      cwd: string;
      dockerDir: string;
      context: ReturnType<typeof getExecutionContextSync>;
      pathInfo: ReturnType<typeof analyzePath>;
    }
  ): Promise<string> {
    return this.execInProjectContext(cmd, execInfo.dockerDir)
  }

  /**
   * Check if Docker CLI is available
   */
  async isAvailable(projectPath?: string): Promise<boolean> {
    try {
      if (projectPath) {
        await this.execInProjectContext(`${this.dockerPath} --version`, projectPath)
      } else {
        // Fallback for callers that don't have a project path
        await execAsync(`${this.dockerPath} --version`)
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Find compose file in a directory
   * Checks for: docker-compose.yml, docker-compose.yaml, compose.yml, compose.yaml
   *
   * Handles cross-platform paths:
   * - Paths are converted for Node.js fs operations
   * - Returns the path in the original format for consistency
   */
  async findComposeFile(projectPath: string): Promise<string | null> {
    const candidates = [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ]

    // Convert to filesystem-accessible path for file existence checks
    const fsPath = toFsPath(projectPath)

    for (const candidate of candidates) {
      // Use the fs-accessible path for the check
      const checkPath = pathServiceJoin(fsPath, candidate)
      try {
        await fs.promises.access(checkPath, fs.constants.F_OK)
        // Return the path in original format for consistency
        return pathServiceJoin(projectPath, candidate)
      } catch {
        // File doesn't exist, try next
      }
    }

    return null
  }

  /**
   * Parse a docker-compose file and return the config
   */
  async parseComposeFile(composePath: string): Promise<DockerComposeConfig | null> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" config --format json`, composePath)

      const stdout = await this.execDockerCommand(cmd, execInfo)

      return JSON.parse(stdout)
    } catch (error) {
      console.error('Failed to parse compose file:', error)
      return null
    }
  }

  /**
   * Get status of all services in a compose file
   */
  async getComposeStatus(composePath: string): Promise<ComposeStatusResult> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" ps --format json`, composePath)

      const stdout = await this.execDockerCommand(cmd, execInfo)

      // Docker compose ps can return multiple JSON objects, one per line
      const services: DockerComposeService[] = []
      const lines = stdout.trim().split('\n').filter(line => line.trim())

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          services.push({
            name: parsed.Name || parsed.Service || 'unknown',
            status: parsed.Status || 'unknown',
            state: parsed.State || 'unknown',
            health: parsed.Health,
            ports: parsed.Ports ? (typeof parsed.Ports === 'string' ? [parsed.Ports] : parsed.Ports) : [],
            image: parsed.Image,
          })
        } catch {
          // Skip invalid lines
        }
      }

      return { success: true, services }
    } catch (error: any) {
      // No containers running is not an error
      if (error.stderr?.includes('no containers') || error.stdout?.trim() === '') {
        return { success: true, services: [] }
      }
      return {
        success: false,
        services: [],
        error: error.message || String(error)
      }
    }
  }

  /**
   * Start a specific service
   */
  async startService(composePath: string, serviceName: string): Promise<ComposeCommandResult> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" start "${serviceName}"`, composePath)

      const output = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }

  /**
   * Stop a specific service
   */
  async stopService(composePath: string, serviceName: string): Promise<ComposeCommandResult> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" stop "${serviceName}"`, composePath)

      const output = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }

  /**
   * Restart a specific service
   */
  async restartService(composePath: string, serviceName: string): Promise<ComposeCommandResult> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" restart "${serviceName}"`, composePath)

      const output = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }

  /**
   * Get logs for a service
   */
  async getServiceLogs(composePath: string, serviceName: string, tail: number = 100): Promise<ComposeCommandResult> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" logs "${serviceName}" --tail ${tail}`, composePath)

      const output = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }

  /**
   * Start all services (docker compose up -d)
   */
  async upAll(composePath: string): Promise<ComposeCommandResult> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" up -d`, composePath)

      const output = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }

  /**
   * Stop all services (docker compose down)
   */
  async downAll(composePath: string): Promise<ComposeCommandResult> {
    try {
      const execInfo = this.getComposePathsForExecution(composePath)
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" down`, composePath)

      const output = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }

  /**
   * List all Docker Compose stacks on the system.
   * Uses `docker compose ls --format json`.
   * Requires projectPath to determine the correct shell context (Git Bash vs WSL).
   */
  async listStacks(projectPath: string): Promise<{ success: boolean; stacks: DockerStack[]; error?: string }> {
    try {
      const available = await this.isAvailable(projectPath)
      if (!available) {
        return { success: false, stacks: [], error: 'Docker is not available' }
      }

      const cmd = await this.buildComposeCommand('ls -a --format json', projectPath)
      const stdout = await this.execInProjectContext(cmd, projectPath)

      if (!stdout.trim()) {
        return { success: true, stacks: [] }
      }

      // docker compose ls --format json returns a JSON array
      const parsed = JSON.parse(stdout)
      const stacks: DockerStack[] = (Array.isArray(parsed) ? parsed : [parsed]).map((item: any) => ({
        name: item.Name || 'unknown',
        status: item.Status || 'unknown',
        configFiles: item.ConfigFiles || '',
      }))

      return { success: true, stacks }
    } catch (error: any) {
      return { success: false, stacks: [], error: error.message || String(error) }
    }
  }

  /**
   * Get containers for a specific Compose stack by project name.
   * Uses `docker compose -p <name> ps --format json`.
   * Requires projectPath to determine the correct shell context.
   */
  async getStackContainers(stackName: string, projectPath: string): Promise<{ success: boolean; containers: DockerContainer[]; error?: string }> {
    try {
      const cmd = await this.buildComposeCommand(`-p "${stackName}" ps -a --format json`, projectPath)
      const stdout = await this.execInProjectContext(cmd, projectPath)

      if (!stdout.trim()) {
        return { success: true, containers: [] }
      }

      // docker compose ps returns one JSON object per line (NDJSON)
      const containers: DockerContainer[] = []
      const lines = stdout.trim().split('\n').filter(line => line.trim())

      for (const line of lines) {
        try {
          const item = JSON.parse(line)
          containers.push({
            name: item.Name || 'unknown',
            service: item.Service || '',
            state: item.State || 'unknown',
            status: item.Status || '',
            ports: item.Ports || '',
            image: item.Image || '',
          })
        } catch {
          // Skip malformed lines
        }
      }

      return { success: true, containers }
    } catch (error: any) {
      // No containers is not an error
      if (error.stderr?.includes('no containers') || error.stdout?.trim() === '') {
        return { success: true, containers: [] }
      }
      return { success: false, containers: [], error: error.message || String(error) }
    }
  }

  /**
   * Resolve the configFiles path from `docker compose ls` into a context path
   * that execInContextAsync can route correctly.
   *
   * `docker compose ls` returns Linux-native paths (e.g. /home/user/project/docker-compose.yml)
   * even when queried from Windows. On Windows with WSL, we convert these to WSL UNC paths
   * so execInContextAsync routes through WSL instead of cmd.exe.
   */
  private resolveConfigFilesContextPath(configFiles: string): string {
    const env = getEnvironment()
    const info = analyzePath(configFiles)

    // Bare Linux path on Windows = WSL path, convert to UNC so exec routes through WSL
    if (env.isWindows && info.type === 'unix' && info.isAbsolute && env.defaultWslDistro) {
      const dir = configFiles.substring(0, configFiles.lastIndexOf('/'))
      return toWslUncPath(dir, env.defaultWslDistro)
    }

    // Otherwise use the config file's directory as-is
    return pathServiceDirname(configFiles)
  }

  /**
   * Run a stack action using -p (project name).
   * Routes the command through the correct execution context derived from the
   * stack's configFiles path, not the app's project path.
   */
  private async runStackAction(stackName: string, configFiles: string, action: string, _projectPath: string): Promise<ComposeCommandResult> {
    try {
      const contextPath = this.resolveConfigFilesContextPath(configFiles)
      const cmd = await this.buildComposeCommand(`-p "${stackName}" ${action}`, contextPath)
      const output = await this.execInProjectContext(cmd, contextPath)
      return { success: true, output }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }

  async upStack(stackName: string, configFiles: string, projectPath: string): Promise<ComposeCommandResult> {
    return this.runStackAction(stackName, configFiles, 'up -d', projectPath)
  }

  async stopStack(stackName: string, configFiles: string, projectPath: string): Promise<ComposeCommandResult> {
    return this.runStackAction(stackName, configFiles, 'stop', projectPath)
  }

  async downStack(stackName: string, configFiles: string, projectPath: string): Promise<ComposeCommandResult> {
    return this.runStackAction(stackName, configFiles, 'down', projectPath)
  }

  async restartStack(stackName: string, configFiles: string, projectPath: string): Promise<ComposeCommandResult> {
    return this.runStackAction(stackName, configFiles, 'restart', projectPath)
  }
}

// Singleton instance
export const dockerCli = new DockerCli()
