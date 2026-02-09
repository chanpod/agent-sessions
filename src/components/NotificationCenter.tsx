import { useState } from 'react'
import { Popover } from '@base-ui-components/react/popover'
import { IconBell, IconCircleCheck, IconAlertTriangle, IconShieldExclamation, IconX } from '@tabler/icons-react'
import { useNotificationStore } from '../stores/notification-store'
import { useProjectStore } from '../stores/project-store'
import { useTerminalStore } from '../stores/terminal-store'
import { cn } from '../lib/utils'

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const { notifications, clearAll, getUnreadCount } = useNotificationStore()
  const unreadCount = getUnreadCount()

  // Group notifications by projectName and sort within groups
  const groupedNotifications = notifications.reduce((acc, notification) => {
    if (!acc[notification.projectName]) {
      acc[notification.projectName] = []
    }
    acc[notification.projectName]!.push(notification)
    return acc
  }, {} as Record<string, typeof notifications>)

  // Sort notifications within each group by timestamp descending (newest first)
  Object.keys(groupedNotifications).forEach((projectName) => {
    groupedNotifications[projectName]!.sort((a, b) => b.timestamp - a.timestamp)
  })

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    useProjectStore.getState().setActiveProject(notification.projectId)
    useTerminalStore.getState().setActiveAgentSession(notification.terminalId)
    // Dismiss (remove) only this notification — don't touch others
    useNotificationStore.getState().dismiss(notification.id)
    setOpen(false)
  }

  const handleDismiss = (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation()
    useNotificationStore.getState().dismiss(notificationId)
  }

  const handleClearAll = () => {
    clearAll()
  }

  const getIcon = (type: typeof notifications[0]['type']) => {
    switch (type) {
      case 'done':
        return <IconCircleCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
      case 'needs-attention':
        return <IconAlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
      case 'permission':
        return <IconShieldExclamation className="w-4 h-4 text-yellow-400 flex-shrink-0" />
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          'relative flex items-center justify-center w-7 h-7 rounded-md transition-colors flex-shrink-0',
          open
            ? 'bg-zinc-700 text-zinc-200'
            : 'text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300'
        )}
        title="Notifications"
      >
        <IconBell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 text-[9px] font-bold rounded-full bg-red-500 text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="end" className="z-[100]">
          <Popover.Popup className="w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl py-1.5 outline-none">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2">
              <h3 className="text-sm font-semibold text-zinc-200">Notifications</h3>
              {notifications.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="border-t border-zinc-700/50 my-1.5 mx-3" />

            {/* Content */}
            {notifications.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-zinc-500">
                No notifications
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {Object.entries(groupedNotifications).map(([projectName, projectNotifications]) => (
                  <div key={projectName} className="mb-2 last:mb-0">
                    {/* Project group header */}
                    <div className="px-3 py-1.5">
                      <span className="text-xs font-semibold text-zinc-500">{projectName}</span>
                    </div>

                    {/* Notifications for this project */}
                    {projectNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          'group/notif relative px-3 py-2 hover:bg-zinc-700/30 cursor-pointer transition-colors',
                          !notification.read && 'border-l-2 border-blue-400'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {/* Icon */}
                          {getIcon(notification.type)}

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-zinc-200 truncate">
                              {notification.sessionTitle}
                            </div>
                            <div className="text-xs text-zinc-500 truncate">
                              {notification.message}
                            </div>
                            <div className="text-xs text-zinc-600 mt-0.5">
                              {formatRelativeTime(notification.timestamp)}
                            </div>
                          </div>

                          {/* Dismiss button */}
                          <button
                            onClick={(e) => handleDismiss(e, notification.id)}
                            className="opacity-0 group-hover/notif:opacity-100 p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-600/50 transition-all flex-shrink-0"
                            title="Dismiss"
                          >
                            <IconX className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
