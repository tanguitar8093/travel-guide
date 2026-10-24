import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ItineraryItemActions({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return
      popup.current?.hidePopover()
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [open])

  return <>
    <button ref={trigger} type="button" className="itinerary-secondary itinerary-item-action-trigger"
      aria-label={label} aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => {
        const menu = popup.current
        const button = trigger.current
        if (!menu || !button) return
        if (menu.matches(':popover-open')) { menu.hidePopover(); return }
        menu.showPopover()
        const anchor = button.getBoundingClientRect()
        const size = menu.getBoundingClientRect()
        menu.style.left = `${Math.max(12, Math.min(anchor.right - size.width, window.innerWidth - size.width - 12))}px`
        menu.style.top = `${Math.max(12, anchor.bottom + size.height + 6 <= window.innerHeight - 12 ? anchor.bottom + 6 : anchor.top - size.height - 6)}px`
        menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
      }}>
      操作<svg className="itinerary-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {createPortal(<div ref={popup} id={id} popover="auto" className="itinerary-dropdown itinerary-action-options itinerary-item-popover"
      aria-label={label} onToggle={event => setOpen(event.newState === 'open')}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popup.current?.hidePopover(); trigger.current?.focus() }
      }}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) {
          popup.current?.hidePopover()
          trigger.current?.focus({ preventScroll: true })
        }
      }}>{children}</div>, document.body)}
  </>
}
