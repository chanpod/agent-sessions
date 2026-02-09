import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
  onClick?: () => void
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType, duration?: number, onClick?: () => void, id?: string) => string
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message: string, type: ToastType = 'info', duration: number = 5000, onClick?: () => void, id?: string) => {
    const toastId = id ?? `${Date.now()}-${Math.random()}`
    set((state) => ({
      toasts: [...state.toasts, { id: toastId, message, type, duration, onClick }]
    }))

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== toastId)
        }))
      }, duration)
    }

    return toastId
  },
  removeToast: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    }))
  },
}))
