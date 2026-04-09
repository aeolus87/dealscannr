import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

type ToastItem = {
  id: string
  type: ToastType
  message: string
  exiting?: boolean
}

type ToastContextValue = {
  toast: (type: ToastType, message: string) => void
}

const Ctx = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast requires ToastProvider')
  return v
}

const typeIcon: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--green)]" aria-hidden />,
  error: <AlertCircle className="h-5 w-5 shrink-0 text-[var(--red)]" aria-hidden />,
  warning: <AlertCircle className="h-5 w-5 shrink-0 text-[var(--yellow)]" aria-hidden />,
  info: <Info className="h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden />,
}

const typeBar: Record<ToastType, string> = {
  success: 'bg-[var(--green)]',
  error: 'bg-[var(--red)]',
  warning: 'bg-[var(--yellow)]',
  info: 'bg-[var(--accent)]',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, number>>(new Map())

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, exiting: true } : x)))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 200)
  }, [])

  const toast = useCallback(
    (type: ToastType, message: string) => {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`
      setToasts((prev) => {
        const next = [...prev, { id, type, message }]
        return next.slice(-3)
      })
      const t = window.setTimeout(() => dismiss(id), 4000)
      timers.current.set(id, t)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(100%-2rem,360px)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-dsMd',
              t.exiting ? 'ds-toast-exit' : 'ds-toast-item',
            )}
            role="status"
          >
            <div className="flex items-start gap-3 p-3 pr-2">
              {typeIcon[t.type]}
              <p className="flex-1 text-sm text-[var(--text)]">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded p-1 text-[var(--textMuted)] hover:bg-[var(--surface2)] hover:text-[var(--text)]"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-1 overflow-hidden bg-[var(--surface2)]">
              <div
                className={cn('h-full origin-left', typeBar[t.type])}
                style={{
                  animation: 'ds-toast-progress 4s linear forwards',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
