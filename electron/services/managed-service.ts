export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'error' | 'unknown'

export interface ManagedService {
  readonly id: string
  readonly type: 'pty' | 'docker-compose'
  readonly name: string
  readonly projectId: string

  getStatus(): Promise<ServiceStatus>
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

export interface ServiceInfo {
  id: string
  type: 'pty' | 'docker-compose'
  name: string
  projectId: string
  status: ServiceStatus
  // For docker-compose
  composePath?: string
  serviceName?: string
  // For PTY
  pid?: number
  command?: string
}

export interface ServiceHandler {
  readonly type: 'pty' | 'docker-compose'

  discover(projectPath: string, projectId: string): Promise<ServiceInfo[]>
  getService(id: string): ManagedService | undefined
  getStatus(id: string): Promise<ServiceStatus>
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
  restart(id: string): Promise<void>
}
