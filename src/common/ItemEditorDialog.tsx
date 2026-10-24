import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './ItemEditorDialog.css'

export function ItemEditorDialog({ children, label, busy, onClose }: {
  children: ReactNode; label: string; busy: boolean; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    const focusTarget = element?.querySelector<HTMLElement>('[data-dialog-autofocus]') ?? element?.querySelector<HTMLElement>('input, select, textarea, button')
    focusTarget?.focus()
    return () => { element?.close(); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  return createPortal(<dialog ref={dialog} className="item-editor-dialog" aria-label={label} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>{children}</dialog>, document.body)
}
