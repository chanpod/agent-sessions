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

  constructor() {
    super()
    // Use Git Bash compatible path for SSH control sockets
    // Git Bash can access /tmp which is usually mapped to C:\Users\<user>\AppData\Local\Temp
    // But we'll use a Unix-style path that Git Bash understands
    if (process.platform === 'win32') {
      // On Windows with Git Bash, use /tmp which Git Bash understands
      this.controlDir = '/tmp/agent-sessions-ssh'
    } else {
      // On Unix, use standard tmp directory
      this.controlDir = path.join(os.tmpdir(), 'agent-sessions-ssh')
    }
    this.ensureControlDir()
  }

  /**
   * Set the PTY manager reference (called from main.ts)
   */
  setPtyManager(ptyManager: any) {
    this.ptyManager = ptyManager
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

  private async ensureControlDir() {
    try {
      if (process.platform === 'win32') {
        // On Windows, use bash to create the directory in Git Bash's filesystem
        const { execAsync } = await import('child_process').then(m => ({ execAsync: promisify(m.exec) }))
        await execAsync(`bash.exe -c "mkdir -p ${this.controlDir}"`)
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
    }

    // SSH Multiplexing (ControlMaster)
    // With Git Bash on Windows, ControlMaster now works properly
    if (controlPath) {
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
  private async execSSH(args: string[]): Promise<{ stdout: string; stderr: string }> {
    if (process.platform === 'win32') {
      // On Windows, wrap SSH command in bash to use Git Bash's SSH
      // The last argument is typically the remote command, handle it specially
      const sshOptions = args.slice(0, -1)
      const remoteCommand = args[args.length - 1]

      // Build SSH options (these don't need complex escaping)
      const sshOptsStr = sshOptions.join(' ')

      // Use base64 encoding to avoid all quoting hell
      // Encode the command and decode it on the remote side
      const base64Command = Buffer.from(remoteCommand).toString('base64')
      const wrappedCommand = `echo ${base64Command} | base64 -d | bash`

      const bashCommand = `bash.exe -c 'ssh ${sshOptsStr} "${wrappedCommand}"'`

      console.log(`[SSHManager] Executing: ${bashCommand}`)
      return execAsync(bashCommand)
    } else {
      // On Unix, execute SSH directly
      return execAsync(`ssh ${args.join(' ')}`)
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
      const args = ['-O', 'exit', '-o', `ControlPath=${connection.controlPath}`, `${connection.config.username}@${connection.config.host}`]
      await this.execSSH(args)

      // Clean up control socket (may not exist on Windows/Git Bash filesystem from Node perspective)
      if (process.platform === 'win32') {
        try {
          await execAsync(`bash.exe -c "rm -f ${connection.controlPath}"`)
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
      const args = ['-O', 'check', '-o', `ControlPath=${connection.controlPath}`, `${connection.config.username}@${connection.config.host}`]
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

    // On Windows with Git Bash, use bash.exe to wrap SSH
    // This ensures we use Git Bash's SSH which has ControlMaster support
    if (process.platform === 'win32') {
      const sshCommand = `ssh ${args.map(arg => {
        // Quote arguments that contain spaces or special characters
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('$')) {
          return `"${arg.replace(/"/g, '\\"')}"`
        }
        return arg
      }).join(' ')}`

      return {
        shell: 'bash.exe',
        args: ['-c', sshCommand]
      }
    }

    return {
      shell: 'ssh',
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
   * Get the SSH command for establishing ControlMaster interactively (for password auth)
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

    // On Windows with Git Bash, wrap in bash.exe
    if (process.platform === 'win32') {
      const sshCommand = `ssh ${args.map(arg => {
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('$')) {
          return `"${arg.replace(/"/g, '\\"')}"`
        }
        return arg
      }).join(' ')}`

      return {
        shell: 'bash.exe',
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
    }
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

    // Build SSH command using the ControlMaster connection
    const args = this.buildSSHArgs(sshConnection.config, connection.controlPath, false)
    args.push(command)

    console.log(`[SSHManager] Executing command via project master ControlMaster`)

    const { stdout } = await this.execSSH(args)
    connection.lastUsed = Date.now()

    return stdout
  }

}
