import React, { useEffect } from 'react'
import { X, CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react'
import { useToastStore } from '../stores/toast-store'
import { cn } from '../lib/utils'

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore()

  const getToastIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-400" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-400" />
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />
      default:
        return <Info className="w-4 h-4 text-blue-400" />
    }
  }

  const getToastBorderColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'border-green-500/50'
      case 'error':
        return 'border-red-500/50'
      case 'warning':
        return 'border-yellow-500/50'
      default:
        return 'border-blue-500/50'
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.onClick ? 'button' : undefined}
          tabIndex={toast.onClick ? 0 : undefined}
          onClick={() => {
            if (toast.onClick) {
              toast.onClick()
              removeToast(toast.id)
            }
          }}
          onKeyDown={(e) => {
            if (toast.onClick && e.key === 'Enter') {
              toast.onClick()
              removeToast(toast.id)
            }
          }}
          className={cn(
            'bg-[#2d2d2d] border rounded-lg shadow-lg p-3 pr-10 min-w-[300px] max-w-[500px] pointer-events-auto animate-in slide-in-from-right',
            getToastBorderColor(toast.type),
            toast.onClick && 'cursor-pointer hover:bg-[#3d3d3d] transition-colors'
          )}
        >
          <div className="flex items-start gap-2">
            {getToastIcon(toast.type)}
            <p className="text-sm text-gray-200 flex-1">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="absolute top-2 right-2 p-1 hover:bg-gray-700 rounded transition-colors"
              aria-label="Close"
            >
              <X className="w-3 h-3 text-gray-400" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
