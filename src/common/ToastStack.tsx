import { useEffect } from 'react'
import type { ToastMessage } from './useToasts'
import './ToastStack.css'

function Toast({ toast, dismiss }: { toast: ToastMessage; dismiss(id: number): void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), Math.max(0, toast.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.expiresAt, dismiss])
  return <div className={`app-toast app-toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
    <span>{toast.message}</span>
    <button type="button" aria-label="關閉通知" onClick={() => dismiss(toast.id)}>×</button>
  </div>
}

export function ToastStack({ toasts, dismiss }: { toasts: ToastMessage[]; dismiss(id: number): void }) {
  return <div className="app-toast-stack" aria-label="操作通知">
    {toasts.map(toast => <Toast key={toast.id} toast={toast} dismiss={dismiss} />)}
  </div>
}
