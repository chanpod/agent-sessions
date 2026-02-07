import { EventEmitter } from 'events'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { PathService } from './utils/path-service.js'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export interface SSHConnectionConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: 'key' | 'agent' | 'password'
  identityFile?: string
  options?: string[]
}

interface SSHConnection {
  config: SSHConnectionConfig
  controlPath: string
  connected: boolean
  lastUsed: number
  error?: string
}

interface ProjectMasterConnection {
  projectId: string
  sshConnectionId: string
  controlPath: string // ControlMaster control socket path
  connected: boolean
  connectedAt: number
  lastUsed: number
  error?: string
}

export class SSHManager extends EventEmitter {
  private connections: Map<string, SSHConnection> = new Map()
  private projectMasterConnections: Map<string, ProjectMasterConnection> = new Map()
  private controlDir: string
  private ptyManager?: any // Will be set by main.ts
  /** Cached Git Bash path on Windows (null if not found) */
  private gitBashPath: string | null = null

  // Health monitor properties
  private healthCheckInterval: NodeJS.Timeout | null = null
  private healthCheckRunning: boolean = false
  private readonly healthCheckIntervalMs: number = 30000 // 30 seconds default

  constructor() {
    super()

    // Resolve Git Bash path once on Windows — all SSH operations go through it.
    // We must use Git Bash explicitly since SSH ControlMaster, /tmp paths,
    // and the overall environment must be consistent across all calls.
    if (process.platform === 'win32') {
      this.gitBashPath = PathService.getGitBashPath()
      if (!this.gitBashPath) {
        console.error('[SSHManager] Git Bash not found — SSH operations will fail on Windows')
      }
      this.controlDir = '/tmp/agent-sessions-ssh'
    } else {
      this.controlDir = path.join(os.tmpdir(), 'agent-sessions-ssh')
    }
    this.ensureControlDir()
    this.startHealthMonitor()
  }

  /**
   * Returns the quoted Git Bash path for use in exec commands, or 'bash.exe' as fallback.
   */
  private getBashCommand(): string {
    if (!this.gitBashPath) return 'bash.exe'
    // Quote the path since it contains spaces (e.g. "C:\Program Files\Git\bin\bash.exe")
    return `"${this.gitBashPath}"`
  }

  /**
   * Set the PTY manager reference (called from main.ts)
   */
  setPtyManager(ptyManager: any) {
    this.ptyManager = ptyManager
  }

  /**
   * Start the background health monitor that periodically checks all SSH connections.
   * Detects stale/dead connections (e.g., after computer sleep) and updates UI.
   */
  startHealthMonitor(): void {
    if (this.healthCheckInterval) {
      return // Already running
    }

    console.log(`[SSHManager] Starting health monitor (interval: ${this.healthCheckIntervalMs}ms)`)

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthCheck()
    }, this.healthCheckIntervalMs)
  }

  /**
   * Stop the background health monitor and clean up the interval.
   */
  stopHealthMonitor(): void {
    if (this.healthCheckInterval) {
      console.log('[SSHManager] Stopping health monitor')
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  /**
   * Run a single health check cycle on all active connections.
   * Skips if a previous check is still running to prevent overlapping checks.
   */
  private async runHealthCheck(): Promise<void> {
    // Prevent concurrent health checks
    if (this.healthCheckRunning) {
      return
    }

    this.healthCheckRunning = true

    try {
      // Check base SSH connections
      for (const [connectionId, connection] of this.connections) {
        // Skip connections already marked as disconnected
        if (!connection.connected) {
          continue
        }

        // Password auth connections don't have a real ControlMaster until interactive use
        if (connection.config.authMethod === 'password') {
          continue
        }

        try {
          const status = await this.getStatus(connectionId)
          if (!status.connected && connection.connected) {
            // Connection was previously connected but is now dead
            console.log(`[SSHManager] Health check: Connection "${connection.config.name}" (${connectionId}) is stale`)
            connection.connected = false
            connection.error = status.error || 'Connection lost'
            this.emit('status-change', connectionId, false, connection.error)
          }
        } catch (error: any) {
          // Check itself failed - treat as disconnected
          console.log(`[SSHManager] Health check: Connection "${connection.config.name}" check failed: ${error.message}`)
          connection.connected = false
          connection.error = error.message
          this.emit('status-change', connectionId, false, connection.error)
        }
      }

      // Check project master connections
      for (const [projectId, projectConnection] of this.projectMasterConnections) {
        // Skip connections already marked as disconnected
        if (!projectConnection.connected) {
          continue
        }

        try {
          const status = await this.getProjectMasterStatus(projectId)
          if (!status.connected && projectConnection.connected) {
            // Project master was previously connected but is now dead
            console.log(`[SSHManager] Health check: Project master "${projectId}" is stale`)
            // Note: getProjectMasterStatus already updates projectConnection.connected
            // but we emit the event explicitly for the UI
            this.emit('project-status-change', projectId, false, status.error || 'Connection lost')
          }
        } catch (error: any) {
          // Check itself failed - treat as disconnected
          console.log(`[SSHManager] Health check: Project master "${projectId}" check failed: ${error.message}`)
          projectConnection.connected = false
          projectConnection.error = error.message
          this.emit('project-status-change', projectId, false, projectConnection.error)
        }
      }
    } finally {
      this.healthCheckRunning = false
    }
  }

  /**
   * Find an available port for SSH tunneling
   */
  private async findAvailablePort(startPort: number = 50000, endPort: number = 60000): Promise<number> {
    const net = await import('net')

    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        if (port > endPort) {
          reject(new Error('No available ports found'))
          return
        }

        const server = net.createServer()
        server.listen(port, '127.0.0.1', () => {
          server.once('close', () => {
            resolve(port)
          })
          server.close()
        })
        server.on('error', () => {
          tryPort(port + 1)
        })
      }

      tryPort(startPort)
    })
  }

  /** Shell-quote a string using single quotes (POSIX safe) */
  private shellQuote(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'"
  }

  private async ensureControlDir() {
    try {
      if (process.platform === 'win32') {
        // On Windows, use bash to create the directory in Git Bash's filesystem
        const { execAsync } = await import('child_process').then(m => ({ execAsync: promisify(m.exec) }))
        await execAsync(`${this.getBashCommand()} -c "mkdir -p ${this.controlDir}"`)
        console.log('[SSHManager] Created control directory via Git Bash:', this.controlDir)
      } else {
        await fs.mkdir(this.controlDir, { recursive: true })
      }
    } catch (error) {
      console.error('[SSHManager] Failed to create control directory:', error)
    }
  }

  /**
   * Build SSH command args for a connection
   */
  private buildSSHArgs(config: SSHConnectionConfig, controlPath: string, isControlMaster: boolean = false): string[] {
    const args: string[] = []

    // Port
    if (config.port !== 22) {
      args.push('-p', config.port.toString())
    }

    // Authentication
    if (config.authMethod === 'key' && config.identityFile) {
      args.push('-i', config.identityFile)
    } else if (config.authMethod === 'agent') {
      args.push('-A') // Agent forwarding
    } else if (config.authMethod === 'password' && isControlMaster) {
      // Only set PreferredAuthentications when establishing the ControlMaster.
      // Slave connections reuse the existing tunnel and never need to authenticate,
      // so adding this to slaves would cause SSH to try password auth if the socket
      // is momentarily unreachable — producing endless password prompts.
      args.push('-o', 'PreferredAuthentications=keyboard-interactive,password')
    }

    // SSH Multiplexing (ControlMaster)
    // With Git Bash on Windows, ControlMaster now works properly
    // Use double quotes for ControlPath since these args will be used inside bash.exe -c '...'
    // Single quotes would break out of the outer single-quoted command
    if (controlPath) {
      // Use double quotes for the control path value
      // This works correctly when the args are later placed inside bash.exe -c '...'
      const quotedControlPath = `"${controlPath}"`

      if (isControlMaster) {
        args.push(
          '-o', 'ControlMaster=auto',
          '-o', 'ControlPersist=10m',
          '-o', `ControlPath=${quotedControlPath}`,
          '-o', 'ServerAliveInterval=60',
          '-o', 'ServerAliveCountMax=3',
          '-o', 'StrictHostKeyChecking=accept-new'
        )
      } else {
        // Slave connections: reuse the ControlMaster socket.
        // BatchMode=yes prevents SSH from ever prompting for a password
        // if the ControlMaster socket is unavailable — it will just fail
        // with an error instead of spamming password prompts.
        args.push(
          '-o', 'ControlMaster=no',
          '-o', `ControlPath=${quotedControlPath}`,
          '-o', 'BatchMode=yes'
        )
      }
    } else {
      // No control path, use basic SSH options
      args.push(
        '-o', 'ServerAliveInterval=60',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'StrictHostKeyChecking=accept-new'
      )
    }

    // Custom options
    if (config.options && config.options.length > 0) {
      args.push(...config.options)
    }

    // User@host
    args.push(`${config.username}@${config.host}`)

    return args
  }

  /**
   * Get control socket path for a connection
   */
  private getControlPath(connectionId: string): string {
    if (process.platform === 'win32') {
      // Use Unix-style path for Git Bash
      return `${this.controlDir}/ssh-${connectionId}.sock`
    }
    return path.join(this.controlDir, `ssh-${connectionId}.sock`)
  }

  /**
   * Execute SSH command through bash on Windows (for Git Bash compatibility)
   * On Unix, execute directly
   */
  private async execSSH(args: string[], options?: { env?: Record<string, string>; timeout?: number }): Promise<{ stdout: string; stderr: string }> {
    const extraEnv = options?.env || {}
    const timeout = options?.timeout

    if (process.platform === 'win32') {
      const bash = this.getBashCommand()

      // Build env prefix for bash (e.g. "SSH_ASKPASS=/tmp/x DISPLAY=:0 ")
      const envPrefix = Object.entries(extraEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
      const envStr = envPrefix ? `${envPrefix} ` : ''

      // Detect whether there's a remote command to execute.
      // If the last arg is user@host (contains @) or is an SSH flag (starts with -)
      // then there is no remote command — pass all args directly.
      const lastArg = args[args.length - 1]
      const hasRemoteCommand = lastArg && !lastArg.startsWith('-') && !lastArg.includes('@')

      if (!hasRemoteCommand) {
        // No remote command: control operations (-O check), background mode (-fN), etc.
        const bashCommand = `${bash} -c '${envStr}ssh ${args.join(' ')}'`
        console.log(`[SSHManager] Executing: ${bashCommand}`)
        return execAsync(bashCommand, { timeout })
      }

      // Has a remote command — the last arg is the command to run remotely.
      // Use base64 encoding to avoid all quoting hell.
      const sshOptions = args.slice(0, -1)
      const remoteCommand = lastArg

      const sshOptsStr = sshOptions.join(' ')
      const base64Command = Buffer.from(remoteCommand).toString('base64')
      const wrappedCommand = `echo ${base64Command} | base64 -d | bash`

      const bashCommand = `${bash} -c '${envStr}ssh ${sshOptsStr} "${wrappedCommand}"'`

      console.log(`[SSHManager] Executing: ${bashCommand}`)
      return execAsync(bashCommand, { timeout })
    } else {
      // On Unix, execute SSH directly
      const env = Object.keys(extraEnv).length > 0
        ? { ...process.env, ...extraEnv }
        : undefined
      return execAsync(`ssh ${args.join(' ')}`, { env, timeout })
    }
  }

  /**
   * Test SSH connection without establishing persistent connection
   */
  async testConnection(config: SSHConnectionConfig): Promise<{ success: boolean; message?: string; error?: string }> {
    // Password authentication cannot be tested non-interactively
    if (config.authMethod === 'password') {
      return {
        success: false,
        error: 'Password authentication cannot be tested automatically. Please use SSH key or agent authentication for best results. Connection will be tested when you first create a terminal.'
      }
    }

    const args = [
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes', // Non-interactive
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'PreferredAuthentications=publickey' // Only try key-based auth
    ]

    if (config.port !== 22) {
      args.push('-p', config.port.toString())
    }

    if (config.authMethod === 'key' && config.identityFile) {
      args.push('-i', config.identityFile)
    }

    args.push(`${config.username}@${config.host}`, 'exit')

    try {
      await this.execSSH(args)
      return {
        success: true,
        message: `Successfully connected to ${config.username}@${config.host}:${config.port}`
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Connection failed: ${error.message}`
      }
    }
  }

  /**
   * Establish SSH connection with multiplexing
   */
  async connect(config: SSHConnectionConfig): Promise<{ success: boolean; connectionId?: string; error?: string }> {
    // Password authentication doesn't work well with background ControlMaster (-fN)
    // For password auth, we'll skip pre-establishing the connection and just mark it as ready
    // The actual connection will happen when creating the terminal (which is interactive)
    if (config.authMethod === 'password') {
      const connection: SSHConnection = {
        config,
        controlPath: this.getControlPath(config.id),
        connected: true, // Mark as "ready" even though we haven't connected yet
        lastUsed: Date.now(),
      }
      this.connections.set(config.id, connection)
      this.emit('status-change', config.id, true)

      console.log('[SSHManager] Password auth configured (connection will be established when terminal opens):', config.name)
      return { success: true, connectionId: config.id }
    }

    const controlPath = this.getControlPath(config.id)

    // Check if already connected
    const existing = this.connections.get(config.id)
    if (existing && existing.connected) {
      existing.lastUsed = Date.now()
      return { success: true, connectionId: config.id }
    }

    const args = this.buildSSHArgs(config, controlPath, true)
    args.push('-fN') // Background mode, no command execution

    try {
      console.log('[SSHManager] Establishing SSH connection:', config.name)
      await this.execSSH(args)

      const connection: SSHConnection = {
        config,
        controlPath,
        connected: true,
        lastUsed: Date.now(),
      }

      this.connections.set(config.id, connection)
      this.emit('status-change', config.id, true)

      console.log('[SSHManager] Connection established:', config.name)
      return { success: true, connectionId: config.id }
    } catch (error: any) {
      const connection: SSHConnection = {
        config,
        controlPath,
        connected: false,
        lastUsed: Date.now(),
        error: error.message,
      }
      this.connections.set(config.id, connection)
      this.emit('status-change', config.id, false, error.message)

      console.error('[SSHManager] Connection failed:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Disconnect SSH connection
   */
  async disconnect(connectionId: string): Promise<{ success: boolean; error?: string }> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return { success: false, error: 'Connection not found' }
    }

    try {
      // Send exit command to control master
      // Use double quotes for ControlPath since these args will be used inside bash.exe -c '...'
      const quotedControlPath = `"${connection.controlPath}"`
      const args = ['-O', 'exit', '-o', `ControlPath=${quotedControlPath}`, `${connection.config.username}@${connection.config.host}`]
      await this.execSSH(args)

      // Clean up control socket (may not exist on Windows/Git Bash filesystem from Node perspective)
      if (process.platform === 'win32') {
        try {
          await execAsync(`${this.getBashCommand()} -c "rm -f ${connection.controlPath}"`)
        } catch (err) {
          // Ignore errors
        }
      } else {
        try {
          await fs.unlink(connection.controlPath)
        } catch (err) {
          // Ignore errors if file doesn't exist
        }
      }

      connection.connected = false
      this.emit('status-change', connectionId, false)

      console.log('[SSHManager] Disconnected:', connection.config.name)
      return { success: true }
    } catch (error: any) {
      console.error('[SSHManager] Disconnect error:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Get connection status
   */
  async getStatus(connectionId: string): Promise<{ connected: boolean; error?: string }> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return { connected: false, error: 'Connection not found' }
    }

    // Check if control socket is still valid
    try {
      // Use double quotes for ControlPath since these args will be used inside bash.exe -c '...'
      const quotedControlPath = `"${connection.controlPath}"`
      const args = ['-O', 'check', '-o', `ControlPath=${quotedControlPath}`, `${connection.config.username}@${connection.config.host}`]
      await this.execSSH(args)
      connection.connected = true
      connection.lastUsed = Date.now()
      return { connected: true }
    } catch (error: any) {
      connection.connected = false
      connection.error = error.message
      return { connected: false, error: error.message }
    }
  }

  /**
   * Build SSH command for creating a PTY through a project's ControlMaster connection
   */
  buildSSHCommandForProject(projectId: string, remoteCwd?: string): { shell: string; args: string[] } | null {
    const master = this.projectMasterConnections.get(projectId)

    console.log(`[SSHManager] buildSSHCommandForProject for ${projectId}:`, {
      hasMaster: !!master,
      connected: master?.connected,
      sshConnectionId: master?.sshConnectionId
    })

    if (!master || !master.connected) {
      console.error('[SSHManager] No project master connection found')
      return null
    }

    // Use the ControlMaster connection via the SSH connection ID
    return this.buildSSHCommand(master.sshConnectionId, remoteCwd)
  }

  /**
   * Build SSH command for creating a PTY (used by pty-manager)
   * LEGACY: Direct connection - prefer buildSSHCommandForProject when possible
   */
  buildSSHCommand(connectionId: string, remoteCwd?: string): { shell: string; args: string[] } | null {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      console.error('[SSHManager] Connection not found:', connectionId)
      return null
    }

    // Use ControlMaster for all auth types
    // The ControlMaster should already be established by connectProjectMaster()
    const args = this.buildSSHArgs(connection.config, connection.controlPath, false)

    // Force TTY allocation for interactive shell
    args.push('-t')

    // Add command to cd to remote directory if specified
    if (remoteCwd) {
      // Use bash -c to run command that changes directory and starts shell
      args.push(`cd ${remoteCwd} && exec bash -l`)
    }
    // Note: If no remoteCwd, SSH will automatically start the user's default login shell

    if (process.platform === 'win32') {
      const sshCommand = `ssh ${args.map(arg => {
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('$')) {
          return `"${arg.replace(/"/g, '\\"')}"`
        }
        return arg
      }).join(' ')}`

      return {
        shell: this.gitBashPath || 'bash.exe',
        args: ['-c', sshCommand]
      }
    }

    return {
      shell: 'ssh',
      args
    }
  }


  /**
   * Build SSH command for running an agent CLI on a remote host.
   * Unlike buildSSHCommand() which starts an interactive shell, this wraps a
   * specific command (e.g. `cat | claude -p ...`) for non-interactive execution
   * with TTY allocation so stdin piping works through SSH.
   */
  buildSSHCommandForAgent(projectId: string, remoteCwd: string, agentCommand: string): { shell: string; args: string[] } | null {
    const master = this.projectMasterConnections.get(projectId)

    console.log(`[SSHManager] buildSSHCommandForAgent for ${projectId}:`, {
      hasMaster: !!master,
      connected: master?.connected,
      remoteCwd,
    })

    if (!master || !master.connected) {
      console.error('[SSHManager] No connected project master for agent spawn')
      return null
    }

    const sshConnection = this.connections.get(master.sshConnectionId)
    if (!sshConnection) {
      console.error('[SSHManager] SSH connection not found:', master.sshConnectionId)
      return null
    }

    // Build SSH args using ControlMaster (slave mode — reuses existing tunnel)
    const args = this.buildSSHArgs(sshConnection.config, sshConnection.controlPath, false)

    // Force TTY allocation (-tt) so that stdin piping (cat | claude) works through SSH
    args.push('-tt')

    // Build the remote command: cd to the project dir and execute the agent command
    const remoteCommand = `cd ${remoteCwd} && ${agentCommand}`

    if (process.platform === 'win32') {
      // On Windows, base64-encode the remote command to avoid quoting issues
      // Use bash -l (login shell) so .profile/.bashrc are sourced and npm/nvm tools are in PATH
      const base64Command = Buffer.from(remoteCommand).toString('base64')
      const wrappedRemote = `echo ${base64Command} | base64 -d | bash -l`

      const sshCommand = `ssh ${args.map(arg => {
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('$')) {
          return `"${arg.replace(/"/g, '\\"')}"`
        }
        return arg
      }).join(' ')} "${wrappedRemote}"`

      return {
        shell: this.gitBashPath || 'bash.exe',
        args: ['-c', sshCommand]
      }
    }

    // On Unix, wrap in bash -l so login profile is sourced (npm/nvm tools in PATH)
    args.push(`bash -l -c '${remoteCommand.replace(/'/g, "'\\''")}'`)
    return {
      shell: 'ssh',
      args
    }
  }

  /**
   * Detect if a CLI tool is available on the remote host via the project's SSH connection.
   * Returns availability and optional version string.
   */
  async detectRemoteCli(projectId: string, toolName: string): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const output = await this.execViaProjectMaster(projectId, `which ${toolName} 2>/dev/null && ${toolName} --version 2>/dev/null || echo '__NOT_FOUND__'`)
      if (output.includes('__NOT_FOUND__')) {
        return { available: false, error: `${toolName} not found on remote host` }
      }
      // The output contains the path on the first line and version on the second
      const lines = output.trim().split('\n')
      const version = lines.length > 1 ? lines[lines.length - 1].trim() : undefined
      return { available: true, version }
    } catch (error: any) {
      return { available: false, error: error.message }
    }
  }

  /**
   * Cleanup all connections
   */
  async disposeAll() {
    console.log('[SSHManager] Disposing all connections...')

    // Stop health monitoring first
    this.stopHealthMonitor()

    const disconnectPromises = Array.from(this.connections.keys()).map(id => this.disconnect(id))
    await Promise.all(disconnectPromises)
    this.connections.clear()
  }

  /**
   * Get all connection IDs
   */
  getConnectionIds(): string[] {
    return Array.from(this.connections.keys())
  }

  /**
   * Check if connection exists and is connected
   */
  isConnected(connectionId: string): boolean {
    const connection = this.connections.get(connectionId)
    return connection ? connection.connected : false
  }

  /**
   * Lightweight sync check — returns the in-memory connected flag for a project
   * without doing a live ssh -O check. Used by getExecutionContext to avoid
   * races with freshly-established ControlMaster tunnels.
   */
  isProjectConnected(projectId: string): boolean {
    const connection = this.projectMasterConnections.get(projectId)
    return connection ? connection.connected : false
  }

  /**
   * Establish a master SSH connection for a project using ControlMaster
   * With Git Bash on Windows, ControlMaster now works properly
   */
  async connectProjectMaster(projectId: string, sshConnectionId: string): Promise<{ success: boolean; error?: string; requiresInteractive?: boolean }> {
    console.log(`[SSHManager] Connecting project master: ${projectId} using SSH connection: ${sshConnectionId}`)

    // Check if already connected
    const existing = this.projectMasterConnections.get(projectId)
    if (existing && existing.connected) {
      console.log('[SSHManager] Project master already connected')
      return { success: true }
    }

    // Get the SSH connection config
    const sshConnection = this.connections.get(sshConnectionId)
    if (!sshConnection) {
      const error = 'SSH connection not found. Establish SSH connection first.'
      console.error(`[SSHManager] ${error}`)
      return { success: false, error }
    }

    // For password authentication, we need an interactive terminal to establish ControlMaster
    if (sshConnection.config.authMethod === 'password') {
      console.log('[SSHManager] Password auth detected - requires interactive ControlMaster setup')

      // Store the project connection info but mark as not connected yet
      this.projectMasterConnections.set(projectId, {
        projectId,
        sshConnectionId,
        controlPath: sshConnection.controlPath,
        connected: false, // Not connected until user authenticates interactively
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      })

      // Tell frontend to create an interactive terminal for ControlMaster setup
      return { success: false, requiresInteractive: true }
    }

    // For key/agent auth, ensure the SSH connection is established (ControlMaster is running)
    if (!sshConnection.connected) {
      console.log('[SSHManager] SSH connection not established, establishing now...')
      const result = await this.connect(sshConnection.config)
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to establish SSH connection' }
      }
    }

    // Store the project master connection info
    this.projectMasterConnections.set(projectId, {
      projectId,
      sshConnectionId,
      controlPath: sshConnection.controlPath,
      connected: true,
      connectedAt: Date.now(),
      lastUsed: Date.now(),
    })

    console.log(`[SSHManager] Project master connection established using ControlMaster`)
    return { success: true }
  }

  /**
   * Establish a background ControlMaster for password auth using SSH_ASKPASS.
   * Creates a temporary script that echoes the password, sets SSH_ASKPASS to it,
   * then runs `ssh -fN` exactly like key auth does.  The temp script is deleted
   * immediately after SSH authenticates.
   */
  async connectProjectMasterWithPassword(projectId: string, password: string): Promise<{ success: boolean; error?: string }> {
    const connection = this.projectMasterConnections.get(projectId)
    if (!connection) {
      return { success: false, error: `No project master entry for ${projectId}` }
    }

    const sshConnection = this.connections.get(connection.sshConnectionId)
    if (!sshConnection) {
      return { success: false, error: 'SSH connection not found' }
    }

    // Build SSH args for establishing the ControlMaster
    const args = this.buildSSHArgs(sshConnection.config, connection.controlPath, true)
    args.push('-fN') // Background mode, no command — same as key auth

    // Write a temporary askpass script that echoes the password.
    // SSH_ASKPASS tells SSH to call this script instead of prompting on a tty.
    const scriptName = `askpass-${Date.now()}.sh`
    const scriptPath = `/tmp/${scriptName}`

    // Base64-encode the password to avoid ALL quoting issues.
    // The askpass script decodes it at runtime.
    const b64Password = Buffer.from(password).toString('base64')

    try {
      if (process.platform === 'win32') {
        // Write the script via Git Bash so it lands in Git Bash's /tmp.
        // The script decodes the base64 password at runtime.
        //
        // Strategy: use single quotes for the bash -c argument. cmd.exe does
        // NOT interpret single quotes, so everything inside passes through
        // verbatim to Git Bash. The b64 string is alphanumeric-safe.
        const bash = this.getBashCommand()
        // Use execFileAsync to call Git Bash directly, bypassing cmd.exe entirely.
        // This avoids all cmd.exe quoting/escaping issues with pipes, quotes, etc.
        const bashPath = this.gitBashPath || 'bash.exe'
        await execFileAsync(bashPath, [
          '-c',
          `printf '#!/bin/sh\\necho ${b64Password} | base64 -d\\n' > ${scriptPath} && chmod 700 ${scriptPath}`
        ], { timeout: 5000 })
      } else {
        const escapedPassword = password.replace(/'/g, "'\\''")
        await fs.writeFile(scriptPath, `#!/bin/sh\necho '${escapedPassword}'\n`, { mode: 0o700 })
      }

      console.log(`[SSHManager] Establishing password ControlMaster via SSH_ASKPASS`)
      await this.execSSH(args, {
        env: {
          SSH_ASKPASS: scriptPath,
          SSH_ASKPASS_REQUIRE: 'force',
          DISPLAY: ':0',
        },
        timeout: 30000,
      })

      // ControlMaster is now running in the background
      connection.connected = true
      connection.connectedAt = Date.now()
      sshConnection.connected = true // Also mark the base connection
      console.log(`[SSHManager] Password ControlMaster established for project ${projectId}`)
      return { success: true }
    } catch (err: any) {
      console.error(`[SSHManager] Failed to establish password ControlMaster:`, err.message)
      connection.connected = false
      connection.error = err.message
      return { success: false, error: `SSH authentication failed: ${err.message}` }
    } finally {
      // Always clean up the askpass script via the same bash environment
      if (process.platform === 'win32') {
        const bashPath = this.gitBashPath || 'bash.exe'
        await execFileAsync(bashPath, ['-c', `rm -f ${scriptPath}`]).catch(() => {})
      } else {
        await fs.unlink(scriptPath).catch(() => {})
      }
    }
  }

  /**
   * Get the SSH command for establishing ControlMaster interactively (for password auth)
   * @deprecated Use connectProjectMasterWithPassword instead
   */
  getInteractiveMasterCommand(projectId: string): { shell: string; args: string[] } | null {
    const master = this.projectMasterConnections.get(projectId)
    if (!master) {
      return null
    }

    const sshConnection = this.connections.get(master.sshConnectionId)
    if (!sshConnection) {
      return null
    }

    // Build SSH command with ControlMaster options
    const args = this.buildSSHArgs(sshConnection.config, master.controlPath, true)

    // Add -t for interactive terminal (required for password prompt)
    args.push('-t')

    if (process.platform === 'win32') {
      const sshCommand = `ssh ${args.map(arg => {
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('$')) {
          return `"${arg.replace(/"/g, '\\"')}"`
        }
        return arg
      }).join(' ')}`

      return {
        shell: this.gitBashPath || 'bash.exe',
        args: ['-c', sshCommand]
      }
    }

    return {
      shell: 'ssh',
      args
    }
  }

  /**
   * Mark a project master connection as successfully established
   * (called after interactive terminal successfully connects for password auth)
   */
  markProjectMasterConnected(projectId: string): void {
    const connection = this.projectMasterConnections.get(projectId)
    if (connection) {
      connection.connected = true
      connection.connectedAt = Date.now()
      console.log(`[SSHManager] Project master marked as connected: ${projectId}`)
    } else {
      console.warn(`[SSHManager] markProjectMasterConnected: no entry for ${projectId}`)
    }
  }

  /**
   * Mark project master as connected AND verify the tunnel works by running a
   * quick `echo ok` over the ControlMaster.  Retries a few times to allow the
   * ControlMaster socket to become ready after interactive password auth.
   *
   * Returns true if the connection is verified working.
   */
  async verifyAndMarkProjectConnected(projectId: string): Promise<{ success: boolean; error?: string }> {
    const connection = this.projectMasterConnections.get(projectId)
    if (!connection) {
      return { success: false, error: `No project master entry for ${projectId}` }
    }

    const sshConnection = this.connections.get(connection.sshConnectionId)
    if (!sshConnection) {
      return { success: false, error: 'SSH connection not found' }
    }

    // Poll with `ssh -O check` until the ControlMaster socket is ready.
    // This is lightweight — it only checks whether the local socket exists
    // and does NOT initiate a new SSH handshake, so it won't trigger
    // "Too many authentication failures" on the remote host.
    //
    // The interactive PTY terminal needs time to:
    //  1. Start SSH and do key exchange
    //  2. Try and fail publickey auth (if no keys configured)
    //  3. Prompt for password (our pty.write already sent it)
    //  4. Authenticate and create the ControlMaster socket
    // This can easily take 5-15s, so we wait up to 30s total.
    const maxRetries = 15
    const retryDelay = 2000 // ms

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const quotedControlPath = `"${connection.controlPath}"`
        const args = ['-O', 'check', '-o', `ControlPath=${quotedControlPath}`, `${sshConnection.config.username}@${sshConnection.config.host}`]
        await this.execSSH(args)

        // Socket is alive — mark as connected
        connection.connected = true
        connection.connectedAt = Date.now()
        console.log(`[SSHManager] verifyAndMarkProjectConnected: ControlMaster verified on attempt ${attempt}`)
        return { success: true }
      } catch {
        // Socket not ready yet — will retry
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }

    // All retries failed — ControlMaster never appeared
    connection.connected = false
    connection.error = 'ControlMaster socket not ready after authentication'
    return { success: false, error: 'SSH ControlMaster socket did not become ready — password may have been incorrect' }
  }

  /**
   * Disconnect a project master connection
   * With ControlMaster, we just remove the project mapping
   * The underlying SSH connection stays alive for reuse
   */
  async disconnectProjectMaster(projectId: string): Promise<{ success: boolean; error?: string }> {
    console.log(`[SSHManager] Disconnecting project master: ${projectId}`)

    const connection = this.projectMasterConnections.get(projectId)
    if (!connection) {
      return { success: true } // Already disconnected
    }

    // Remove from map (the underlying SSH ControlMaster connection stays alive)
    this.projectMasterConnections.delete(projectId)
    console.log(`[SSHManager] Project master disconnected: ${projectId}`)
    return { success: true }
  }

  /**
   * Get project master connection status with active verification
   */
  async getProjectMasterStatus(projectId: string): Promise<{ connected: boolean; error?: string }> {
    const connection = this.projectMasterConnections.get(projectId)
    if (!connection) {
      return { connected: false }
    }

    if (!connection.connected) {
      return { connected: false, error: connection.error }
    }

    // Verify the connection is still alive using ssh -O check
    const sshConnection = this.connections.get(connection.sshConnectionId)
    if (!sshConnection) {
      return { connected: false, error: 'SSH connection not found' }
    }

    try {
      // Use double quotes for ControlPath since these args will be used inside bash.exe -c '...'
      const quotedControlPath = `"${connection.controlPath}"`
      const args = ['-O', 'check', '-o', `ControlPath=${quotedControlPath}`, `${sshConnection.config.username}@${sshConnection.config.host}`]
      await this.execSSH(args)
      connection.lastUsed = Date.now()
      return { connected: true }
    } catch (error: any) {
      console.log(`[SSHManager] SSH master connection found to be stale for host ${sshConnection.config.host}`)
      connection.connected = false
      connection.error = error.message
      return { connected: false, error: error.message }
    }
  }

  /**
   * Execute a command via the project master SSH connection
   */
  async execViaProjectMaster(projectId: string, command: string): Promise<string> {
    const connection = this.projectMasterConnections.get(projectId)
    if (!connection || !connection.connected) {
      throw new Error(`SSH connection not available for project ${projectId}`)
    }

    const sshConnection = this.connections.get(connection.sshConnectionId)
    if (!sshConnection) {
      throw new Error('SSH connection not found')
    }

    // Build SSH command using the ControlMaster connection
    // Wrap in login shell so .profile/.bashrc are sourced — required for
    // npm/nvm-installed tools (claude, codex) to be found in PATH.
    const args = this.buildSSHArgs(sshConnection.config, connection.controlPath, false)
    const loginWrapped = `bash -l -c ${this.shellQuote(command)}`
    args.push(loginWrapped)

    console.log(`[SSHManager] Executing command via project master ControlMaster`)

    const { stdout, stderr } = await this.execSSH(args)
    if (stderr) {
      console.log(`[SSHManager] Remote stderr:`, stderr)
    }
    connection.lastUsed = Date.now()

    return stdout
  }

}
