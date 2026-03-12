import { toast } from 'sonner'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastOptions {
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

const DEFAULTS = {
  duration: 4000,
} as const

export function showToast(type: ToastType, message: string, options?: ToastOptions) {
  const config = {
    description: options?.description,
    duration: options?.duration ?? DEFAULTS.duration,
    action: options?.action
      ? { label: options.action.label, onClick: options.action.onClick }
      : undefined,
  }

  switch (type) {
    case 'success':
      return toast.success(message, config)
    case 'error':
      return toast.error(message, config)
    case 'warning':
      return toast.warning(message, config)
    case 'info':
      return toast.info(message, config)
  }
}

export function dismissToast(toastId?: string | number) {
  toast.dismiss(toastId)
}
