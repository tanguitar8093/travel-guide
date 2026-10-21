import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import './PublicItineraryModule.css'

export function SharingDialog({ title, wide = false, busy = false, onClose, children }: {
  title: string; wide?: boolean; busy?: boolean; onClose(): void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement
    dialog.showModal()
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={ref} className={`sharing-dialog itinerary-app-shell${wide ? ' sharing-dialog-wide' : ''}`}
    aria-labelledby={titleId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <header className="sharing-dialog-heading"><h2 id={titleId}>{title}</h2>
      <button className="itinerary-dialog-close" type="button" aria-label={`關閉${title}`} disabled={busy} onClick={onClose}>×</button>
    </header>{children}
  </dialog>, document.body)
}
