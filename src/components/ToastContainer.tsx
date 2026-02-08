import React, { useState } from 'react'
import { X, CheckCircle, XCircle, Info, AlertTriangle, Copy, Check } from 'lucide-react'
import { useToastStore } from '../stores/toast-store'
import { cn } from '../lib/utils'

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = async (toast: { id: string; message: string }) => {
    await navigator.clipboard.writeText(toast.message)
    setCopiedId(toast.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

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
            'relative bg-[#2d2d2d] border rounded-lg shadow-lg p-3 min-w-[300px] max-w-[400px] pointer-events-auto animate-in slide-in-from-right',
            getToastBorderColor(toast.type),
            toast.onClick && 'cursor-pointer hover:bg-[#3d3d3d] transition-colors'
          )}
        >
          <div className="flex items-start gap-2 min-w-0 pr-6">
            <div className="shrink-0 mt-0.5">{getToastIcon(toast.type)}</div>
            <p className="text-sm text-gray-200 break-words min-w-0">{toast.message}</p>
          </div>
          <div className="flex items-center gap-1 mt-2 justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy(toast) }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
              aria-label="Copy message"
            >
              {copiedId === toast.id ? (
                <><Check className="w-3 h-3" /> Copied</>
              ) : (
                <><Copy className="w-3 h-3" /> Copy</>
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); removeToast(toast.id) }}
              className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
