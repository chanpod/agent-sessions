import { ServiceHandler, ServiceInfo, ServiceStatus, ManagedService } from '../managed-service'
import { dockerCli, DockerComposeService } from './docker-cli'

export class DockerComposeHandler implements ServiceHandler {
  readonly type = 'docker-compose' as const

  private services: Map<string, ServiceInfo> = new Map()
  private composePathByProject: Map<string, string> = new Map()

  /**
   * Discover Docker Compose services in a project
   */
  async discover(projectPath: string, projectId: string): Promise<ServiceInfo[]> {
    // Clear existing services for this project
    for (const [id, service] of this.services) {
      if (service.projectId === projectId) {
        this.services.delete(id)
      }
    }

    // Find compose file
    const composePath = await dockerCli.findComposeFile(projectPath)
    if (!composePath) {
      return []
    }

    // Store compose path for this project
    this.composePathByProject.set(projectId, composePath)

    // Parse compose file to get service definitions
    const config = await dockerCli.parseComposeFile(composePath)
    if (!config || !config.services) {
      return []
    }

    // Get current status
    const statusResult = await dockerCli.getComposeStatus(composePath)
    const runningServices = new Map<string, DockerComposeService>()

    if (statusResult.success) {
      for (const svc of statusResult.services) {
        // Docker compose uses project_service_1 naming, extract service name
        const serviceName = svc.name.split('_').slice(1, -1).join('_') || svc.name
        runningServices.set(serviceName, svc)
      }
    }

    // Create ServiceInfo for each defined service
    const discovered: ServiceInfo[] = []

    for (const serviceName of Object.keys(config.services)) {
      const id = `docker:${projectId}:${serviceName}`
      const running = runningServices.get(serviceName)

      const info: ServiceInfo = {
        id,
        type: 'docker-compose',
        name: serviceName,
        projectId,
        status: this.mapDockerState(running?.state),
        composePath,
        serviceName,
      }

      this.services.set(id, info)
      discovered.push(info)
    }

    return discovered
  }

  /**
   * Map Docker state to ServiceStatus
   */
  private mapDockerState(state?: string): ServiceStatus {
    if (!state) return 'stopped'

    const stateLower = state.toLowerCase()
    if (stateLower === 'running') return 'running'
    if (stateLower === 'exited' || stateLower === 'dead') return 'stopped'
    if (stateLower === 'paused') return 'stopped'
    if (stateLower === 'restarting') return 'restarting'
    if (stateLower === 'created') return 'stopped'

    return 'unknown'
  }

  getService(id: string): ManagedService | undefined {
    const info = this.services.get(id)
    if (!info) return undefined

    return {
      id: info.id,
      type: 'docker-compose',
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
    if (!info || !info.composePath || !info.serviceName) {
      return 'unknown'
    }

    // Get fresh status from Docker
    const statusResult = await dockerCli.getComposeStatus(info.composePath)
    if (!statusResult.success) {
      return 'error'
    }

    // Find this service in the status
    for (const svc of statusResult.services) {
      const serviceName = svc.name.split('_').slice(1, -1).join('_') || svc.name
      if (serviceName === info.serviceName || svc.name.includes(info.serviceName)) {
        const status = this.mapDockerState(svc.state)
        info.status = status
        return status
      }
    }

    // Service not running
    info.status = 'stopped'
    return 'stopped'
  }

  async start(id: string): Promise<void> {
    const info = this.services.get(id)
    if (!info || !info.composePath || !info.serviceName) {
      throw new Error(`Service not found: ${id}`)
    }

    info.status = 'starting'

    const result = await dockerCli.startService(info.composePath, info.serviceName)
    if (!result.success) {
      info.status = 'error'
      throw new Error(result.error || 'Failed to start service')
    }

    // Update status
    await this.getStatus(id)
  }

  async stop(id: string): Promise<void> {
    const info = this.services.get(id)
    if (!info || !info.composePath || !info.serviceName) {
      throw new Error(`Service not found: ${id}`)
    }

    info.status = 'stopping'

    const result = await dockerCli.stopService(info.composePath, info.serviceName)
    if (!result.success) {
      info.status = 'error'
      throw new Error(result.error || 'Failed to stop service')
    }

    info.status = 'stopped'
  }

  async restart(id: string): Promise<void> {
    const info = this.services.get(id)
    if (!info || !info.composePath || !info.serviceName) {
      throw new Error(`Service not found: ${id}`)
    }

    info.status = 'restarting'

    const result = await dockerCli.restartService(info.composePath, info.serviceName)
    if (!result.success) {
      info.status = 'error'
      throw new Error(result.error || 'Failed to restart service')
    }

    // Update status
    await this.getStatus(id)
  }

  /**
   * Get logs for a service
   */
  async getLogs(id: string, tail: number = 100): Promise<string> {
    const info = this.services.get(id)
    if (!info || !info.composePath || !info.serviceName) {
      throw new Error(`Service not found: ${id}`)
    }

    const result = await dockerCli.getServiceLogs(info.composePath, info.serviceName, tail)
    if (!result.success) {
      throw new Error(result.error || 'Failed to get logs')
    }

    return result.output || ''
  }

  /**
   * Get compose path for a project
   */
  getComposePath(projectId: string): string | undefined {
    return this.composePathByProject.get(projectId)
  }

  /**
   * Check if Docker is available
   */
  async isDockerAvailable(): Promise<boolean> {
    return dockerCli.isAvailable()
  }
}

// Singleton instance
export const dockerComposeHandler = new DockerComposeHandler()
