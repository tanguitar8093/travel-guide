import { useCallback, useRef, useState } from 'react'

export type ToastMessage = { id: number; message: string; kind: 'status' | 'error'; expiresAt: number }

export function useToasts() {
  const nextId = useRef(0)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const notify = useCallback((message: string, kind: ToastMessage['kind'] = 'status') => {
    if (!message) return
    const toast: ToastMessage = { id: ++nextId.current, message, kind, expiresAt: Date.now() + 3000 }
    setToasts(current => [...current, toast].slice(-3))
  }, [])
  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), [])
  return { toasts, notify, dismiss }
}

