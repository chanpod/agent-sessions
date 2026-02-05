import { create } from 'zustand'

export type NotificationType = 'done' | 'needs-attention' | 'permission'

export interface AgentNotification {
  id: string
  projectId: string
  projectName: string
  terminalId: string
  sessionTitle: string
  type: NotificationType
  message: string
  timestamp: number
  read: boolean
}

interface NotificationStore {
  notifications: AgentNotification[]

  addNotification: (notification: Omit<AgentNotification, 'id' | 'timestamp' | 'read'>) => void
  markRead: (id: string) => void
  markAllReadForProject: (projectId: string) => void
  dismiss: (id: string) => void
  dismissAllForProject: (projectId: string) => void
  clearAll: () => void
  getUnreadCount: () => number
  getUnreadCountByProject: (projectId: string) => number
  getNotificationsByProject: () => Record<string, AgentNotification[]>
}

const MAX_NOTIFICATIONS = 100

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],

  addNotification: (notification) => {
    const newNotification: AgentNotification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      read: false,
    }
    set((state) => {
      const updated = [newNotification, ...state.notifications]
      // Auto-prune oldest if over limit
      if (updated.length > MAX_NOTIFICATIONS) {
        return { notifications: updated.slice(0, MAX_NOTIFICATIONS) }
      }
      return { notifications: updated }
    })
  },

  markRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  markAllReadForProject: (projectId) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.projectId === projectId ? { ...n, read: true } : n
      ),
    })),

  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  dismissAllForProject: (projectId) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.projectId !== projectId),
    })),

  clearAll: () => set({ notifications: [] }),

  getUnreadCount: () => get().notifications.filter((n) => !n.read).length,

  getUnreadCountByProject: (projectId) =>
    get().notifications.filter((n) => n.projectId === projectId && !n.read).length,

  getNotificationsByProject: () => {
    const grouped: Record<string, AgentNotification[]> = {}
    for (const n of get().notifications) {
      if (!grouped[n.projectId]) {
        grouped[n.projectId] = []
      }
      grouped[n.projectId]!.push(n)
    }
    return grouped
  },
}))
