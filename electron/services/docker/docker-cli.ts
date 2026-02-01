import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import {
  toFsPath,
  toWslLinuxPath,
  analyzePath,
  getExecutionContextSync,
  dirname as pathServiceDirname,
  basename as pathServiceBasename,
  join as pathServiceJoin,
} from '../../utils/path-service.js'
import { buildWslCommand } from '../../utils/wsl-utils.js'

const execAsync = promisify(exec)

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

export class DockerCli {
  private dockerPath: string = 'docker'
  private composeCommand: string | null = null

  /**
   * Detect which compose command is available (v2 plugin or v1 standalone)
   * Caches the result for subsequent calls
   */
  private async detectComposeCommand(): Promise<string> {
    if (this.composeCommand !== null) {
      return this.composeCommand
    }

    // Try v2 plugin first: docker compose
    try {
      await execAsync('docker compose --version')
      this.composeCommand = 'docker compose'
      return this.composeCommand
    } catch {
      // v2 not available
    }

    // Fall back to v1 standalone: docker-compose
    try {
      await execAsync('docker-compose --version')
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
  private async buildComposeCommand(args: string): Promise<string> {
    const compose = await this.detectComposeCommand()
    return `${compose} ${args}`
  }

  /**
   * Get the appropriate paths for running docker compose commands.
   *
   * Docker running inside WSL expects Linux paths, not Windows UNC paths.
   * This method returns:
   * - `cwd`: The path Node.js should use for the working directory (may be UNC on Windows)
   * - `dockerDir`: The path to pass to docker for the -f flag directory context
   * - `file`: The compose filename
   * - `context`: The execution context ('wsl', 'local-windows', or 'local-unix')
   * - `pathInfo`: The analyzed path information (for WSL distro, etc.)
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

    // For docker commands, determine the right path format
    let dockerDir: string

    if (context === 'wsl' || pathInfo.type === 'wsl-unc' || pathInfo.type === 'wsl-linux') {
      // Docker inside WSL needs Linux paths
      dockerDir = toWslLinuxPath(pathServiceDirname(composePath))
    } else {
      // Local Windows or Unix - use the directory as-is
      dockerDir = pathServiceDirname(composePath)
    }

    return { cwd, dockerDir, file, context, pathInfo }
  }

  /**
   * Execute a docker command in the appropriate context.
   *
   * When the execution context is WSL, the command is run through WSL bash
   * to avoid CMD.EXE's UNC path issues. Otherwise, it runs directly.
   *
   * @param cmd - The docker command to execute
   * @param execInfo - Execution info from getComposePathsForExecution
   * @returns Promise with stdout and stderr
   */
  private async execDockerCommand(
    cmd: string,
    execInfo: {
      cwd: string;
      dockerDir: string;
      context: ReturnType<typeof getExecutionContextSync>;
      pathInfo: ReturnType<typeof analyzePath>;
    }
  ): Promise<{ stdout: string; stderr: string }> {
    const { cwd, dockerDir, context, pathInfo } = execInfo

    if (context === 'wsl') {
      // Run through WSL to avoid CMD.EXE UNC path issues
      const wslCommand = buildWslCommand(cmd, dockerDir, {
        isWslPath: true,
        linuxPath: pathInfo.linuxPath,
        distro: pathInfo.wslDistro
      })

      return new Promise((resolve, reject) => {
        exec(wslCommand.cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            // Attach stdout and stderr to error for callers that check them
            const execError = error as Error & { stdout?: string; stderr?: string }
            execError.stdout = stdout
            execError.stderr = stderr
            reject(execError)
          } else {
            resolve({ stdout, stderr })
          }
        })
      })
    }

    // Local Windows or Unix - execute directly with cwd
    return execAsync(cmd, { cwd })
  }

  /**
   * Check if Docker CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`${this.dockerPath} --version`)
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
   * - WSL UNC paths (\\wsl$\Ubuntu\...) are converted for Node.js fs operations
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
        // Return the path in original format (preserving WSL UNC if that's what was passed)
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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" config --format json`)

      const { stdout } = await this.execDockerCommand(cmd, execInfo)

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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" ps --format json`)

      const { stdout } = await this.execDockerCommand(cmd, execInfo)

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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" start "${serviceName}"`)

      const { stdout, stderr } = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output: stdout || stderr }
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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" stop "${serviceName}"`)

      const { stdout, stderr } = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output: stdout || stderr }
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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" restart "${serviceName}"`)

      const { stdout, stderr } = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output: stdout || stderr }
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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" logs "${serviceName}" --tail ${tail}`)

      const { stdout, stderr } = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output: stdout || stderr }
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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" up -d`)

      const { stdout, stderr } = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output: stdout || stderr }
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
      const cmd = await this.buildComposeCommand(`-f "${execInfo.file}" down`)

      const { stdout, stderr } = await this.execDockerCommand(cmd, execInfo)

      return { success: true, output: stdout || stderr }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  }
}

// Singleton instance
export const dockerCli = new DockerCli()
