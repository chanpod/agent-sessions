import { EventEmitter } from 'events'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
  controlPath: string
  connected: boolean
  connectedAt: number
  lastUsed: number
  error?: string
}

export class SSHManager extends EventEmitter {
  private connections: Map<string, SSHConnection> = new Map()
  private projectMasterConnections: Map<string, ProjectMasterConnection> = new Map()
  private controlDir: string

  constructor() {
    super()
    // Use OS temp directory for SSH control sockets
    this.controlDir = path.join(os.tmpdir(), 'agent-sessions-ssh')
    this.ensureControlDir()
  }

  private async ensureControlDir() {
    try {
      await fs.mkdir(this.controlDir, { recursive: true })
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
    }

    // SSH Multiplexing (ControlMaster)
    if (isControlMaster) {
      args.push(
        '-o', 'ControlMaster=auto',
        '-o', 'ControlPersist=10m',
        '-o', `ControlPath=${controlPath}`,
        '-o', 'ServerAliveInterval=60',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'StrictHostKeyChecking=accept-new'
      )
    } else {
      args.push(
        '-o', 'ControlMaster=no',
        '-o', `ControlPath=${controlPath}`
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
    return path.join(this.controlDir, `ssh-${connectionId}.sock`)
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
      await execAsync(`ssh ${args.join(' ')}`)
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
      await execAsync(`ssh ${args.join(' ')}`)

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
      await execAsync(`ssh -O exit -o ControlPath=${connection.controlPath} ${connection.config.username}@${connection.config.host}`)

      // Clean up control socket
      try {
        await fs.unlink(connection.controlPath)
      } catch (err) {
        // Ignore errors if file doesn't exist
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
      await execAsync(`ssh -O check -o ControlPath=${connection.controlPath} ${connection.config.username}@${connection.config.host}`)
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
   * Build SSH command for creating a PTY (used by pty-manager)
   */
  buildSSHCommand(connectionId: string, remoteCwd?: string): { shell: string; args: string[] } | null {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      console.error('[SSHManager] Connection not found:', connectionId)
      return null
    }

    let args: string[]

    // For password auth, don't use ControlMaster (it won't work in background mode)
    // Instead, create a direct SSH connection (password prompt will appear in terminal)
    if (connection.config.authMethod === 'password') {
      args = []

      // Port
      if (connection.config.port !== 22) {
        args.push('-p', connection.config.port.toString())
      }

      // Force password/keyboard-interactive authentication
      args.push(
        '-o', 'PreferredAuthentications=keyboard-interactive,password',
        '-o', 'PubkeyAuthentication=no', // Disable key-based auth
        '-o', 'ServerAliveInterval=60',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'NumberOfPasswordPrompts=3' // Allow 3 password attempts
      )

      // Custom options
      if (connection.config.options && connection.config.options.length > 0) {
        args.push(...connection.config.options)
      }

      // User@host
      args.push(`${connection.config.username}@${connection.config.host}`)

      // Force TTY allocation for interactive shell
      args.push('-t')
    } else {
      // For key/agent auth, use ControlMaster
      args = this.buildSSHArgs(connection.config, connection.controlPath, false)

      // Force TTY allocation for interactive shell
      args.push('-t')
    }

    // Add command to cd to remote directory if specified
    if (remoteCwd) {
      // Use bash -c to run command that changes directory and starts shell
      args.push(`cd ${remoteCwd} && exec bash -l`)
    }
    // Note: If no remoteCwd, SSH will automatically start the user's default login shell

    // On Windows, node-pty needs the .exe extension
    const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'

    return {
      shell: sshCommand,
      args
    }
  }

  /**
   * Cleanup all connections
   */
  async disposeAll() {
    console.log('[SSHManager] Disposing all connections...')
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
   * Establish a master SSH connection for a project
   */
  async connectProjectMaster(projectId: string, sshConnectionId: string): Promise<{ success: boolean; error?: string }> {
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

    console.log(`[SSHManager] SSH connection auth method: ${sshConnection.config.authMethod}`)

    // Create a dedicated control path for this project
    const controlPath = path.join(this.controlDir, `project-${projectId}.sock`)

    // Build SSH args for the master connection
    const args = this.buildSSHArgs(sshConnection.config, controlPath, true)

    // For password auth, we need an interactive terminal to establish the master
    if (sshConnection.config.authMethod === 'password') {
      // Store as pending - frontend will need to create an interactive terminal
      this.projectMasterConnections.set(projectId, {
        projectId,
        sshConnectionId,
        controlPath,
        connected: false,
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      })
      console.log('[SSHManager] Project master (password auth) requires interactive terminal')
      return {
        success: false,
        error: 'PASSWORD_AUTH_REQUIRED',
        requiresInteractive: true
      } as any
    }

    // For key/agent auth, establish a background ControlMaster
    try {
      const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'
      const command = `${sshCommand} ${args.join(' ')} -fN`

      console.log(`[SSHManager] Executing: ${command}`)
      await execAsync(command, { timeout: 30000 })

      // Store the project master connection
      this.projectMasterConnections.set(projectId, {
        projectId,
        sshConnectionId,
        controlPath,
        connected: true,
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      })

      console.log(`[SSHManager] Project master connected for ${projectId}`)
      return { success: true }
    } catch (error: any) {
      const errorMsg = error.message || String(error)
      console.error(`[SSHManager] Failed to connect project master:`, errorMsg)

      this.projectMasterConnections.set(projectId, {
        projectId,
        sshConnectionId,
        controlPath,
        connected: false,
        connectedAt: Date.now(),
        lastUsed: Date.now(),
        error: errorMsg,
      })

      return { success: false, error: errorMsg }
    }
  }

  /**
   * Disconnect a project master connection
   */
  async disconnectProjectMaster(projectId: string): Promise<{ success: boolean; error?: string }> {
    console.log(`[SSHManager] Disconnecting project master: ${projectId}`)

    const connection = this.projectMasterConnections.get(projectId)
    if (!connection) {
      return { success: true } // Already disconnected
    }

    try {
      // Kill the control master
      const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'
      const killCommand = `${sshCommand} -O exit -o ControlPath=${connection.controlPath} localhost 2>&1`

      await execAsync(killCommand, { timeout: 5000 })
      console.log(`[SSHManager] Project master disconnected: ${projectId}`)
    } catch (error) {
      // It's okay if this fails; the control socket might already be gone
      console.log(`[SSHManager] Control socket cleanup warning (non-fatal):`, error)
    }

    // Remove from map
    this.projectMasterConnections.delete(projectId)
    return { success: true }
  }

  /**
   * Get project master connection status
   */
  getProjectMasterStatus(projectId: string): { connected: boolean; error?: string } {
    const connection = this.projectMasterConnections.get(projectId)
    if (!connection) {
      return { connected: false }
    }
    return { connected: connection.connected, error: connection.error }
  }

  /**
   * Execute a command via the project master SSH connection
   */
  async execViaProjectMaster(projectId: string, command: string): Promise<string> {
    const connection = this.projectMasterConnections.get(projectId)
    if (!connection || !connection.connected) {
      throw new Error('Project master connection not established')
    }

    const sshConnection = this.connections.get(connection.sshConnectionId)
    if (!sshConnection) {
      throw new Error('SSH connection not found')
    }

    // Build SSH command using the control socket
    const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'
    const args = this.buildSSHArgs(sshConnection.config, connection.controlPath, false)
    const fullCommand = `${sshCommand} ${args.join(' ')} "${command.replace(/"/g, '\\"')}"`

    console.log(`[SSHManager] Executing command via project master: ${fullCommand}`)

    const { stdout } = await execAsync(fullCommand, { timeout: 30000 })
    connection.lastUsed = Date.now()

    return stdout
  }

  /**
   * Get the SSH command to create an interactive master connection (for password auth)
   */
  getInteractiveMasterCommand(projectId: string): { shell: string; args: string[] } | null {
    const connection = this.projectMasterConnections.get(projectId)
    if (!connection) {
      return null
    }

    const sshConnection = this.connections.get(connection.sshConnectionId)
    if (!sshConnection) {
      return null
    }

    // Build base SSH args (without host)
    const args: string[] = []

    // Port
    if (sshConnection.config.port !== 22) {
      args.push('-p', sshConnection.config.port.toString())
    }

    // Authentication
    if (sshConnection.config.authMethod === 'key' && sshConnection.config.identityFile) {
      args.push('-i', sshConnection.config.identityFile)
    } else if (sshConnection.config.authMethod === 'agent') {
      args.push('-A')
    }

    // ControlMaster settings
    args.push(
      '-o', 'ControlMaster=auto',
      '-o', 'ControlPersist=10m',
      '-o', `ControlPath=${connection.controlPath}`,
      '-o', 'ServerAliveInterval=60',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new'
    )

    // Custom options
    if (sshConnection.config.options) {
      sshConnection.config.options.forEach(opt => {
        args.push('-o', opt)
      })
    }

    // Add -t for TTY allocation (required for password prompts)
    args.push('-t')

    // Finally, add the host
    args.push(`${sshConnection.config.username}@${sshConnection.config.host}`)

    const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'

    console.log(`[SSHManager] Interactive master command: ${sshCommand} ${args.join(' ')}`)

    return {
      shell: sshCommand,
      args: args
    }
  }

  /**
   * Mark a project master connection as successfully established
   * (called after interactive terminal successfully connects)
   */
  markProjectMasterConnected(projectId: string): void {
    const connection = this.projectMasterConnections.get(projectId)
    if (connection) {
      connection.connected = true
      connection.connectedAt = Date.now()
      console.log(`[SSHManager] Project master marked as connected: ${projectId}`)
    }
  }
}
