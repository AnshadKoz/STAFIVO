"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info'

type ToastPayload = {
  type: ToastType
  title: string
  description?: string
}

type ToastEntry = ToastPayload & { id: string }

type ToastContextValue = {
  showToast: (toast: ToastPayload) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

type ToastProviderProps = {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const showToast = useCallback((toast: ToastPayload) => {
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts(prev => [...prev, { ...toast, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(entry => entry.id !== id))
    }, 3000)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`min-w-[240px] rounded-2xl px-4 py-3 text-sm shadow-lg transition ${toast.type === 'success'
                ? 'bg-blue-600 text-white'
                : toast.type === 'error'
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-gray-900/90 text-white'
              }`}
          >
            <p className="font-semibold">{toast.title}</p>
            {toast.description ? <p className="mt-1 text-xs opacity-90">{toast.description}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
