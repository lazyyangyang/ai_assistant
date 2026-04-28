/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  title: string
  message?: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (input: { title: string; message?: string; variant?: ToastVariant }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function genId() {
  return Math.random().toString(16).slice(2)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback(
    (input: { title: string; message?: string; variant?: ToastVariant }) => {
      const id = genId()
      const item: ToastItem = {
        id,
        title: input.title,
        message: input.message,
        variant: input.variant ?? 'info',
      }
      setToasts((prev) => [...prev, item])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3200)
    },
    [],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-16 z-[100] flex w-[320px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              'pointer-events-auto rounded-lg border bg-card p-3 shadow-sm',
              t.variant === 'success' && 'border-emerald-500/30',
              t.variant === 'error' && 'border-destructive/30',
              t.variant === 'info' && 'border-border',
            ].join(' ')}
          >
            <div className="text-sm font-medium">{t.title}</div>
            {t.message ? <div className="mt-1 text-sm text-muted-foreground">{t.message}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

