import { ServiceHandler, ServiceInfo, ServiceStatus, ManagedService } from '../managed-service'

// This will be injected from the main process
let ptyManager: any = null

export function setPtyManager(manager: any): void {
  ptyManager = manager
}

export class PtyServiceHandler implements ServiceHandler {
  readonly type = 'pty' as const

  private services: Map<string, ServiceInfo> = new Map()

  async discover(projectPath: string, projectId: string): Promise<ServiceInfo[]> {
    // PTY services are registered dynamically when created, not discovered
    // Return any existing services for this project
    return Array.from(this.services.values()).filter(s => s.projectId === projectId)
  }

  getService(id: string): ManagedService | undefined {
    const info = this.services.get(id)
    if (!info) return undefined

    return {
      id: info.id,
      type: 'pty',
      name: info.name,
      projectId: info.projectId,
      getStatus: () => this.getStatus(id),
      start: () => this.start(id),
      stop: () => this.stop(id),
      restart: () => this.restart(id),
    }
  }

  async getStatus(id: string): Promise<ServiceStatus> {
    const info = this.services.get(id)
    if (!info) return 'unknown'
    return info.status
  }

  async start(id: string): Promise<void> {
    // PTY services need to be recreated - this is handled externally
    throw new Error('PTY services cannot be started directly. Create a new terminal instead.')
  }

  async stop(id: string): Promise<void> {
    if (!ptyManager) {
      throw new Error('PTY manager not initialized')
    }

    const info = this.services.get(id)
    if (!info || !info.pid) {
      throw new Error(`Service not found or no PID: ${id}`)
    }

    // Send Ctrl+C first, then kill
    ptyManager.write(info.id, '\x03') // Ctrl+C

    // Wait briefly then kill if still running
    await new Promise(resolve => setTimeout(resolve, 500))
    ptyManager.kill(info.id)

    info.status = 'stopped'
  }

  async restart(id: string): Promise<void> {
    // For PTY, restart means stop + the caller needs to recreate
    await this.stop(id)
    // The frontend will handle recreating the terminal
  }

  // Called by PTY manager when a terminal is created
  registerService(terminalId: string, projectId: string, name: string, pid: number, command?: string): ServiceInfo {
    const info: ServiceInfo = {
      id: terminalId,
      type: 'pty',
      name,
      projectId,
      status: 'running',
      pid,
      command,
    }
    this.services.set(terminalId, info)
    return info
  }

  // Called by PTY manager when a terminal exits
  unregisterService(terminalId: string): void {
    this.services.delete(terminalId)
  }

  updateStatus(terminalId: string, status: ServiceStatus): void {
    const info = this.services.get(terminalId)
    if (info) {
      info.status = status
    }
  }
}

// Singleton instance
export const ptyServiceHandler = new PtyServiceHandler()
