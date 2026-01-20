# SSH Architecture for Windows Compatibility

## Problem Statement

We need to support SSH projects where:
1. User enters password **once** when connecting to project
2. All subsequent terminals open without password prompts
3. Git operations work through the SSH connection
4. **Must work on Windows** (where ControlMaster is not supported)

## Why ControlMaster Doesn't Work on Windows

The traditional Unix approach uses OpenSSH's `ControlMaster` feature:
- First connection creates a "master" control socket
- Subsequent connections reuse the master via `ControlPath`
- Works perfectly on Linux/Mac

However, Windows OpenSSH **does not properly support ControlMaster**:
- Causes "getsockname failed: Not a socket" errors
- Control sockets don't work reliably
- See: https://github.com/microsoft/vscode-remote-release/issues/4253

## Solution: SSH Port Forwarding (LocalForward)

Instead of ControlMaster, we use SSH's built-in port forwarding feature which **works on all platforms including Windows**.

### How It Works

1. **Initial Connection** - User clicks "Connect" on SSH project:
   ```
   ssh -L <random-local-port>:localhost:22 user@remote-host
   ```
   - This creates ONE SSH connection (prompts for password)
   - Opens a random local port (e.g., 50001)
   - Forwards that port to port 22 on the remote machine
   - This connection stays alive as long as the terminal/PTY is open

2. **Subsequent Terminals** - User creates additional terminals:
   ```
   ssh -p <random-local-port> localhost
   ```
   - Connect to the LOCAL port
   - Traffic tunnels through the authenticated connection
   - **No password prompt** because it's going through the tunnel
   - Opens in the project's specified remote directory

3. **Git Operations** - Git watching and commands:
   ```
   ssh -p <random-local-port> localhost "git status"
   ```
   - Execute git commands through the same tunnel
   - No authentication needed

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Windows Client                                          │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Initial SSH Connection (Master)                  │ │
│  │ ssh -L 50001:localhost:22 user@remote           │ │
│  │ [User enters password ONCE]                     │ │
│  │ Status: Keeps running in background PTY        │ │
│  └──────────────────┬───────────────────────────────┘ │
│                     │                                   │
│                     │ Tunnel established                │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────────┐ │
│  │ Local Port: localhost:50001                      │ │
│  └──────────────────┬───────────────────────────────┘ │
│                     │                                   │
│      ┌──────────────┴──────────────┐                  │
│      │                               │                  │
│  ┌───▼─────┐  ┌───▼─────┐  ┌──────▼──────┐          │
│  │Terminal │  │Terminal │  │ Git Ops     │          │
│  │   #1    │  │   #2    │  │             │          │
│  └─────────┘  └─────────┘  └─────────────┘          │
│                                                         │
│  All connect to localhost:50001 (no password!)        │
└─────────────────────────────────────────────────────────┘
                     │
                     │ Internet/Network
                     │
        ┌────────────▼────────────────┐
        │ Remote Server :22           │
        │                             │
        │ - Receives all connections  │
        │ - Runs git commands         │
        │ - Hosts terminal sessions   │
        └─────────────────────────────┘
```

## Implementation Details

### Data Structures

```typescript
interface ProjectMasterConnection {
  projectId: string
  sshConnectionId: string
  localPort: number  // Random port we're listening on
  masterTerminalId: string  // ID of the persistent SSH terminal
  connected: boolean
  connectedAt: number
}
```

### Connection Flow

#### 1. User Clicks "Connect"

```typescript
// ssh-manager.ts
async connectProjectMaster(projectId: string, sshConnectionId: string) {
  // 1. Find an available local port
  const localPort = await findAvailablePort(50000, 60000)

  // 2. Build SSH command with LocalForward
  const args = [
    '-L', `${localPort}:localhost:22`,  // Port forwarding
    '-o', 'ServerAliveInterval=60',
    '-o', 'ExitOnForwardFailure=yes',
    `${username}@${host}`
  ]

  // 3. Create persistent PTY (prompts for password)
  const masterTerminal = await ptyManager.createTerminal({
    shell: 'ssh',
    args: args,
    hidden: true  // Background terminal
  })

  // 4. Store connection info
  this.projectMasterConnections.set(projectId, {
    projectId,
    sshConnectionId,
    localPort,
    masterTerminalId: masterTerminal.id,
    connected: true,
    connectedAt: Date.now()
  })

  return { success: true, localPort }
}
```

#### 2. User Creates Terminal

```typescript
// pty-manager.ts
createTerminalForProject(projectId: string, remoteCwd: string) {
  // Get the master connection
  const master = sshManager.getProjectMasterConnection(projectId)

  // Create new terminal connecting through the tunnel
  const args = [
    '-p', master.localPort.toString(),
    'localhost',
    '-t',  // Force TTY
    `cd ${remoteCwd} && exec bash -l`  // Start in project directory
  ]

  return this.createTerminalWithCommand('ssh', args, remoteCwd)
}
```

#### 3. Git Operations

```typescript
// git-watcher.ts or similar
async executeGitCommand(projectId: string, command: string): Promise<string> {
  const master = sshManager.getProjectMasterConnection(projectId)

  // Execute through the tunnel
  const result = await exec(
    `ssh -p ${master.localPort} localhost "${command}"`
  )

  return result.stdout
}
```

### Cleanup

When user disconnects project or closes app:
```typescript
async disconnectProject(projectId: string) {
  const master = this.projectMasterConnections.get(projectId)

  // Kill the master terminal (closes SSH connection and tunnel)
  await ptyManager.kill(master.masterTerminalId)

  // Remove from map
  this.projectMasterConnections.delete(projectId)
}
```

## Benefits

✅ **Cross-platform** - Works on Windows, Linux, Mac
✅ **Single authentication** - Password entered once
✅ **Standard SSH** - Uses built-in SSH features, no special tools
✅ **Simple** - No control socket file management
✅ **Reliable** - Port forwarding is well-tested and stable
✅ **Clean** - When master terminal dies, all tunnels close automatically

## Alternatives Considered

### 1. ControlMaster (Rejected)
- ❌ Doesn't work on Windows
- ❌ Socket file management is fragile

### 2. Custom Multiplexing Server (Rejected)
- ❌ Too complex to implement
- ❌ Need to upload server to remote machine
- ❌ Requires Node.js on remote server

### 3. Password Storage (Rejected)
- ❌ Security risk
- ❌ User credentials in memory

### 4. Single PTY Multiplexing (Rejected)
- ❌ Very complex to multiplex terminal I/O
- ❌ Hard to track which output belongs to which terminal

## References

- SSH Port Forwarding: https://www.ssh.com/academy/ssh/tunneling/example
- VS Code Remote SSH: https://code.visualstudio.com/docs/remote/ssh
- Windows OpenSSH Issues: https://github.com/microsoft/vscode-remote-release/issues/4253
