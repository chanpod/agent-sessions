import React, { useState, useRef, useEffect } from 'react'
import { Bell, Settings } from 'lucide-react'
import { useProjectStore } from '../stores/project-store'
import { useToastStore } from '../stores/toast-store'
import { cn } from '../lib/utils'

interface ProjectSubHeaderProps {
  onEditProject?: (projectId: string) => void
}

export const ProjectSubHeader: React.FC<ProjectSubHeaderProps> = ({ onEditProject }) => {
  const { projects, activeProjectId } = useProjectStore()
  const activeProject = projects.find(p => p.id === activeProjectId)
  const { toasts } = useToastStore()
  const [showNotifications, setShowNotifications] = useState(false)
  const notificationRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
    }

    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showNotifications])

  if (!activeProject) {
    return (
      <div className="h-8 bg-[#252526] border-b border-gray-800 flex items-center px-4">
        <span className="text-xs text-gray-500">No project selected</span>
      </div>
    )
  }

  const hasNotifications = toasts.length > 0

  // Get the display path - for SSH projects use remotePath, for local projects use path
  const displayPath = activeProject.isSSHProject
    ? (activeProject.remotePath || '~')
    : (activeProject.path || 'No path set')

  return (
    <div className="h-8 bg-[#252526] border-b border-gray-800 flex items-center px-4 relative">
      {/* Project Path */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs text-gray-500 truncate" title={displayPath}>
          {activeProject.isSSHProject && (
            <span className="text-blue-400 mr-1">SSH:</span>
          )}
          {displayPath}
        </span>
        {onEditProject && (
          <button
            onClick={() => onEditProject(activeProject.id)}
            className="p-1 rounded hover:bg-gray-700 transition-colors text-gray-500 hover:text-gray-300"
            title="Edit project settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Notification Bell */}
      <div className="relative" ref={notificationRef}>
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className={cn(
            'p-1.5 rounded hover:bg-gray-700 transition-colors relative',
            hasNotifications && 'text-blue-400'
          )}
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {hasNotifications && (
            <span className="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full"></span>
          )}
        </button>

        {/* Notification Dropdown */}
        {showNotifications && (
          <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-[#2d2d2d] border border-gray-700 rounded shadow-lg z-50">
            {toasts.length > 0 ? (
              <div className="py-1">
                <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
                  Recent Notifications
                </div>
                {toasts.map((toast) => (
                  <div
                    key={toast.id}
                    className="px-3 py-2 border-b border-gray-800 last:border-b-0 hover:bg-gray-800"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <p className="text-xs text-gray-200">{toast.message}</p>
                        <span className="text-xs text-gray-500 capitalize">{toast.type}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 text-xs text-gray-500 text-center">
                No notifications
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
