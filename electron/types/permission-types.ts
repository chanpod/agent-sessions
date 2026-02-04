export interface PermissionRequest {
  session_id: string
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
}

export interface PermissionResponse {
  decision: 'allow' | 'deny'
  reason?: string
}

export interface PendingPermission {
  id: string
  request: PermissionRequest
  receivedAt: number
  resolveHttp: (response: PermissionResponse) => void
  timeoutHandle: NodeJS.Timeout
}

export interface PermissionRequestForUI {
  id: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  receivedAt: number
}
