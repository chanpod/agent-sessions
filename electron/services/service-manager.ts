import { ServiceHandler, ServiceInfo, ServiceStatus } from './managed-service'

export class ServiceManager {
  private handlers: Map<string, ServiceHandler> = new Map()
  private services: Map<string, ServiceInfo> = new Map()

  registerHandler(handler: ServiceHandler): void {
    this.handlers.set(handler.type, handler)
  }

  async discoverServices(projectPath: string, projectId: string): Promise<ServiceInfo[]> {
    const allServices: ServiceInfo[] = []

    for (const handler of this.handlers.values()) {
      const services = await handler.discover(projectPath, projectId)
      for (const service of services) {
        this.services.set(service.id, service)
        allServices.push(service)
      }
    }

    return allServices
  }

  async getStatus(serviceId: string): Promise<ServiceStatus> {
    const service = this.services.get(serviceId)
    if (!service) return 'unknown'

    const handler = this.handlers.get(service.type)
    if (!handler) return 'unknown'

    return handler.getStatus(serviceId)
  }

  async start(serviceId: string): Promise<void> {
    const service = this.services.get(serviceId)
    if (!service) throw new Error(`Service not found: ${serviceId}`)

    const handler = this.handlers.get(service.type)
    if (!handler) throw new Error(`No handler for service type: ${service.type}`)

    await handler.start(serviceId)
  }

  async stop(serviceId: string): Promise<void> {
    const service = this.services.get(serviceId)
    if (!service) throw new Error(`Service not found: ${serviceId}`)

    const handler = this.handlers.get(service.type)
    if (!handler) throw new Error(`No handler for service type: ${service.type}`)

    await handler.stop(serviceId)
  }

  async restart(serviceId: string): Promise<void> {
    const service = this.services.get(serviceId)
    if (!service) throw new Error(`Service not found: ${serviceId}`)

    const handler = this.handlers.get(service.type)
    if (!handler) throw new Error(`No handler for service type: ${service.type}`)

    await handler.restart(serviceId)
  }

  getServices(): ServiceInfo[] {
    return Array.from(this.services.values())
  }

  getServicesByProject(projectId: string): ServiceInfo[] {
    return Array.from(this.services.values()).filter(s => s.projectId === projectId)
  }

  clearProject(projectId: string): void {
    for (const [id, service] of this.services) {
      if (service.projectId === projectId) {
        this.services.delete(id)
      }
    }
  }
}

// Singleton instance
export const serviceManager = new ServiceManager()
